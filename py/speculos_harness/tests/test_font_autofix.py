"""The deterministic Tailwind font autofix.

write_file and edit_file repair a provably-dead Tailwind arbitrary font-family
class (an unquoted multi-word family like ``font-[Playfair_Display,serif]``,
which the compiler turns into ``font-weight`` and the browser silently drops) on
the way in, and report the repair in the tool result so the model learns of it.
A valid value is left untouched, and an edit repairs only its own replacement
text - never the file's other regions. The STYLING GOTCHAS prompt block warns
about the same trap.

Driven exactly like ``test_end_to_end.py``: a scripted ``LLMProvider`` so the
turn is deterministic, a temp ``SQLiteProjectStore``, no network and no API key.
"""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
import httpx

from speculos_harness import HarnessAgent
from speculos_harness.interfaces import LLMProvider, TextDelta, ToolCallDelta
from speculos_harness.stores import SQLiteProjectStore


class ScriptedLLM(LLMProvider):
    """Emits a pre-scripted tool call each turn, one per script entry, then a
    final line of text so the agent loop stops. Each entry is (name, args)."""

    def __init__(self, script: list[tuple[str, dict]]) -> None:
        self._script = list(script)
        self.turns = 0
        self.system_prompt = ""

    def config_for(self, ctx):  # noqa: D102 - see LLMProvider
        return {"model": "scripted/test", "supports_prompt_cache": False}

    def is_context_window_error(self, err) -> bool:  # noqa: D102
        return False

    async def stream(self, messages, tools, cfg, signal=None):  # noqa: D102
        if messages and not self.system_prompt:
            self.system_prompt = str(messages[0].get("content", ""))
        step = self.turns
        self.turns += 1
        if step < len(self._script):
            name, args = self._script[step]
            yield ToolCallDelta(
                index=0, id=f"call_{step + 1}", name=name, args_delta=json.dumps(args)
            )
        else:
            yield TextDelta(text_delta="Done.")


def _build(tmp_path, script):
    """A mounted agent over a temp SQLite store and a scripted LLM. Returns the
    httpx client, the store (so a test can seed or inspect it), and the LLM."""
    store = SQLiteProjectStore(str(tmp_path / "projects.db"))
    llm = ScriptedLLM(script)
    agent = HarnessAgent(store=store, llm=llm, instructions="House brief.")
    app = FastAPI()
    app.include_router(agent.router, prefix="/api/builder")
    transport = httpx.ASGITransport(app=app)
    client = httpx.AsyncClient(transport=transport, base_url="http://t")
    return client, store, llm


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


async def _drive(client, pid, message="go") -> list[tuple[str, dict]]:
    async with client.stream(
        "POST",
        "/api/builder/chat",
        json={"projectId": pid, "message": message},
        timeout=60,
    ) as resp:
        assert resp.status_code == 200
        return await _collect_sse(resp)


def _tool_outputs(events) -> list[dict]:
    return [payload["output"] for name, payload in events if name == "tool-result"]


@pytest.mark.anyio
async def test_write_file_repairs_dead_font_class_and_reports_it(tmp_path):
    broken = (
        'import { createRoot } from "react-dom/client";\n'
        "function App() {\n"
        '  return <h1 className="font-[Playfair_Display,serif] text-2xl">Hi</h1>;\n'
        "}\n"
        'createRoot(document.getElementById("root")!).render(<App />);\n'
    )
    client, _store, _llm = _build(
        tmp_path, [("write_file", {"path": "/index.tsx", "content": broken})]
    )
    async with client as c:
        pid = (await c.post("/api/builder/projects", json={"name": "W"})).json()["id"]
        events = await _drive(c, pid)

        # The dead class is rewritten to its quoted font-family form in the store.
        stored = (await c.get(f"/api/builder/projects/{pid}")).json()["files"]["/index.tsx"]
        assert "font-['Playfair_Display',serif]" in stored
        assert "font-[Playfair_Display,serif]" not in stored

        # The repair is surfaced in the tool result (which also goes back to the
        # model as the tool message, so it learns to use the corrected class).
        out = _tool_outputs(events)[0]
        assert out.get("ok") is not False
        assert isinstance(out.get("note"), str) and out["note"]
        assert isinstance(out.get("autofixed"), list) and len(out["autofixed"]) == 1
        fix = out["autofixed"][0]
        assert fix["from"] == "font-[Playfair_Display,serif]"
        assert fix["to"] == "font-['Playfair_Display',serif]"


