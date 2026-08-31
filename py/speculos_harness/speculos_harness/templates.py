"""Starter scaffolds and the one list of libraries the agent may import.

Two things live here, and they are both single-source-of-truth data:

* :data:`TEMPLATES` - the starter file maps a new project is seeded from.
  ``react-ts`` is the default (an ``/index.tsx`` entry plus a placeholder
  ``/App.tsx``) and ``blank`` is the bare minimum that still bundles. A
  template is only a starting point: the agent replaces it on the first turn.
* :data:`LIBRARIES` - the packages the system prompt promises are always
  importable. The bundler image bakes exactly this set, and
  :mod:`speculos_harness.prompt` renders its LIBRARIES block from it, so the
  prompt can never promise a package the bundler cannot resolve. Anything
  outside the set is added on demand through ``install_package``.

Because the bundler is a container and not Python, its baked
``base-package.json`` is generated from :data:`BASE_DEPENDENCIES`::

    python -m speculos_harness.templates > base-package.json

Keeping the image and the prompt on one list is the whole point: a promise the
build service cannot honor produces a broken app and a confused agent.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping, Optional

from .interfaces import FileMap

__all__ = [
    "Library",
    "LIBRARIES",
    "BASE_DEPENDENCIES",
    "base_package_json",
    "Template",
    "TEMPLATES",
    "TEMPLATE_IDS",
    "DEFAULT_TEMPLATE",
    "get_template",
]


# ---------------------------------------------------------------------------
# The promised library set
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Library:
    """One package that is always available to generated apps.

    ``version`` is what the bundler image installs; ``purpose`` and
    ``guidance`` are what the system prompt says about it. They travel
    together so the promise and the install can never drift.
    """

    #: npm package name, exactly as it is imported.
    name: str
    #: The semver range baked into the bundler image.
    version: str
    #: One line: what this package is for.
    purpose: str
    #: One line of usage guidance rendered into the prompt. May be empty.
    guidance: str = ""


#: The complete promised set, in the order the prompt lists them. React comes
#: first because it is the runtime; the rest are the four things an internal
#: tool almost always needs, and each one exists to stop the model
#: hand-rolling something worse (SVG axes, bespoke table sorting, date math).
LIBRARIES: tuple[Library, ...] = (
    Library(
        name="react",
        version="^19.0.0",
        purpose="the app runtime",
        guidance="Function components and hooks only. No class components.",
    ),
    Library(
        name="react-dom",
        version="^19.0.0",
        purpose="mounts the app",
        guidance='createRoot(document.getElementById("root")!).render(<App />) in /index.tsx.',
    ),
    Library(
        name="recharts",
        version="^2.15.0",
        purpose="every chart",
        guidance=(
            "<BarChart>, <LineChart>, <AreaChart>, <PieChart>, <ComposedChart>, "
            "<ScatterChart> inside <ResponsiveContainer>, with <Tooltip>, "
            "<Legend>, <XAxis>, <YAxis>."
        ),
    ),
    Library(
        name="@tanstack/react-table",
        version="^8.20.0",
        purpose="any sortable, filterable, or paginated table",
        guidance="useReactTable + flexRender for headers and rows.",
    ),
    Library(
        name="date-fns",
        version="^4.1.0",
        purpose="date parsing, formatting, and ranges",
        guidance="format(d, 'MMM d'), differenceInDays, startOfWeek.",
    ),
    Library(
        name="lucide-react",
        version="^0.460.0",
        purpose="icons",
        guidance="<ChevronDown size={16} />, <Filter />, <Download />.",
    ),
)

#: ``name -> semver range`` for the whole promised set. The bundler image bakes
#: this; a startup self-check asserts every entry resolves.
BASE_DEPENDENCIES: Mapping[str, str] = MappingProxyType(
    {lib.name: lib.version for lib in LIBRARIES}
)


def base_package_json(*, indent: int = 2) -> str:
    """Render :data:`BASE_DEPENDENCIES` as the bundler image's package.json.

    The container build pipes this into ``base-package.json`` so the image and
    the prompt's LIBRARIES block come from one list.
    """
    return json.dumps(
        {
            "name": "harness-bundler-base",
            "private": True,
            "dependencies": dict(BASE_DEPENDENCIES),
        },
        indent=indent,
        sort_keys=True,
    )


# ---------------------------------------------------------------------------
# Starter templates
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Template:
    """A starter project: its file map and its declared dependencies.

    Mapping-style access (``tpl["files"]``) works alongside attribute access so
    a caller that treats the template as a JSON object - a store seeding a new
    project row, say - does not have to know it is a dataclass.
    """

    #: Stable id, as stored on ``Project.template`` and sent on the wire.
    id: str
    #: Short human label for a template picker.
    label: str
    #: One line describing what the scaffold contains.
    description: str
    #: The starter file map: absolute-ish path -> source.
    files: FileMap
    #: Declared dependencies beyond the baked base set. Usually empty: the
    #: promised libraries are already resolvable without being declared.
    dependencies: Mapping[str, str] = MappingProxyType({})

    def __getitem__(self, key: str) -> Any:
        try:
            return getattr(self, key)
        except AttributeError as exc:  # pragma: no cover - defensive
            raise KeyError(key) from exc

    def get(self, key: str, default: Any = None) -> Any:
        """Mapping-style read with a default."""
        return getattr(self, key, default)

    def as_dict(self) -> dict[str, Any]:
        """A plain JSON-ready dict of the template."""
        return {
            "id": self.id,
            "label": self.label,
            "description": self.description,
            "files": dict(self.files),
            "dependencies": dict(self.dependencies),
        }


#: The pre-built UI kit shipped in every new ``react-ts`` project as
#: ``/components/ui.tsx``. The agent COMPOSES it - page chrome, stat tiles,
#: chart cards, a sortable/searchable/paginated table, and the
#: loading/error/empty states - instead of hand-rolling them, which roughly
#: halves first-build output and wall time and removes a recurring
#: doesn't-compile failure. Kept as a real ``.tsx`` asset so it stays editable
#: and lintable; its public contract is the TEMPLATE UI KIT block in
#: :mod:`speculos_harness.prompt` - keep the two in sync.
_UI_KIT = (
    Path(__file__).resolve().parent / "template_assets" / "ui.tsx"
).read_text(encoding="utf-8")


_REACT_TS_INDEX = """\
import { createRoot } from "react-dom/client"
import App from "./App"

