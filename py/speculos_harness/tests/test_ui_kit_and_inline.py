"""Port item 4 - UI kit template asset + inline-small-files.

Proves three coupled behaviors, all offline (no network, no API keys):

* the default ``react-ts`` template ships the pre-built ``/components/ui.tsx``
  kit, brand-free;
* ``build_system_prompt`` renders the TEMPLATE UI KIT block only when the
  project ships the kit, and templates the runtime call with the namespace;
* CURRENT PROJECT inlines every non-kit file's contents when they fit the
  4000-char budget (kit excluded, shown as PRESENT) and otherwise lists paths.

The end-to-end case drives the mounted router with a scripted ``LLMProvider``
and a temp ``SQLiteProjectStore`` (the pattern from ``test_end_to_end.py``) so
the assembled prompt is the one that actually reaches the model.
"""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi import FastAPI

from speculos_harness import HarnessAgent
from speculos_harness.interfaces import LLMProvider, TextDelta, ToolCallDelta
from speculos_harness.prompt import build_system_prompt
from speculos_harness.stores import SQLiteProjectStore
from speculos_harness.templates import get_template

# The kit content, straight from the starter template.
KIT = get_template("react-ts").files["/components/ui.tsx"]


def _sp(files, *, namespace="app", plan_mode=False, template="react-ts"):
    """build_system_prompt over a crafted file map, no tools/connectors."""
    return build_system_prompt(
        namespace=namespace,
        instructions="",
        tools=None,
        connectors=None,
        plan_mode=plan_mode,
        ctx={"files": files, "template": template},
    )


# ---------------------------------------------------------------------------
# The template ships the kit, brand-free
# ---------------------------------------------------------------------------


def test_react_ts_template_ships_the_ui_kit() -> None:
    tpl = get_template("react-ts")
    assert "/components/ui.tsx" in tpl.files
    kit = tpl.files["/components/ui.tsx"]
    for symbol in (
        "export function PageShell",
        "export function KpiCard",
        "export function ChartCard",
        "export function DataTable",
        "export function LoadingState",
        "export function ErrorBanner",
        "export function EmptyState",
        "export function useAsyncData",
        "export type Column",
    ):
        assert symbol in kit, symbol
    # Brand-free: the Cloud hook name and the product brand are both gone.
    assert "useSpeculosData" not in kit
    assert "Speculos" not in kit
    assert "speculos" not in kit
    # The kit imports only always-available libraries.
    for lib in ('from "react"', 'from "recharts"', 'from "lucide-react"'):
        assert lib in kit, lib
    # The bare `blank` template does not ship a kit.
    assert "/components/ui.tsx" not in get_template("blank").files


# ---------------------------------------------------------------------------
# The TEMPLATE UI KIT prompt block
# ---------------------------------------------------------------------------


def test_kit_block_present_only_when_the_kit_is() -> None:
    with_kit = _sp({"/App.tsx": "x", "/components/ui.tsx": KIT})
    assert "TEMPLATE UI KIT" in with_kit
    # Six load-bearing elements survive.
    assert "COMPOSE IT, NEVER REBUILD IT" in with_kit            # ownership framing
    assert "60-120 lines" in with_kit                            # line budget anchor
    assert 'from "./components/ui"' in with_kit                  # verbatim import lines
    assert "FORBIDDEN" in with_kit and "PageShell" in with_kit   # symptom->component table
    assert "CANONICAL SHAPE" in with_kit                         # canonical skeleton
    assert "that IS the file" in with_kit                        # no-read clause
    assert "useAsyncData" in with_kit and "useSpeculosData" not in with_kit

    without = _sp({"/App.tsx": "x"})
    assert "TEMPLATE UI KIT" not in without


def test_kit_skeleton_uses_the_namespace_and_is_brand_free() -> None:
    sp = _sp({"/components/ui.tsx": KIT}, namespace="data")
    assert "window.data.<connector>.callTool" in sp
    assert "window.speculos" not in sp
    assert "Speculos" not in sp


def test_first_build_note_only_on_the_fresh_scaffold() -> None:
    scaffold = get_template("react-ts").files["/App.tsx"]
    fresh = _sp({"/App.tsx": scaffold, "/components/ui.tsx": KIT})
    assert "FIRST BUILD" in fresh
    real = _sp(
        {
            "/App.tsx": "export default function App(){ return null }",
            "/components/ui.tsx": KIT,
        }
    )
    assert "FIRST BUILD" not in real


# ---------------------------------------------------------------------------
# Inline-small-files
# ---------------------------------------------------------------------------


