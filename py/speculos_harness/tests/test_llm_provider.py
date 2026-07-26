"""The LiteLLM adapter: chunk translation and the provider quirks that bite.

Drives ``LiteLLMProvider.stream`` against real ``litellm`` streaming objects with
the network call stubbed out, so the translation is covered without a key.
"""

from __future__ import annotations

import json

import litellm
import pytest
from litellm.types.utils import (
    ChatCompletionDeltaToolCall,
    Delta,
    Function,
    ModelResponseStream,
    StreamingChoices,
)

from speculos_harness.interfaces import Principal, TextDelta, ToolCallDelta
from speculos_harness.llm import LiteLLMProvider

CTX = {"principal": Principal(user_id="local", can_edit=True)}


def _chunk(delta: Delta) -> ModelResponseStream:
    return ModelResponseStream(choices=[StreamingChoices(index=0, delta=delta)])


@pytest.fixture()
def stub_litellm(monkeypatch):
    """Replace the network call, and capture the kwargs it was given."""
    captured: dict = {}
    chunks = [
        _chunk(Delta(content="Building ")),
        _chunk(Delta(content="the view.")),
        _chunk(
            Delta(
                tool_calls=[
                    ChatCompletionDeltaToolCall(
                        index=0,
                        id="call_1",
                        type="function",
                        function=Function(name="write_file", arguments='{"path":"/a.tsx"'),
                    )
                ]
            )
        ),
        _chunk(
            Delta(
                tool_calls=[
                    ChatCompletionDeltaToolCall(
                        index=0,
                        id=None,
                        type="function",
                        function=Function(name=None, arguments=',"content":"x"}'),
                    )
                ]
            )
        ),
    ]

    async def fake_acompletion(**kwargs):
        captured.clear()
        captured.update(kwargs)

        async def gen():
            for c in chunks:
                yield c

        return gen()

    monkeypatch.setattr(litellm, "acompletion", fake_acompletion)
    return captured


def _provider() -> LiteLLMProvider:
    return LiteLLMProvider(
        model="anthropic/claude-fable-5",
        api_key="sk-ant-placeholder",
        allowed_models=["anthropic/claude-fable-5", "openai/gpt-5.6-sol"],
    )


def test_per_turn_model_override_is_bounded_by_allowed_models():
    p = _provider()
    assert p.config_for(CTX)["model"] == "anthropic/claude-fable-5"
    assert p.config_for({**CTX, "requested_model": "openai/gpt-5.6-sol"})["model"] == (
        "openai/gpt-5.6-sol"
    )
    # A model outside the allow-list is ignored rather than honoured.
    assert p.config_for({**CTX, "requested_model": "evil/anything"})["model"] == (
        "anthropic/claude-fable-5"
    )


@pytest.mark.anyio
async def test_chunks_become_deltas(stub_litellm):
    p = _provider()
    tools = [{"type": "function", "function": {"name": "write_file", "parameters": {}}}]
    text = ""
    args = ""
    name = ""
    async for d in p.stream([{"role": "user", "content": "hi"}], tools, p.config_for(CTX), None):
        if isinstance(d, TextDelta):
            text += d.text_delta
        elif isinstance(d, ToolCallDelta):
            name = d.name or name
            args += d.args_delta or ""

    assert text == "Building the view."
    assert name == "write_file"
    # Argument fragments concatenate across deltas into one valid JSON document.
    assert json.loads(args) == {"path": "/a.tsx", "content": "x"}
    assert stub_litellm["stream"] is True


@pytest.mark.anyio
@pytest.mark.parametrize("tools", [None, []])
async def test_no_tools_is_sent_as_none_never_an_empty_list(stub_litellm, tools):
    """Some providers reject ``tools: []``. Plan mode has to send ``None``."""
    p = _provider()
    async for _ in p.stream([{"role": "user", "content": "hi"}], tools, p.config_for(CTX), None):
        pass
    assert stub_litellm["tools"] is None


def test_route_for_is_an_unopinionated_seam():
    """The hook exists for hosts and routing policies; the base kit does not route."""
    assert _provider().route_for({"task": "plan", **CTX}) is None
