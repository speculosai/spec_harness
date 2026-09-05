"""End-to-end drive of the mounted router.

Uses a scripted ``LLMProvider`` so the whole turn is deterministic and needs no
API key: system prompt -> streaming tool call -> file write -> store -> SSE. The
bundle step needs a running build service, so it is skipped unless ``BUNDLER_URL``
points at one.
"""

from __future__ import annotations

import json
import os
import tempfile

import pytest
from fastapi import FastAPI
import httpx

from speculos_harness import HarnessAgent
from speculos_harness.interfaces import LLMProvider, Principal, TextDelta, ToolCallDelta
from speculos_harness.stores import SQLiteProjectStore

APP_CODE = (
    'import { createRoot } from "react-dom/client";\n'
    'function App() { return <h1>Arrears by building</h1>; }\n'
    'createRoot(document.getElementById("root")!).render(<App />);\n'
)


class ScriptedLLM(LLMProvider):
    """Writes one file on the first pass, then explains itself."""

    def __init__(self) -> None:
        self.turns = 0
        self.system_prompt = ""
        self.offered_tools: list[str] | None = None

    def config_for(self, ctx):  # noqa: D102 - see LLMProvider
        return {"model": "scripted/test", "supports_prompt_cache": False}

    def is_context_window_error(self, err) -> bool:  # noqa: D102
        return False

    async def stream(self, messages, tools, cfg, signal=None):  # noqa: D102
        self.turns += 1
        if messages and not self.system_prompt:
            self.system_prompt = str(messages[0].get("content", ""))
        self.offered_tools = [t["function"]["name"] for t in tools] if tools else None
        if self.turns == 1:
            args = json.dumps({"path": "/index.tsx", "content": APP_CODE})
            yield ToolCallDelta(index=0, id="call_1", name="write_file", args_delta=args)
        else:
            yield TextDelta(text_delta="Built the arrears view.")


@pytest.fixture()
def client_and_llm(tmp_path):
    llm = ScriptedLLM()
    agent = HarnessAgent(
        store=SQLiteProjectStore(str(tmp_path / "projects.db")),
        llm=llm,
        bundler_url=os.environ.get("BUNDLER_URL", "http://127.0.0.1:8081"),
        instructions="We are Northwind Property Group. Amounts are USD.",
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
async def test_capabilities_describes_the_deployment(client_and_llm):
    client, _ = client_and_llm
    async with client as c:
        r = await c.get("/api/builder/capabilities")
        assert r.status_code == 200
        caps = r.json()
        assert caps["protocol"] == 1
        assert caps["namespace"] == "app"
        assert caps["sandbox"]["location"] == "server"


@pytest.mark.anyio
async def test_a_turn_writes_a_file_and_emits_the_protocol(client_and_llm):
    client, llm = client_and_llm
    async with client as c:
        project = (await c.post("/api/builder/projects", json={"name": "Arrears"})).json()
        pid = project["id"]

        async with c.stream(
            "POST",
            "/api/builder/chat",
            json={"projectId": pid, "message": "Show me arrears by building."},
            timeout=60,
        ) as resp:
            assert resp.status_code == 200
            assert "text/event-stream" in resp.headers["content-type"]
            assert resp.headers.get("harness-protocol") == "1"
            events = await _collect_sse(resp)

        kinds = [name for name, _ in events]
        # The client renders the user bubble optimistically, but the server still
        # echoes it so a reconnecting client can rebuild the transcript.
        assert kinds[0] == "user-message"
        assert "tool-call" in kinds and "tool-result" in kinds
        assert "error" not in kinds
        assert kinds[-1] == "done"

        results = [payload for name, payload in events if name == "tool-result"]
        assert results[0]["output"].get("ok") is not False

        # The host's standing brief reaches the model, and the tools are offered.
        assert "Northwind" in llm.system_prompt
        assert llm.offered_tools and "write_file" in llm.offered_tools

        # The write landed in the store, and the turn was snapshotted first.
        files = (await c.get(f"/api/builder/projects/{pid}")).json()["files"]
        assert "Arrears by building" in files["/index.tsx"]
        snapshots = (await c.get(f"/api/builder/projects/{pid}/snapshots")).json()
        assert len(snapshots) >= 1
        # The list carries no files; one snapshot does, so the timeline can diff
        # "what did this turn change?" against the current files.
        assert "files" not in snapshots[0]
        detail = (
            await c.get(f"/api/builder/projects/{pid}/snapshots/{snapshots[0]['id']}")
        ).json()
        assert detail["id"] == snapshots[0]["id"]
        assert "/index.tsx" in detail["files"]
        assert "Arrears by building" not in detail["files"]["/index.tsx"]
        missing = await c.get(f"/api/builder/projects/{pid}/snapshots/nope")
        assert missing.status_code == 404


@pytest.mark.anyio
async def test_rollback_returns_an_undo_point(client_and_llm):
    client, _ = client_and_llm
    async with client as c:
        pid = (await c.post("/api/builder/projects", json={"name": "R"})).json()["id"]
        async with c.stream(
            "POST", "/api/builder/chat", json={"projectId": pid, "message": "build"}, timeout=60
        ) as resp:
            await _collect_sse(resp)
        snapshots = (await c.get(f"/api/builder/projects/{pid}/snapshots")).json()
        r = await c.post(
            f"/api/builder/projects/{pid}/rollback", json={"snapshotId": snapshots[0]["id"]}
        )
        assert r.status_code == 200
        assert r.json()["undoSnapshotId"]


@pytest.mark.anyio
@pytest.mark.skipif(
    not os.environ.get("BUNDLER_URL"), reason="needs a running build service (set BUNDLER_URL)"
)
async def test_bundle_returns_runnable_code(client_and_llm):
    client, _ = client_and_llm
    async with client as c:
        pid = (await c.post("/api/builder/projects", json={"name": "B"})).json()["id"]
        async with c.stream(
            "POST", "/api/builder/chat", json={"projectId": pid, "message": "build"}, timeout=60
        ) as resp:
            await _collect_sse(resp)
        r = await c.post(f"/api/builder/bundle/{pid}", timeout=180)
        assert r.status_code == 200, r.text
        assert len(r.json()["code"]) > 1000