def test_small_project_inlines_file_contents() -> None:
    sp = _sp({"/index.tsx": "AAA_ENTRY", "/App.tsx": "BBB_APP"})
    assert "FILE CONTENTS ARE SHOWN BELOW" in sp
    assert "```tsx" in sp
    assert "AAA_ENTRY" in sp and "BBB_APP" in sp
    assert "contents NOT shown" not in sp
    # Tool discipline swapped to the contents-are-shown variant.
    assert "full current contents are shown under" in sp
    assert "shown the file LIST" not in sp


def test_large_project_lists_paths_without_contents() -> None:
    # 5000 chars of non-kit content, over the 4000-char budget.
    files = {"/index.tsx": "a" * 2500, "/App.tsx": "b" * 2500}
    sp = _sp(files)
    assert "contents NOT shown" in sp
    assert "FILE CONTENTS ARE SHOWN BELOW" not in sp
    assert "/index.tsx" in sp and "/App.tsx" in sp
    assert "a" * 2500 not in sp        # the bodies are not dumped
    assert "shown the file LIST" in sp  # default tool discipline


def test_kit_excluded_from_the_inline_budget() -> None:
    # The kit alone is ~9.6 KB, well over the budget; but it is excluded, so a
    # project whose only OTHER file is tiny still inlines - and the kit is shown
    # as PRESENT, never dumped.
    assert len(KIT) > 4000
    sp = _sp({"/App.tsx": "tiny_app_body", "/components/ui.tsx": KIT})
    assert "FILE CONTENTS ARE SHOWN BELOW" in sp
    assert "tiny_app_body" in sp          # the small non-kit file IS inlined
    assert "PRESENT. Kit file" in sp      # the kit is noted, not inlined
    assert "localeCompare" not in sp      # a kit-body-only token never appears
    assert "TEMPLATE UI KIT" in sp


# ---------------------------------------------------------------------------
# End-to-end: the assembled prompt reaches the model
# ---------------------------------------------------------------------------


class ScriptedLLM(LLMProvider):
    """Captures the system prompt, writes one file, then explains itself."""

    def __init__(self) -> None:
        self.turns = 0
        self.system_prompt = ""

    def config_for(self, ctx):  # noqa: D102
        return {"model": "scripted/test", "supports_prompt_cache": False}

    def is_context_window_error(self, err) -> bool:  # noqa: D102
        return False

    async def stream(self, messages, tools, cfg, signal=None):  # noqa: D102
        self.turns += 1
        if messages and not self.system_prompt:
            self.system_prompt = str(messages[0].get("content", ""))
        if self.turns == 1:
            args = json.dumps(
                {
                    "path": "/App.tsx",
                    "content": "export default function App(){ return null }\n",
                }
            )
            yield ToolCallDelta(index=0, id="c1", name="write_file", args_delta=args)
        else:
            yield TextDelta(text_delta="Done.")


async def _drain(resp) -> None:
    async for _line in resp.aiter_lines():
        pass


@pytest.mark.anyio
async def test_kit_and_inline_reach_the_model(tmp_path) -> None:
    llm = ScriptedLLM()
    agent = HarnessAgent(
        store=SQLiteProjectStore(str(tmp_path / "projects.db")),
        llm=llm,
        bundler_url="http://127.0.0.1:8081",
    )
    app = FastAPI()
    app.include_router(agent.router, prefix="/api/builder")
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        pid = (
            await c.post(
                "/api/builder/projects",
                json={"name": "Dash", "template": "react-ts"},
            )
        ).json()["id"]
        async with c.stream(
            "POST",
            "/api/builder/chat",
            json={"projectId": pid, "message": "Build a dashboard."},
            timeout=60,
        ) as resp:
            assert resp.status_code == 200
            await _drain(resp)

    sp = llm.system_prompt
    assert sp, "the scripted model never saw a system prompt"
    # The kit block reached the model, with the default namespace in the skeleton.
    assert "TEMPLATE UI KIT" in sp
    assert "COMPOSE IT, NEVER REBUILD IT" in sp
    assert "useAsyncData" in sp
    assert "window.app.<connector>.callTool" in sp
    # The small starter files were inlined; the kit was shown as PRESENT, not dumped.
    assert "FILE CONTENTS ARE SHOWN BELOW" in sp
    assert "PRESENT. Kit file" in sp
    assert "Your app will render here" in sp   # the App scaffold body was inlined
    assert "localeCompare" not in sp           # kit body was not
    assert "FIRST BUILD" in sp                  # /App.tsx is still the scaffold
    # Brand-free end to end.
    assert "Speculos" not in sp
    assert "useSpeculosData" not in sp