@pytest.mark.anyio
async def test_write_file_leaves_valid_arbitrary_values_untouched(tmp_path):
    # Every line is a form the compiler accepts: an explicit type hint, an
    # already-quoted family, non-font arbitrary values, a single-word family,
    # and a part whose only space comes from a trailing underscore it trims.
    ok = (
        'export const A = "font-[family-name:Inter]";\n'
        "export const B = \"font-['Comic_Sans_MS',cursive]\";\n"
        'export const C = "font-bold text-[16px] text-[#334155]";\n'
        'export const D = "font-[Inter]";\n'
        'export const E = "font-[Georgia,_serif]";\n'
    )
    client, _store, _llm = _build(
        tmp_path, [("write_file", {"path": "/App.tsx", "content": ok})]
    )
    async with client as c:
        pid = (await c.post("/api/builder/projects", json={"name": "V"})).json()["id"]
        events = await _drive(c, pid)

        stored = (await c.get(f"/api/builder/projects/{pid}")).json()["files"]["/App.tsx"]
        assert stored == ok  # byte-identical: nothing was rewritten

        out = _tool_outputs(events)[0]
        assert out.get("ok") is not False
        assert "note" not in out and "autofixed" not in out


@pytest.mark.anyio
async def test_edit_file_repairs_only_the_new_string(tmp_path):
    # A pre-existing dead class sits in a region the edit will not touch; the
    # incoming replacement text carries its own dead class.
    seed = (
        'export const HEADER = "font-[Old_Font,serif]";\n'
        'export const SLOT = "REPLACE_ME";\n'
    )
    client, store, _llm = _build(
        tmp_path,
        [
            (
                "edit_file",
                {
                    "path": "/App.tsx",
                    "old_string": '"REPLACE_ME"',
                    "new_string": '"font-[New_Font,serif]"',
                },
            )
        ],
    )
    async with client as c:
        pid = (await c.post("/api/builder/projects", json={"name": "E"})).json()["id"]
        await store.put_files(pid, {"/App.tsx": seed})
        events = await _drive(c, pid)

        stored = (await c.get(f"/api/builder/projects/{pid}")).json()["files"]["/App.tsx"]
        # The incoming replacement text was repaired ...
        assert "font-['New_Font',serif]" in stored
        # ... but the pre-existing dead class in the untouched region is left
        # exactly as it was: the autofix never rewrites the whole file, or the
        # model's next old_string would stop matching.
        assert 'font-[Old_Font,serif]' in stored
        assert "font-['Old_Font',serif]" not in stored

        out = _tool_outputs(events)[0]
        assert out.get("ok") is not False
        assert out.get("replacements") == 1
        assert isinstance(out.get("autofixed"), list) and len(out["autofixed"]) == 1
        assert out["autofixed"][0]["to"] == "font-['New_Font',serif]"
        assert isinstance(out.get("note"), str) and out["note"]


@pytest.mark.anyio
async def test_system_prompt_carries_the_styling_gotchas_block(tmp_path):
    client, _store, llm = _build(
        tmp_path, [("write_file", {"path": "/index.tsx", "content": "x"})]
    )
    async with client as c:
        pid = (await c.post("/api/builder/projects", json={"name": "P"})).json()["id"]
        await _drive(c, pid)

    prompt = llm.system_prompt
    assert "STYLING GOTCHAS" in prompt
    assert "font-[Playfair_Display,serif]" in prompt
    # The JSX inline-style escape hatch is shown with its literal double braces.
    assert "style={{ fontFamily:" in prompt
