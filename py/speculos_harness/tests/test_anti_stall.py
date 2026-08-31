"""Regression tests for the anti-stall \"act, don't narrate\" guard.

The failure (a prod incident): the model announces an action (\"I'll switch the
chart to a funnel view.\") and ends the step with zero tool calls, so the turn
ends and nothing changes - the user has to ask twice. On a build turn (tools
offered, nothing mutated yet) the loop must re-ask the SAME turn once, with tool
use forced and a short nudge appended, and must fall back to an unforced retry
if the provider rejects forcing.

Everything is driven by a scripted ``LLMProvider`` (the pattern in
``test_end_to_end.py``): no network, no API key. Run standalone:
    pytest tests/test_anti_stall.py
"""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi import FastAPI

from speculos_harness import HarnessAgent
from speculos_harness.interfaces import LLMProvider, TextDelta, ToolCallDelta
from speculos_harness.loop import _is_stalled_preamble
from speculos_harness.stores import SQLiteProjectStore

APP_CODE = (
    'import { createRoot } from "react-dom/client";\n'
    'function App() { return <h1>Funnel</h1>; }\n'
    'createRoot(document.getElementById("root")!).render(<App />);\n'
)


# --- the predicate, unit-tested directly -----------------------------------

STALLS = [
    "I'll switch the chart to a funnel view.",
    "I will restyle the table with sticky headers.",
    "Let me add a search box above the table.",
    "I'm going to update the KPI cards.",
    "Updating the header to show the weighted forecast.",
    "Je vais mettre a jour le tableau des ventes.",
    "Voy a actualizar la tabla.",
    "Ich werde die Tabelle aktualisieren.",
]

NON_STALLS = [
    "Which file would you like me to change?",
    "The chart shows total pipeline value grouped by stage.",
    "I'll need the table name before I can query it.",
    "The dashboard is ready - let me know if you want any tweaks.",
    'A plan:\n```harness-choices\n[{"id": "build", "label": "Build it"}]\n```',
    "I'll walk you through the layout. " + "It has three sections. " * 40,
    "Illustrating the data below.",
    "",
    "   ",
]


def test_predicate_fires_on_stalls():
    for text in STALLS:
        assert _is_stalled_preamble(text), f"should fire: {text[:60]!r}"


def test_predicate_silent_on_legitimate_replies():
    for text in NON_STALLS:
        assert not _is_stalled_preamble(text), f"should NOT fire: {text[:60]!r}"


# --- end-to-end drive of the loop through the router -----------------------


def _client(llm: LLMProvider, tmp_path) -> httpx.AsyncClient:
    agent = HarnessAgent(
        SQLiteProjectStore(str(tmp_path / "projects.db")),
        llm,
        instructions="We are Northwind. Amounts are USD.",
    )
    app = FastAPI()
    app.include_router(agent.router, prefix="/api/builder")
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://t"
    )


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


async def _chat(
    c: httpx.AsyncClient, message: str
) -> tuple[str, list[tuple[str, dict]]]:
    pid = (await c.post("/api/builder/projects", json={"name": "T"})).json()["id"]
    async with c.stream(
        "POST",
        "/api/builder/chat",
        json={"projectId": pid, "message": message},
        timeout=60,
    ) as resp:
        assert resp.status_code == 200
        events = await _collect_sse(resp)
    return pid, events


