"""The templated system prompt, with injection points.

The system prompt tells the model how to build apps in the sandbox: the file
conventions, the runtime namespace (``window.<ns>``), the available tools and
connectors, and the host's standing rules. It is assembled per turn from a
neutral base template plus injected fragments.

What this module does:

* ``build_system_prompt`` - compose the base template with, in order: the
  host ``instructions`` brief (currency, fiscal year, house rules, design
  system - set once by an admin, included on every build), the bound
  ``namespace``, each tool's ``prompt_fragment(ctx)``, and each connector's
  contribution from ``ConnectorProvider.list(scope)``. Plan mode swaps in a
  variant that asks the model to propose a plan (as a fenced ``harness-choices``
  block) before writing code.
* The template ships neutral copy - no brand names, no product-specific
  wording; the namespace and instructions are the only host-specific inputs.

The ``ctx`` mapping is passed to every tool's ``available`` /
``prompt_fragment`` and is also read directly for a few optional keys:

===================  ====================================================
``files``            the project's file map (or an iterable of paths)
``dependencies``     declared dependencies beyond the promised set
``template``         the starter template id the project began from
``lang``             BCP-47 language hint for the reply and app copy
``used_connectors``  connector names the current files already call
===================  ====================================================

Every one of them is optional; the prompt simply omits the section.
"""

from __future__ import annotations

import re
import textwrap
from typing import Any, Iterable, Mapping, Optional, Sequence

from .interfaces import AgentTool, ConnectorSummary
from .templates import LIBRARIES

__all__ = [
    "build_system_prompt",
    "render_instructions",
    "render_connector_context",
]

#: A namespace has to be a legal JavaScript identifier: it is written as
#: ``window.<ns>`` in generated code. Anything else produces an app that cannot
#: parse, so it fails here rather than silently downstream.
_NAMESPACE_RE = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")

#: Language tags worth naming in full. Anything else is used verbatim.
_LANGUAGE_NAMES = {
    "de": "German",
    "es": "Spanish",
    "fr": "French",
    "it": "Italian",
    "ja": "Japanese",
    "nl": "Dutch",
    "pt": "Portuguese",
}


# ---------------------------------------------------------------------------
# Static blocks. Written with a literal `<ns>` placeholder rather than an
# f-string so the JSX, JSON, and object literals below need no brace escaping.
# ---------------------------------------------------------------------------

_BASE = """\
You are an expert React and TypeScript engineer building internal tools inside
a live workspace. The user describes an app in chat; you write the files. A
build service bundles them on every change and renders the result in a
sandboxed, null-origin iframe beside the conversation. There is no run button:
every successful file write rebuilds the preview.

ENVIRONMENT
- Frontend-only React 19 + TypeScript. No Node, no terminal, no server code.
- The entry point is /index.tsx and it must call createRoot(...).render(<App />).
- Imports are relative ("./App"), absolute ("/lib/format"), or bare ("react",
  "react-dom/client"). Bare imports are resolved by the build service.
- Tailwind utility classes are available - the preview shell loads them. Do not
  import CSS files and do not write a stylesheet.
- Function components and hooks only, with types on props and state.
- The preview iframe has no origin and holds no credentials. It cannot fetch
  arbitrary URLs; outside data arrives only through the runtime data API.\
"""

_HARD_RULES = """\
HARD RULES - these patterns waste output tokens and produce worse UX
- Charts: never hand-roll SVG bars, lines, paths, or axis labels. A funnel is
  <FunnelChart><Funnel data=... /></FunnelChart>, not 200 lines of <rect> math.
- Tables: never hand-roll sorting, filtering, or pagination.
- Dates: never hand-roll formatting beyond a one-off toLocaleDateString.
- Icons: never inline SVG icon paths.
- Size: a typical screen is 80-150 lines. Past ~250 lines in one file you are
  hand-rolling something a library does better - stop and pick the library.\
"""

_STYLING_GOTCHAS = """\
STYLING GOTCHAS - Tailwind arbitrary values that compile to the WRONG property
These fail SILENTLY - no error, no warning, the declaration is simply dropped.
- In an arbitrary value an unescaped underscore IS a space, so a multi-word font
  family MUST be quoted. font-[Playfair_Display,serif] compiles to
  `font-weight: Playfair Display,serif` - invalid, so the browser drops it and
  the font never changes. Quote every comma part that has a space:
  font-['Playfair_Display',serif]; or use font-[family-name:...]; or an inline
  style={{ fontFamily: "'Playfair Display',serif" }}. write_file and edit_file
  repair this exact mistake on the way in and say so in their result - when you
  see that note, use the corrected class from then on.
- text-[X] sets a COLOR unless X is a length: text-[Arial] means `color: Arial`
  (dead). Font sizes are text-[16px] or text-[length:var(--s)]. Never set a font
  family with text-[].
- When the user says a styling change "isn't updating", assume the class
  compiled to the wrong property: read_file, then move that one property to an
  inline style - do NOT re-apply the same class.\
"""