createRoot(document.getElementById("root")!).render(<App />)
"""

# The placeholder the user sees for the few seconds between opening a new
# project and the agent's first write. It has to bundle with zero installs, so
# it uses nothing but react and utility classes.
_REACT_TS_APP = """\
export default function App() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 h-12 w-12 rounded-2xl bg-slate-900" />
        <h1 className="text-xl font-semibold text-slate-900">
          Your app will render here
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          Describe what you want in the chat. The agent writes the files, this
          preview rebuilds on every change, and there is no run button.
        </p>
      </div>
    </div>
  )
}
"""

_BLANK_INDEX = """\
import { createRoot } from "react-dom/client"

createRoot(document.getElementById("root")!).render(
  <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">
    Empty project
  </div>
)
"""


#: The starter scaffolds, keyed by the id stored on ``Project.template``.
TEMPLATES: dict[str, Template] = {
    "react-ts": Template(
        id="react-ts",
        label="React + TypeScript",
        description=(
            "An /index.tsx entry, a placeholder /App.tsx, and a "
            "/components/ui.tsx UI kit. The default."
        ),
        files=MappingProxyType(
            {
                "/index.tsx": _REACT_TS_INDEX,
                "/App.tsx": _REACT_TS_APP,
                "/components/ui.tsx": _UI_KIT,
            }
        ),
    ),
    "blank": Template(
        id="blank",
        label="Blank",
        description="A single /index.tsx that mounts an empty screen.",
        files=MappingProxyType({"/index.tsx": _BLANK_INDEX}),
    ),
}

#: The template ids, in menu order.
TEMPLATE_IDS: tuple[str, ...] = tuple(TEMPLATES)

#: What an unnamed (or unknown) template resolves to.
DEFAULT_TEMPLATE = "react-ts"


def get_template(name: Optional[str] = None) -> Template:
    """Return the starter template ``name``, or the default.

    An unknown name falls back to :data:`DEFAULT_TEMPLATE` rather than raising:
    a typo in a template id should give someone a working project, not a 500
    on project creation. Callers that need strictness can test membership in
    :data:`TEMPLATES` first.
    """
    return TEMPLATES.get(name or DEFAULT_TEMPLATE, TEMPLATES[DEFAULT_TEMPLATE])


if __name__ == "__main__":  # pragma: no cover - image build helper
    print(base_package_json())
