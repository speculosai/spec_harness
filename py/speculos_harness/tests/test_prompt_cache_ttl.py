"""The extended prompt-cache TTL survives the shrink pipeline.

A host paying for an extended cache window (e.g. Cloud's 1h TTL) plumbs it
through ``LLMProvider.config_for`` as ``cache_ttl``; the loop hands it to
``fit_to_window``, which stamps it on the cache markers. Without the plumb,
every deployment silently falls back to the provider default TTL. Run:
    pytest tests/test_prompt_cache_ttl.py
"""

from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI

from speculos_harness import HarnessAgent
from speculos_harness.history import fit_to_window
from speculos_harness.interfaces import LLMProvider, TextDelta
from speculos_harness.llm import LiteLLMProvider
from speculos_harness.stores import SQLiteProjectStore

MESSAGES = [
    {"role": "system", "content": "You are the builder."},
    {"role": "user", "content": "Make the chart a funnel."},
    {"role": "assistant", "content": "Done - the chart is now a funnel."},
]


def _controls(messages):
    out = []
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and "cache_control" in part:
                    out.append(part["cache_control"])
    return out


def test_cache_ttl_reaches_the_markers():
    shaped = fit_to_window(MESSAGES, supports_prompt_cache=True, cache_ttl="1h")
    controls = _controls(shaped)
    assert controls, "expected cache markers to be placed"
    assert all(c.get("ttl") == "1h" for c in controls)


def test_no_ttl_means_the_provider_default():
    shaped = fit_to_window(MESSAGES, supports_prompt_cache=True)
    controls = _controls(shaped)
    assert controls
    assert all("ttl" not in c for c in controls)


def test_litellm_provider_publishes_cache_ttl_in_config():
    llm = LiteLLMProvider(
        "openai/gpt-5.6-luna", supports_prompt_cache=True, cache_ttl="1h"
    )
    cfg = llm.config_for({})
    assert cfg["cache_ttl"] == "1h"
    # And stays out of the config entirely when unset, so providers that do
    # not understand it never see it.
    assert "cache_ttl" not in LiteLLMProvider("openai/gpt-5.6-luna").config_for({})


@pytest.mark.anyio
async def test_the_loop_carries_cache_ttl_from_the_provider_to_the_markers(tmp_path):
    """The two ends were tested in isolation; the link between them - the loop
    reading cfg['cache_ttl'] and passing it on - was the actual gap."""
    seen: list = []

    class Recording(LLMProvider):
        def config_for(self, ctx):
            return {"model": "scripted/test", "supports_prompt_cache": True,
                    "cache_ttl": "1h"}

        def is_context_window_error(self, err) -> bool:
            return False

        async def stream(self, messages, tools, cfg, signal=None):
            seen.append(messages)
            yield TextDelta(text_delta="The chart shows pipeline by stage.")

    agent = HarnessAgent(SQLiteProjectStore(str(tmp_path / "p.db")), Recording())
    app = FastAPI()
    app.include_router(agent.router, prefix="/api/builder")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://t") as c:
        pid = (await c.post("/api/builder/projects", json={"name": "T"})).json()["id"]
        async with c.stream("POST", "/api/builder/chat",
                            json={"projectId": pid, "message": "what does it show?"},
                            timeout=60) as resp:
            async for _ in resp.aiter_lines():
                pass

    marked = [part for msg in seen[0] if isinstance(msg.get("content"), list)
              for part in msg["content"] if isinstance(part, dict)
              and "cache_control" in part]
    assert marked, "no cache markers reached the provider"
    assert all(p["cache_control"].get("ttl") == "1h" for p in marked)