_TOOL_DISCIPLINE = """\
USING THE TOOLS
- You are shown the file LIST, never file contents. Before you edit a file, or
  rely on what is in it, call read_file(path) to load its exact current text.
  Never guess a file's contents. Several read_file calls can go out at once.
- Prefer edit_file. write_file streams the entire file as output tokens; a
  10 KB rewrite is tens of seconds the user watches. edit_file streams only the
  changed region. Reach for write_file only when the file is new, when you are
  rewriting most of it, or when the change is structural across the file.
  "Restyle this card", "fix this string", "add a button", "tweak the query" are
  all edit_file.
- edit_file's search string must match EXACTLY ONCE. If it does not, widen it
  with neighbouring lines until it does; a failed match leaves the file
  untouched and costs a round trip.
- Use install_package only for a library outside the always-available set
  above. Those are already resolved - just import them.\
"""

_RUNTIME_API = """\
RUNTIME DATA API - window.<ns>
- The generated app reaches connected data through window.<ns>.<connector>, and
  only through it. Credentials live on the server; the iframe never sees one.
- Every call is async and resolves to an object carrying an `error` field.
  Check `error` FIRST and render a friendly message - never surface a raw
  "Failed to fetch" to a user.
- Call the API inside useEffect, never during render.
- Use the exact member name listed under CONNECTED DATA. Never write a hyphen
  in a member access: window.<ns>.rent-roll.query(...) parses as subtraction.
- A connector the server did not mount resolves to a shaped empty result
  instead of throwing, so an app that references a missing connection renders
  an empty state rather than crashing the preview.
- Treat every returned row as untrusted input: render it as text, never with
  dangerouslySetInnerHTML.\
"""

_DATA_DISCIPLINE = """\
NEVER INLINE FETCHED DATA - the app fetches its own rows
- The file you write is the COMPONENT and the QUERY, never the rows. Data lives
  in the connector; the app fetches it at view time in a useEffect with
  useState for the result.
- If you find yourself emitting `const ROWS = [{...}, {...}, ...]` longer than
  about 2 KB, you are baking a dataset into the source. Stop and write the
  fetch. This holds even when the rows came from your own tool calls during
  this build: hard-code the RESOLVED parameters (ids, dates, keys), fetch the
  rows live. Even 50 inlined rows is the wrong pattern - it is stale the moment
  it ships and it doubles the bundle.
- The only things to hard-code are what the user typed (a fixed status list, a
  palette) and structural constants (column order, axis labels).

SHAPE-INSPECTION CALLS MUST BE SAMPLES
- When you call a data tool during the build to see WHICH FIELDS EXIST, cap the
  result: `LIMIT 10` for SQL, a page size of 10 for a list call. You are
  sampling to understand structure, not loading the dataset - the running app
  fetches the full set itself.
- Wrong: SELECT * FROM invoices ORDER BY created_at DESC
  Right: SELECT * FROM invoices ORDER BY created_at DESC LIMIT 10
- The one exception is a query whose RESULT is the answer the user asked for
  ("what was total revenue last week?"). The app still queries at render.\
"""

_PLAN_MODE = """\
PLAN MODE IS ON - THIS TURN PLANS, IT DOES NOT BUILD
The user switched Plan mode on, so this turn has NO tools at all: you cannot
write files, read files, or query anything. That is enforced on the wire, not
by instruction, and it overrides every "just build it" rule above. Plan the app
with the user instead; the build happens on the next turn.

Your entire response is a little plain text plus exactly ONE fenced block
tagged `harness-choices` holding a JSON array of choices, in one of two shapes:

a. A clarifying question - when the request leaves a real product decision open
   (audience, which slice of the data, dashboard vs table vs form, read-only vs
   editable). Ask it in your text, then offer the answers:

   ```harness-choices
   [
     {"id": "by-building", "label": "Group by building, worst arrears first"},
     {"id": "by-tenant", "label": "Flat list by tenant, highest balance first"},
     {"id": "just-build", "label": "Just build it - use your best judgment"}
   ]
   ```

b. A short plan and a confirmation - when the request is clear enough to build.
   Three to six bullets (screens, data used, key features), then:

   ```harness-choices
   [
     {"id": "build", "label": "Build it"},
     {"id": "revise", "label": "Change something first"}
   ]
   ```

PLAN MODE RULES
- Each choice is an object with `id` (a short stable slug) and `label` (the
  text on the chip). Nothing else, and never more than one fenced block.
- EVERY response offers a choice that starts the build ("Just build it" on a
  question, "Build it" on a plan), so the user is never stuck in planning.
- One question per message, two to four concrete options, at most three
  questions before you show a plan. Ask only about decisions that change what
  you would build - never implementation trivia.
- Ground the questions and the plan in the connected data described above. Plan
  only what that data can actually support.
- No code, not even a snippet, and never render the JSON as a code sample: the
  chat shows the block as clickable chips.\
"""

