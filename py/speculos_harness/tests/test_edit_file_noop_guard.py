"""edit_file refuses a no-op and returns an honest change receipt.

Drives the mounted router with a scripted ``LLMProvider`` (no API key, no
network, a temp ``SQLiteProjectStore``), exactly like ``test_end_to_end``. One
chat runs three tool steps in sequence: write a file, then an ``edit_file``
whose ``old_string`` equals its ``new_string`` (a no-op that must be refused),
then a real ``edit_file`` whose replacement is the same length as the text it
replaces - proving the ``changed`` receipt reports a true change even when the
byte count is identical.
"""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
import httpx

from speculos_harness import HarnessAgent
from speculos_harness.interfaces import LLMProvider, TextDelta, ToolCallDelta
from speculos_harness.stores import SQLiteProjectStore

# A file with a single, unambiguous token to edit.
APP_CODE = "row one\nTARGET\nrow three\n"


class ScriptedEdits(LLMProvider):
    """Write a file, attempt a no-op edit, then make a real one, then stop."""

    def __init__(self) -> None:
        self.turns = 0

    def config_for(self, ctx):  # noqa: D102 - see LLMProvider
        return {"model": "scripted/test", "supports_prompt_cache": False}

    def is_context_window_error(self, err) -> bool:  # noqa: D102
        return False

    async def stream(self, messages, tools, cfg, signal=None):  # noqa: D102
        self.turns += 1
        if self.turns == 1:
            args = json.dumps({"path": "/index.tsx", "content": APP_CODE})
            yield ToolCallDelta(index=0, id="call_1", name="write_file", args_delta=args)
        elif self.turns == 2:
            # old_string == new_string: the edit would change nothing.
            args = json.dumps(
                {"path": "/index.tsx", "old_string": "TARGET", "new_string": "TARGET"}
            )
            yield ToolCallDelta(index=0, id="call_2", name="edit_file", args_delta=args)
        elif self.turns == 3:
            # A real change whose replacement is the SAME length as the text it
            # replaces - so bytesBefore == bytesAfter yet changed is True.
            args = json.dumps(
                {"path": "/index.tsx", "old_string": "TARGET", "new_string": "MARKER"}
            )
            yield ToolCallDelta(index=0, id="call_3", name="edit_file", args_delta=args)
        else:
            yield TextDelta(text_delta="Done.")


@pytest.fixture()
def client_and_llm(tmp_path):
    llm = ScriptedEdits()
    agent = HarnessAgent(
        store=SQLiteProjectStore(str(tmp_path / "projects.db")),
        llm=llm,
        instructions="Test harness.",
    )
    app = FastAPI()
    app.include_router(agent.router, prefix="/api/builder")
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://t"), llm


async def _collect_sse(resp) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    name: str | None = None
    async for line in resp.aiter_lines():
        if line.startswith("event: "):
            name = line[7:].strip()
        elif line.startswith("data: ") and name:
            events.append((name, json.loads(line[6:])))
            name = None
    return events


@pytest.mark.anyio
async def test_edit_file_refuses_noop_and_reports_change(client_and_llm):
    client, _ = client_and_llm
    async with client as c:
        pid = (await c.post("/api/builder/projects", json={"name": "E"})).json()["id"]

        async with c.stream(
            "POST",
            "/api/builder/chat",
            json={"projectId": pid, "message": "edit it"},
            timeout=60,
        ) as resp:
            assert resp.status_code == 200
            events = await _collect_sse(resp)

        results = [payload["output"] for name, payload in events if name == "tool-result"]
        # write, no-op edit, real edit.
        assert len(results) == 3

        # 1) The write landed.
        assert results[0].get("ok") is not False

        # 2) The no-op edit is refused, names the reason, and writes nothing.
        noop = results[1]
        assert noop["ok"] is False
        assert "identical" in noop["error"]
        assert "changed" not in noop  # a refusal carries no success receipt

        # 3) The real edit succeeds and reports an honest receipt: the byte
        # count is unchanged (six chars for six) yet ``changed`` is True.
        edit = results[2]
        assert edit["ok"] is True
        assert edit["replacements"] == 1
        assert edit["bytesBefore"] == edit["bytesAfter"]
        assert edit["changed"] is True

        # The file really moved from TARGET to MARKER.
        files = (await c.get(f"/api/builder/projects/{pid}")).json()["files"]
        assert "MARKER" in files["/index.tsx"]
        assert "TARGET" not in files["/index.tsx"]
