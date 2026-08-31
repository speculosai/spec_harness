"""The inlined-dataset write guard, driven end to end through the mounted router.

Same deterministic pattern as ``test_end_to_end.py``: a scripted ``LLMProvider``
emits a single ``write_file`` and the whole turn runs with no network and no API
key against a temp ``SQLiteProjectStore``. Here the write bakes a fetched dataset
into source. With ``inlined_dataset_validator`` wired in and a live source
declared, the write is rejected and the fix recipe reaches the model as the tool
result; with no source declared the identical write lands; a small static file is
never touched even with a source.
"""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi import FastAPI

from speculos_harness import HarnessAgent
from speculos_harness.interfaces import LLMProvider, TextDelta, ToolCallDelta
from speculos_harness.stores import SQLiteProjectStore
from speculos_harness.tools import inlined_dataset_validator


def _inlined_dataset_source(rows: int = 200) -> str:
    """A .tsx file that bakes an array of ~rows object literals into source: over
    the element cap, with row-like keys and dates, and well past the minimum file
    size. Exactly the shape the guard exists to reject. It does NOT fetch live
    (no window.<ns>/.query(/.callTool(), so the strict element cap applies."""
    body = ",\n".join(
        f'  {{ id: {i}, name: "Building {i}", amount: {i * 37}, '
        f'status: "open", date: "2026-01-{(i % 28) + 1:02d}" }}'
        for i in range(rows)
    )
    return (
        'import { createRoot } from "react-dom/client";\n'
        f"const RAW = [\n{body}\n];\n"
        "function App() { return <table>{RAW.map(r => <tr key={r.id}>"
        "<td>{r.name}</td><td>{r.amount}</td></tr>)}</table>; }\n"
        'createRoot(document.getElementById("root")!).render(<App />);\n'
    )


SMALL_STATIC = (
    'import { createRoot } from "react-dom/client";\n'
    'const STATUSES = ["open", "closed", "pending"];\n'
    "function App() { return <h1>Arrears ({STATUSES.length})</h1>; }\n"
    'createRoot(document.getElementById("root")!).render(<App />);\n'
)


class ScriptedWrite(LLMProvider):
    """Emits one write_file(path, content) on the first pass, then a sentence."""

    def __init__(self, path: str, content: str) -> None:
        self.path = path
        self.content = content
        self.turns = 0

    def config_for(self, ctx):  # noqa: D102 - see LLMProvider
        return {"model": "scripted/test", "supports_prompt_cache": False}

    def is_context_window_error(self, err) -> bool:  # noqa: D102
        return False

    async def stream(self, messages, tools, cfg, signal=None):  # noqa: D102
        self.turns += 1
        if self.turns == 1:
            args = json.dumps({"path": self.path, "content": self.content})
            yield ToolCallDelta(index=0, id="call_1", name="write_file", args_delta=args)
        else:
            yield TextDelta(text_delta="done")


def _make_client(tmp_path, llm, *, has_data_source):
    agent = HarnessAgent(
        store=SQLiteProjectStore(str(tmp_path / "projects.db")),
        llm=llm,
        write_validator=inlined_dataset_validator(
            has_data_source=has_data_source, namespace="app"
        ),
    )
    app = FastAPI()
    app.include_router(agent.router, prefix="/api/builder")
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://t")


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


async def _drive(client, message: str = "build it"):
    async with client as c:
        pid = (await c.post("/api/builder/projects", json={"name": "G"})).json()["id"]
        async with c.stream(
            "POST",
            "/api/builder/chat",
            json={"projectId": pid, "message": message},
            timeout=60,
        ) as resp:
            assert resp.status_code == 200
            events = await _collect_sse(resp)
        files = (await c.get(f"/api/builder/projects/{pid}")).json()["files"]
    results = [payload for name, payload in events if name == "tool-result"]
    return results, files


@pytest.mark.anyio
async def test_inlined_dataset_is_rejected_when_a_source_is_connected(tmp_path):
    llm = ScriptedWrite("/data.tsx", _inlined_dataset_source(200))
    results, files = await _drive(_make_client(tmp_path, llm, has_data_source=True))

    assert results, "expected a tool-result"
    out = results[0]["output"]
    assert out.get("ok") is False
    err = out.get("error", "")
    # The fix recipe rode the raised exception through the seam.
    assert "fetch its own data at RUNTIME" in err
    assert "window.app.<name>.query" in err  # namespace + runtime shim in the recipe
    # A rejected write never reaches the store.
    assert "/data.tsx" not in files


@pytest.mark.anyio
async def test_same_write_lands_when_no_source_is_connected(tmp_path):
    llm = ScriptedWrite("/data.tsx", _inlined_dataset_source(200))
    results, files = await _drive(_make_client(tmp_path, llm, has_data_source=False))

    # The gate is off, so the identical payload is persisted untouched.
    assert results and results[0]["output"].get("ok") is not False
    assert "/data.tsx" in files and "Building 1" in files["/data.tsx"]


@pytest.mark.anyio
async def test_small_static_file_is_allowed_even_with_a_source(tmp_path):
    # has_data_source given as a zero-arg callable (the shared-agent form).
    llm = ScriptedWrite("/App.tsx", SMALL_STATIC)
    results, files = await _drive(
        _make_client(tmp_path, llm, has_data_source=lambda: True)
    )

    assert results and results[0]["output"].get("ok") is not False
    assert "/App.tsx" in files