_WORKFLOW = """\
WORKFLOW
1. Act in the SAME turn. A sentence of intent is fine, but the tool calls that
   do the work must follow it in this very response - never announce a change
   and stop, which leaves the project untouched and forces the user to ask
   twice.
2. Read what you are about to change: read_file every file you will edit or
   depend on.
3. Build the whole thing. If the user asked for an app, write the app - do not
   ask whether they would like you to update the file, just update it.
4. Check the copy against the code before you write. Every time window in the
   copy must match the query: if the query says 90 days, no heading, badge,
   empty state, or tooltip may say "last month".
5. Stop when the change is complete. Do not over-explain.

NEVER PRINT CODE IN CHAT
- Code is delivered by write_file and edit_file only. Do not paste file
  contents, diffs, or snippets into your text response.
- Do not preface an edit with "here's the updated component".
- After the tools run, summarise the EFFECT in a sentence or two ("the table
  now has sticky headers and sorts by balance"). The user sees the diff.
- Do not ask "would you like me to update the file?" - JUST UPDATE THE FILE.
  A sentence of intent and the tool calls that act on it belong in the SAME
  turn.
    BAD: the user says "make the header bigger" and the whole reply is "I'll
    update the header styling to a larger size." with no tool call - nothing
    changed and the user has to ask again.
    GOOD: one sentence of intent, then read_file and edit_file in the SAME
    turn.
- The only prose worth writing is a one-line plan immediately followed by the
  tool calls it describes, and a one-line summary after they run.\
"""

_INSTRUCTIONS_FRAMING = """\
HOUSE RULES - ENFORCEABLE BUILD RULES
These rules apply to every app built here. They are not preferences to weigh -
they are requirements.
- A rule describing a VISIBLE element (logo, header, footer, banner, byline,
  signature) is rendered as actual JSX in the running UI. Not a comment, not a
  docstring, not a hidden meta tag: the user must SEE it.
- A rule giving a URL (logo image, font, stylesheet, icon) is used directly.
  Never substitute a placeholder.
- A rule describing layout or spacing becomes concrete utility classes.
- A rule about voice, tone, or microcopy governs every string you write:
  headings, buttons, empty states, tooltips, errors.
- A rule about code style (libraries, naming, formatting) shapes the code.

RULES:\
"""

_NO_CONNECTORS = """\
CONNECTED DATA
  (none - no data sources are attached. Do not pretend to query anything:
  build with clearly-labelled sample data and tell the user, in one line, that
  attaching a data source will make it live.)\
"""


# The tool-discipline variant used when the project is small enough that every
# non-kit file's contents are inlined under CURRENT PROJECT: the read-first rule
# would otherwise contradict the fact that the contents are already on screen.
_TOOL_DISCIPLINE_INLINE = """\
USING THE TOOLS
- The project's files are small, so their full current contents are shown under
  CURRENT PROJECT below (the UI kit excepted - it is documented under TEMPLATE
  UI KIT). Do NOT call read_file for a file whose contents are printed there: it
  returns exactly what you already see and wastes a round trip. Go straight to
  write_file / edit_file, copying edit_file's old_string verbatim from the shown
  contents.
- Prefer edit_file. write_file streams the entire file as output tokens; a
  10 KB rewrite is tens of seconds the user watches. edit_file streams only the
  changed region. Reach for write_file only when the file is new, when you are
  rewriting most of it, or when the change is structural across the file.
  "Restyle this card", "fix this string", "add a button", "tweak the query" are
  all edit_file.
- edit_file's search string must match EXACTLY ONCE. If it does not, widen it
  with neighbouring lines until it does; a failed match leaves the file
  untouched and costs a round trip.
- Use install_package only for a library outside the always-available set
  above. Those are already resolved - just import them.\
"""


#: Contents-inlining budget for CURRENT PROJECT. When every file OTHER than the
#: UI kit fits in this many characters, their full text is inlined so the model
#: can write or edit on the first turn without spending a round trip on
#: read_file. All-or-nothing: a partial inline would make "which files must I
#: still read?" ambiguous.
_INLINE_BUDGET = 4000

#: The template UI kit path. Never inlined or read - it is documented in full
#: under TEMPLATE UI KIT - and it is excluded from the inline budget.
_KIT_PATH = "/components/ui.tsx"

#: A class string unique to the starter /App.tsx placeholder, used to tell a
#: fresh scaffold from a real app so the first-build note fires only once. Must
#: track the placeholder in speculos_harness.templates (_REACT_TS_APP).
_SCAFFOLD_MARKER = "h-12 w-12 rounded-2xl bg-slate-900"