class StallThenActLLM(LLMProvider):
    """Call 1: announce an action, call no tool. Call 2 (the nudge retry):
    write a file. Call 3: a terminal summary that ends the turn."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def config_for(self, ctx):
        return {"model": "scripted/test", "supports_prompt_cache": False}

    def is_context_window_error(self, err) -> bool:
        return False

    async def stream(self, messages, tools, cfg, signal=None):
        extra = dict((cfg or {}).get("extra") or {})
        saw_nudge = any(
            isinstance(m.get("content"), str) and "called no tool" in m["content"]
            for m in messages
        )
        self.calls.append(
            {"tool_choice": extra.get("tool_choice"), "saw_nudge": saw_nudge}
        )
        n = len(self.calls)
        if n == 1:
            yield TextDelta(text_delta="I'll switch the chart to a funnel view.")
        elif n == 2:
            args = json.dumps({"path": "/index.tsx", "content": APP_CODE})
            yield ToolCallDelta(index=0, id="c1", name="write_file", args_delta=args)
        else:
            yield TextDelta(text_delta="Done - the chart is now a funnel.")


@pytest.mark.anyio
async def test_stall_triggers_one_forced_nudge_then_acts(tmp_path):
    llm = StallThenActLLM()
    async with _client(llm, tmp_path) as c:
        pid, events = await _chat(c, "Make the chart a funnel.")
        kinds = [name for name, _ in events]

        # The stall turned into a real edit inside the same turn.
        assert "tool-call" in kinds and "tool-result" in kinds
        assert "error" not in kinds and kinds[-1] == "done"

        # Three model calls: the stall, the forced nudge retry, the summary.
        assert len(llm.calls) == 3
        # First pass: no forcing, no nudge in context.
        assert llm.calls[0] == {"tool_choice": None, "saw_nudge": False}
        # The retry both forces tool use AND carries the nudge (right after the
        # stalled assistant turn).
        assert llm.calls[1] == {"tool_choice": "required", "saw_nudge": True}
        # The nudge is ephemeral: gone again on the next step, proving it was
        # never persisted into the transcript.
        assert llm.calls[2] == {"tool_choice": None, "saw_nudge": False}

        files = (await c.get(f"/api/builder/projects/{pid}")).json()["files"]
        assert "Funnel" in files["/index.tsx"]


class QuestionLLM(LLMProvider):
    """Answers with prose and no tool - a legitimate text-only reply that must
    NOT be nudged."""

    def __init__(self) -> None:
        self.calls = 0

    def config_for(self, ctx):
        return {"model": "scripted/test", "supports_prompt_cache": False}

    def is_context_window_error(self, err) -> bool:
        return False

    async def stream(self, messages, tools, cfg, signal=None):
        self.calls += 1
        yield TextDelta(
            text_delta="The chart shows total pipeline value grouped by stage."
        )


@pytest.mark.anyio
async def test_qa_reply_is_not_nudged(tmp_path):
    llm = QuestionLLM()
    async with _client(llm, tmp_path) as c:
        _, events = await _chat(c, "What does the chart show?")
    kinds = [name for name, _ in events]
    assert "tool-call" not in kinds
    assert "error" not in kinds and kinds[-1] == "done"
    assert llm.calls == 1  # answered once, no forced retry


class RejectForcingLLM(LLMProvider):
    """Stalls, rejects the forced retry (as a provider without forcing would),
    then acts once the loop drops the forcing."""

    def __init__(self) -> None:
        self.calls = 0
        self.forced_rejections = 0
        self._wrote = False

    def config_for(self, ctx):
        return {"model": "scripted/test", "supports_prompt_cache": False}

    def is_context_window_error(self, err) -> bool:
        return False

    async def stream(self, messages, tools, cfg, signal=None):
        self.calls += 1
        extra = dict((cfg or {}).get("extra") or {})
        if extra.get("tool_choice"):
            self.forced_rejections += 1
            raise RuntimeError(
                "litellm.BadRequestError: 'tool_choice' is not supported by "
                "this provider"
            )
        if self.calls == 1:
            yield TextDelta(text_delta="I'll add a search box above the table.")
        elif not self._wrote:
            self._wrote = True
            args = json.dumps({"path": "/index.tsx", "content": APP_CODE})
            yield ToolCallDelta(index=0, id="c1", name="write_file", args_delta=args)
        else:
            yield TextDelta(text_delta="Done - added the search box.")


@pytest.mark.anyio
async def test_forced_tool_choice_rejection_falls_back_to_unforced(tmp_path):
    llm = RejectForcingLLM()
    async with _client(llm, tmp_path) as c:
        pid, events = await _chat(c, "Add a search box.")
        kinds = [name for name, _ in events]

        # Despite the provider rejecting forcing, the turn still edits and the
        # user never sees an error.
        assert "tool-call" in kinds and "tool-result" in kinds
        assert "error" not in kinds and kinds[-1] == "done"

        files = (await c.get(f"/api/builder/projects/{pid}")).json()["files"]
        assert "/index.tsx" in files

    # stall -> forced retry (rejected once) -> unforced retry (writes) -> summary
    assert llm.forced_rejections == 1
    assert llm.calls == 4


class MutateThenStallWordedLLM(LLMProvider):
    """Call 1: a real edit. Call 2: a summary phrased like a stall ("I'll…").

    Once something has mutated this turn, stall-worded prose is a summary of
    further intent, not a stall - the gate must NOT nudge or force a retry.
    """

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def config_for(self, ctx):
        return {"model": "scripted/test", "supports_prompt_cache": False}

    def is_context_window_error(self, err) -> bool:
        return False

    async def stream(self, messages, tools, cfg, signal=None):
        extra = dict((cfg or {}).get("extra") or {})
        saw_nudge = any(
            isinstance(m.get("content"), str) and "called no tool" in m["content"]
            for m in messages
        )
        self.calls.append(
            {"tool_choice": extra.get("tool_choice"), "saw_nudge": saw_nudge}
        )
        if len(self.calls) == 1:
            args = json.dumps({"path": "/index.tsx", "content": APP_CODE})
            yield ToolCallDelta(index=0, id="c1", name="write_file", args_delta=args)
        else:
            # Intent-phrased text that the predicate WOULD flag pre-mutation.
            yield TextDelta(text_delta="I'll switch the chart to a funnel view.")


@pytest.mark.anyio
async def test_stall_wording_after_a_mutation_is_not_nudged(tmp_path):
    llm = MutateThenStallWordedLLM()
    assert _is_stalled_preamble("I'll switch the chart to a funnel view.")
    async with _client(llm, tmp_path) as c:
        _, events = await _chat(c, "Make the chart a funnel.")
    kinds = [name for name, _ in events]
    assert "tool-call" in kinds and "error" not in kinds and kinds[-1] == "done"
    # Exactly two model calls: the edit, then the summary - no third nudge
    # retry, because the nothing-mutated gate stands down after a real edit.
    assert len(llm.calls) == 2
    assert llm.calls[1] == {"tool_choice": None, "saw_nudge": False}