#: The TEMPLATE UI KIT block. A/B-validated wording; keep its six load-bearing
#: elements intact (ownership framing, the 60-120 line budget, the verbatim
#: import lines, the FORBIDDEN symptom->component table, the canonical skeleton,
#: and the "the docs ARE the file" no-read clause). `<ns>` is the only templated
#: token; everything else is literal. Contract mirror of the kit asset shipped
#: at _KIT_PATH by speculos_harness.templates.
_UI_KIT_BLOCK = """\
TEMPLATE UI KIT — /components/ui.tsx (ALREADY IN THIS PROJECT — COMPOSE IT, NEVER REBUILD IT)

Page chrome, stat tiles, chart cards, the sortable/searchable/paginated table,
and the loading/error/empty states are ALREADY WRITTEN, styled, and tested in
/components/ui.tsx. Your job is to COMPOSE them and write the data fetch — not
to re-implement them. A finished dashboard is 60-120 lines. If your App.tsx is
heading past 150 lines you are re-typing the kit; stop and import it instead.

ALWAYS start App.tsx with these two lines, copied verbatim:

  import { PageShell, KpiCard, ChartCard, DataTable, LoadingState, ErrorBanner, EmptyState, useAsyncData } from "./components/ui"
  import type { Column } from "./components/ui"

(Drop any name you don't use. `recharts` chart parts and `lucide-react` icons
are separate imports, as usual.)

EXACT API — this is the COMPLETE contract. No other props exist; do not invent any.

  PageShell({ title, subtitle?, actions?, children })
      Whole-page chrome: white header bar (title+subtitle left, `actions` right)
      over a bg-slate-50 min-h-screen page with a centered max-w-7xl main that
      already applies space-y-6 between its children. Wrap your WHOLE app in it.

  KpiCard({ label, value, sub?, icon? })
      One stat tile. `value` is a ReactNode (pre-format your numbers).
      `icon` is a lucide-react component itself, not an element:
      icon={DollarSign}  — NOT icon={<DollarSign />}.

  ChartCard({ title, subtitle?, height?, children })
      Card + heading + a `height`px box (default 256) that already wraps
      `children` in recharts' <ResponsiveContainer width="100%" height="100%">.
      `children` is ONE recharts chart element (<BarChart>, <AreaChart>, …).
      NEVER write <ResponsiveContainer> yourself — ChartCard is it.

  type Column<T> = { key: string; label: string; render?: (row: T) => React.ReactNode;
                     sortValue?: (row: T) => string | number; align?: 'left' | 'right' }

  DataTable<T>({ data, columns, searchable?, pageSize?, emptyTitle? })
      Search + click-header sorting (direction toggles) + pagination
      (Prev/Next, "Page x of y", row count) are ALREADY BUILT IN. You pass rows
      and columns; that is all. Default cell = render?.(row) ?? String(row[key] ?? '—').
      Sorting/searching use `sortValue` when given, else the raw field.
      pageSize defaults to 10.

  LoadingState({ label? })    centered spinner
  ErrorBanner({ message })    red error banner
  EmptyState({ title, body? }) centered muted "nothing here" block

  useAsyncData<T>(fetcher: () => Promise<T>): { data: T | null; loading: boolean; error: string | null }
      Runs `fetcher` ONCE on mount, catches, and never sets state after unmount.
      There is NO deps argument. Define the fetcher as a module-level async
      function (or a useCallback) so it is stable.
      `error` is already a STRING — pass it straight through as
      <ErrorBanner message={error} />. It is not an Error, so `error.message`
      is a type error. `data` is null until loaded: `const rows = data ?? []`.

FORBIDDEN — each of these is the kit's job, and hand-rolling it is a BUG that
costs thousands of output tokens and ships a worse-looking app:
  - Writing a <header> / page wrapper / `min-h-screen bg-slate-50` container    → PageShell
  - Writing a `rounded-2xl border ... p-5` stat-tile div                        → KpiCard
  - Writing <ResponsiveContainer> or a chart wrapper card                       → ChartCard
  - Writing useState for search text / sort key / sort dir / page number,
    or .filter/.sort/.slice for a table, or Prev/Next buttons, or <thead>/<tbody> → DataTable
  - install_package or importing @tanstack/react-table for a table              → DataTable
  - Writing a spinner, a red error box, or an "no data" block                   → LoadingState / ErrorBanner / EmptyState
  - Writing useState+useEffect+a cancelled flag to fetch on mount               → useAsyncData

CANONICAL SHAPE — a whole dashboard is this short. Copy this skeleton:

  import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts"
  import { DollarSign } from "lucide-react"
  import { PageShell, KpiCard, ChartCard, DataTable, LoadingState, ErrorBanner, useAsyncData } from "./components/ui"
  import type { Column } from "./components/ui"

  type Row = { name: string; stage: string; revenue: number }

  async function fetchRows(): Promise<Row[]> {
    const r = await window.<ns>.<connector>.callTool("<name>", { /* resolved args */ })
    if (r?.error || r?.result?.error) throw new Error(String(r?.error ?? r?.result?.error))
    const d = r?.result?.data ?? r?.data
    return (d?.records ?? []).map((rec: any) => ({ /* map fields */ }))
  }

  export default function App() {
    const { data, loading, error } = useAsyncData(fetchRows)
    if (loading) return <LoadingState label="Loading…" />
    if (error) return <ErrorBanner message={error} />
    const rows = data ?? []
    const columns: Column<Row>[] = [
      { key: "name", label: "Deal" },
      { key: "revenue", label: "Revenue", align: "right",
        render: (d) => "$" + d.revenue.toLocaleString(), sortValue: (d) => d.revenue },
    ]
    return (
      <PageShell title="…" subtitle="…">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Pipeline" value="$1.2M" sub="all stages" icon={DollarSign} />
        </div>
        <ChartCard title="Revenue by stage">
          <BarChart data={byStage}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="stage" /><YAxis /><Tooltip />
            <Bar dataKey="revenue" fill="#7c3aed" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ChartCard>
        <DataTable data={rows} columns={columns} searchable pageSize={10} />
      </PageShell>
    )
  }

The kit's full API is documented above — that IS the file. You never need to
open /components/ui.tsx, and you must not edit it.
"""


#: Appended to the kit block when /App.tsx is still the fresh starter scaffold.
_UI_KIT_FIRST_BUILD = (
    "\nFIRST BUILD: the current /App.tsx is only the placeholder scaffold "
    "(shown under CURRENT PROJECT), so build the app in ONE write_file to "
    "/App.tsx - a full rewrite, not an edit.\n"
)


# ---------------------------------------------------------------------------
# Rendering helpers
# ---------------------------------------------------------------------------


def _resolve_namespace(namespace: str) -> str:
    """Validate the runtime namespace, or refuse to build a broken prompt.

    The namespace is bound in three places that must agree - the prompt, the
    generated code, and the preview bridge - and a value that is not a legal
    JS identifier breaks the second one in a way that looks like "the app
    renders but no data arrives". Better to fail loudly on the first turn.
    """
    if not isinstance(namespace, str) or not _NAMESPACE_RE.match(namespace):
        raise ValueError(
            f"namespace {namespace!r} is not a valid JavaScript identifier; "
            "it is written as window.<ns> in every generated app"
        )
    return namespace


def _js_member(name: str) -> str:
    """A connector name as it can be written after a dot in JS."""
    cleaned = re.sub(r"[^A-Za-z0-9_$]", "_", name or "")
    if not cleaned or cleaned[0].isdigit():
        cleaned = f"_{cleaned}"
    return cleaned


def _libraries_block() -> str:
    """The LIBRARIES section, generated from the one promised-library list."""
    lines = [
        "LIBRARIES (always available - do not install_package these, just import them)"
    ]
    for lib in LIBRARIES:
        guidance = f" {lib.guidance}" if lib.guidance else ""
        lines.append(f"- `{lib.name}` - {lib.purpose}.{guidance}")
    return "\n".join(lines)


def _tool_is_available(tool: AgentTool, ctx: Mapping[str, Any]) -> bool:
    available = getattr(tool, "available", None)
    if not callable(available):
        return True
    try:
        return bool(available(ctx))
    except Exception:
        # A host-supplied tool that raises while describing itself must not
        # take down the turn. Offer it and let the executor report the error.
        return True


def _tool_fragment(tool: AgentTool, ctx: Mapping[str, Any]) -> str:
    fragment = getattr(tool, "prompt_fragment", None)
    if callable(fragment):
        try:
            text = fragment(ctx)
        except Exception:
            text = ""
        if isinstance(text, str) and text.strip():
            return text.strip()
    name = getattr(tool, "name", "") or ""
    return f"- {name}" if name else ""


def _render_tools(
    tools: Optional[Sequence[AgentTool]], ctx: Mapping[str, Any]
) -> str:
    """One section built from each offered tool's own prompt fragment.

    A tool carries the text that describes it, so a tool and its prompt cannot
    drift apart. Tools that report themselves unavailable are not described -
    telling the model about a tool it will not be offered is how it ends up
    calling something that does not exist.
    """
    fragments = [
        _tool_fragment(tool, ctx)
        for tool in (tools or ())
        if _tool_is_available(tool, ctx)
    ]
    fragments = [f for f in fragments if f]
    if not fragments:
        return ""
    return "TOOLS\n" + "\n".join(fragments)


def _connector_runtime_call(summary: Mapping[str, Any], ns: str, member: str) -> str:
    """The one line that says how to reach this connector at runtime."""
    explicit = summary.get("runtime") or summary.get("runtimeCall")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    kind = str(summary.get("kind") or "")
    if summary.get("tables") is not None or kind in ("postgres", "sql", "warehouse"):
        return f"window.{ns}.{member}.query(sql, params?) -> {{ rows, error }}"
    return f"window.{ns}.{member}.callTool(name, args) -> {{ data, error }}"


def _names_from(value: Any, limit: int) -> list[str]:
    """Pull display names out of a list of strings or ``{name: ...}`` dicts."""
    if not isinstance(value, (list, tuple)):
        return []
    names: list[str] = []
    for entry in value:
        if isinstance(entry, str):
            names.append(entry)
        elif isinstance(entry, Mapping):
            name = entry.get("name") or entry.get("slug") or entry.get("id")
            if isinstance(name, str):
                names.append(name)
        if len(names) >= limit:
            break
    return names


#: Keys a ``ConnectorSummary`` uses for itself. Everything else at the top
#: level is treated as a plugin's namespaced entry (`{"<name>": {...}}`).
_SUMMARY_RESERVED_KEYS = frozenset(
    {"kind", "kinds", "name", "prompt", "inUse", "jsName", "runtime", "runtimeCall"}
)


def _connector_entries(summary: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Every connector described by one ``ConnectorSummary``.

    Two shapes are in the wild and both are legal: a **flat** summary that
    describes one connector at the top level, and the **namespaced** form the
    reference connectors emit, where each entry hangs off the connector's own
    name (``{"kinds": ["postgres"], "rent_roll": {...}, "prompt": "..."}``).
    Protocol v1 fixes only ``kinds``; the rest is plugin-defined, so this reads
    both rather than dictating one.
    """
    entries: list[dict[str, Any]] = []
    if summary.get("name") or summary.get("kind"):
        entries.append(dict(summary))
    for key, value in summary.items():
        if key in _SUMMARY_RESERVED_KEYS or not isinstance(value, Mapping):
            continue
        if value.get("kind") or value.get("name"):
            entry = dict(value)
            entry.setdefault("name", key)
            entries.append(entry)
    return entries


def _connector_names(summary: Mapping[str, Any]) -> set[str]:
    """The names a summary answers to, for matching ``detect_used`` output."""
    names = {str(e.get("name")) for e in _connector_entries(summary) if e.get("name")}
    top = summary.get("name")
    if isinstance(top, str) and top:
        names.add(top)
    return names


def _render_entry(entry: Mapping[str, Any], ns: str) -> list[str]:
    """The composed lines for one connector that shipped no prompt of its own."""
    kinds = entry.get("kinds")
    kind = entry.get("kind") or (
        kinds[0] if isinstance(kinds, (list, tuple)) and kinds else "connector"
    )
    name = str(entry.get("name") or kind)
    member = str(entry.get("jsName") or _js_member(name))
    mode = "read-only" if entry.get("readOnly") else "read/write"

    lines = [f"  - {name}  [{kind}, {mode}]"]
    lines.append(f"      Runtime call: {_connector_runtime_call(entry, ns, member)}")

    if entry.get("connected") is False:
        reason = entry.get("error")
        detail = f" ({reason})" if isinstance(reason, str) and reason else ""
        lines.append(
            f"      NOT CONNECTED{detail} - say so rather than inventing data."
        )

    blurb = entry.get("summary") or entry.get("description")
    if isinstance(blurb, str) and blurb.strip():
        lines.append(f"      {blurb.strip()}")

    tables = _names_from(entry.get("tables"), 30)
    if tables:
        lines.append("      Tables: " + ", ".join(tables))

    tools = _names_from(entry.get("tools"), 12)
    if tools:
        lines.append("      Tools: " + ", ".join(tools))

    return lines


def render_connector_context(
    connectors: Sequence[ConnectorSummary], *, namespace: str
) -> str:
    """Render the connector chips + their prompt lines into the prompt.

    A connector that supplies its own ``prompt`` text has it rendered
    **verbatim** - it knows its tables, its tools, and its quirks better than
    this module ever will, and a connector's prompt lines ship with the
    connector so the two cannot drift. Anything without a ``prompt`` is
    composed from the structured keys instead: ``name``, ``kind`` (or the first
    of ``kinds``), ``jsName``, ``summary`` / ``description``, ``readOnly``,
    ``connected`` / ``error``, ``tables``, ``tools``, and ``runtime``. All of
    them are optional; unknown keys pass through to the client untouched.
    """
    ns = _resolve_namespace(namespace)
    summaries = [c for c in (connectors or ()) if isinstance(c, Mapping)]
    if not summaries:
        return _NO_CONNECTORS

    composed: list[str] = []
    verbatim: list[str] = []
    for summary in summaries:
        own_prompt = summary.get("prompt")
        used_note = (
            "  (already called by this app's current files - keep using it)"
            if summary.get("inUse")
            else ""
        )
        if isinstance(own_prompt, str) and own_prompt.strip():
            block = own_prompt.strip()
            verbatim.append(block + (f"\n{used_note}" if used_note else ""))
            continue
        for entry in _connector_entries(summary):
            composed.extend(_render_entry(entry, ns))
            if used_note:
                composed.append(f"    {used_note.strip()}")

    if not composed and not verbatim:
        return _NO_CONNECTORS

    head = "CONNECTED DATA"
    if composed:
        head = head + "\n" + "\n".join(composed)
    return "\n\n".join([head, *verbatim])


def render_instructions(instructions: str) -> str:
    """Normalize and frame the host ``instructions`` brief for injection.

    The brief arrives as an admin typed it, usually as an indented triple
    quoted string, so it is dedented and trimmed. The framing around it is not
    decoration: without an explicit "these are requirements, and a visible rule
    means visible in the rendered UI" preamble, a model treats house rules as
    soft context and quietly drops them - a "logo top-left on every page" rule
    lands as a code comment nobody ever sees.
    """
    if not instructions:
        return ""
    body = textwrap.dedent(instructions).strip()
    if not body:
        return ""
    return f"{_INSTRUCTIONS_FRAMING}\n{body}"


def _render_files(files: Any) -> str:
    if isinstance(files, Mapping):
        paths: Iterable[str] = files.keys()
    elif isinstance(files, (list, tuple, set)):
        paths = [str(p) for p in files]
    else:
        return ""
    return "\n".join(sorted(str(p) for p in paths))


def _has_kit(files: Any) -> bool:
    """Whether the project ships the template UI kit at :data:`_KIT_PATH`."""
    if isinstance(files, Mapping):
        return _KIT_PATH in files
    if isinstance(files, (list, tuple, set, frozenset)):
        return _KIT_PATH in {str(p) for p in files}
    return False


def _render_ui_kit(files: Any, ns: str) -> str:
    """The TEMPLATE UI KIT section - only when the project actually ships it.

    The kit is a real file in the project (``/components/ui.tsx``); this block is
    its documented public contract, so the model composes the kit instead of
    re-implementing page chrome, tables, and chart cards. When ``/App.tsx`` is
    still the starter placeholder, a short first-build note is appended.
    """
    if not _has_kit(files):
        return ""
    block = _UI_KIT_BLOCK.replace("<ns>", ns)
    app = files.get("/App.tsx") if isinstance(files, Mapping) else None
    if isinstance(app, str) and _SCAFFOLD_MARKER in app:
        block += _UI_KIT_FIRST_BUILD
    return block


def _should_inline_files(files: Any) -> bool:
    """Whether every non-kit file fits the inline budget.

    Only a real file map (path -> content) can be inlined; a bare path list
    carries no contents, so it always takes the file-list path. The UI kit is
    excluded from the budget - it is documented in full under TEMPLATE UI KIT
    and shown as present, never inlined.
    """
    if not isinstance(files, Mapping):
        return False
    non_kit = [c for p, c in files.items() if p != _KIT_PATH]
    if not non_kit:
        return False
    try:
        total = sum(len(str(c)) for c in non_kit)
    except Exception:
        return False
    return total <= _INLINE_BUDGET


def _inline_files_block(files: Mapping[str, Any]) -> str:
    """Every non-kit file inlined verbatim, with the kit noted as present.

    All-or-nothing: either every non-kit file's contents are shown (so the model
    never has to guess which it must still read) or none are. The kit is shown
    as a one-line PRESENT marker, never its body - it is large, stable, fully
    documented under TEMPLATE UI KIT, and must not be read or edited.
    """
    chunks: list[str] = []
    for path in sorted(p for p in files if p != _KIT_PATH):
        chunks.append(f"--- {path} ---\n```tsx\n{files[path]}\n```")
    if _KIT_PATH in files:
        chunks.append(
            f"--- {_KIT_PATH} ---\nPRESENT. Kit file - do NOT read it and do NOT "
            "edit it. Its complete public API is documented under TEMPLATE UI KIT "
            "above; that documentation IS the contract."
        )
    return (
        "FILE CONTENTS ARE SHOWN BELOW - do NOT call read_file for them. "
        "read_file on a file printed here returns exactly what you already see "
        "and wastes a whole round trip.\n" + "\n".join(chunks)
    )


def _render_files_section(files: Any) -> str:
    """The Files portion of CURRENT PROJECT: inlined contents, or a path list.

    A small project (every non-kit file within :data:`_INLINE_BUDGET`) has its
    files inlined verbatim so the first turn can write or edit without a
    read_file round trip; a larger one is shown as just the path list, the
    signal that read_file is worth calling. The UI kit is never inlined, but its
    path still appears in the list form.
    """
    if _should_inline_files(files):
        return _inline_files_block(files)
    file_list = _render_files(files)
    if not file_list:
        return ""
    return (
        "Files (contents NOT shown - call read_file(path) to view one):\n"
        + file_list
    )


def _render_project(ctx: Mapping[str, Any]) -> str:
    """The CURRENT PROJECT section: the project's files and declared deps.

    Small projects inline every non-kit file's contents so the first turn can
    write or edit without a read_file round trip; larger ones list the paths and
    lean on read_file. Either way the template id and any extra dependencies are
    named so the model knows what it is starting from.
    """
    files = ctx.get("files")
    template = ctx.get("template")
    deps = ctx.get("dependencies")

    files_block = _render_files_section(files)
    if not files_block and not template and not deps:
        return ""

    lines = ["CURRENT PROJECT"]
    if template:
        lines.append(f"Template: {template}")
    lines.append(files_block or "Files: (empty project - write /index.tsx first)")
    if isinstance(deps, Mapping) and deps:
        rendered = ", ".join(f"{k}@{v}" for k, v in sorted(deps.items()))
        lines.append(f"Installed beyond the always-available set: {rendered}")
    return "\n".join(lines)


def _flag_used(
    connectors: Sequence[ConnectorSummary], used: Any
) -> list[ConnectorSummary]:
    """Mark the connectors a static scan found in the project's current files.

    ``ConnectorProvider.detect_used`` reports which sources the app already
    calls; saying so in the prompt keeps the agent editing the connection it
    is already on instead of quietly switching to another one.
    """
    entries = [c for c in connectors if isinstance(c, Mapping)]
    if not isinstance(used, (list, tuple, set, frozenset)) or not used:
        return entries
    used_names = {str(u) for u in used}
    return [
        {**dict(c), "inUse": True} if _connector_names(c) & used_names else c
        for c in entries
    ]


def _render_language(lang: Any) -> str:
    if not isinstance(lang, str) or not lang.strip():
        return ""
    base = lang.split("-")[0].lower()
    if base in ("", "en"):
        return ""
    name = _LANGUAGE_NAMES.get(base, base)
    return (
        "USER LANGUAGE\n"
        f"- The user writes in {name}. Reply in {name} and write every piece of "
        f"user-facing copy in the app in {name}, unless the user asks otherwise. "
        "Keep code identifiers, table and field names, and API names unchanged."
    )


# ---------------------------------------------------------------------------
# The assembler
# ---------------------------------------------------------------------------


def build_system_prompt(
    *,
    namespace: str = "app",
    instructions: str = "",
    tools: Optional[Sequence[AgentTool]] = None,
    connectors: Optional[Sequence[ConnectorSummary]] = None,
    plan_mode: bool = False,
    ctx: Optional[Mapping[str, Any]] = None,
) -> str:
    """Assemble the full system prompt for one turn.

    Section order is deliberate. The host brief comes first, where a model
    weights it most heavily and where it is byte-identical on every turn, which
    keeps the cached prefix long. The turn-specific parts - connectors, the
    file list - come last, so a change to them invalidates as little of that
    prefix as possible.

    In plan mode the tool sections are omitted entirely: the loop offers
    ``tools=None`` that turn, and describing tools the model cannot call is how
    it ends up narrating a build it never performed.
    """
    ns = _resolve_namespace(namespace)
    context: Mapping[str, Any] = dict(ctx or {})
    has_connectors = bool(connectors)
    inline_files = _should_inline_files(context.get("files"))

    sections: list[str] = []

    brief = render_instructions(instructions)
    if brief:
        sections.append(brief)

    sections.append(_BASE.replace("<ns>", ns))
    sections.append(_libraries_block())
    sections.append(_HARD_RULES)
    sections.append(_STYLING_GOTCHAS)

    kit = _render_ui_kit(context.get("files"), ns)
    if kit:
        sections.append(kit)

    if not plan_mode:
        tool_block = _render_tools(tools, context)
        if tool_block:
            sections.append(tool_block)
        sections.append(
            _TOOL_DISCIPLINE_INLINE if inline_files else _TOOL_DISCIPLINE
        )

    if has_connectors:
        sections.append(_RUNTIME_API.replace("<ns>", ns))
    sections.append(
        render_connector_context(
            _flag_used(connectors or (), context.get("used_connectors")),
            namespace=ns,
        )
    )
    if has_connectors:
        sections.append(_DATA_DISCIPLINE)

    if plan_mode:
        sections.append(_PLAN_MODE)
    else:
        sections.append(_WORKFLOW)

    project = _render_project(context)
    if project:
        sections.append(project)

    language = _render_language(context.get("lang") or context.get("language"))
    if language:
        sections.append(language)

    return "\n\n".join(section.strip() for section in sections if section.strip()) + "\n"
