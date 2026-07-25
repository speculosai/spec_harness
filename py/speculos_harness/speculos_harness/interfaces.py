"""Adapter interfaces for Speculos Harness.

These are the Python 1:1 mirror of the TypeScript interfaces that live in
`@speculos-harness/protocol`. The wire *data* types (SSE event payloads,
``Project``, ``Snapshot``, capabilities, ``ConnectorSummary``) are generated
from a single zod source; the *behavioral* interfaces below (methods, async
iterables, abort signals - things JSON Schema cannot express) are
hand-maintained 1:1 in both languages, guarded by a signature-drift check and
the shared conformance suite every reference adapter must pass.

Every interface has a shipped OSS default, so the core boots with zero
configuration.

Design decisions encoded directly in these signatures:

* ``AgentTool`` **co-locates** schema + availability + prompt fragment +
  executor, so a tool and the prompt text that describes it move as one unit
  and cannot drift.
* ``LLMProvider.stream(..., tools)`` accepts ``list[ToolSchema] | None`` and
  MUST be passed ``None`` (never ``[]``) in plan mode - some providers reject
  an empty tools array.
* ``ProjectStore.put_files`` is full-replace and transactional, with
  snapshots owned by the *agent* rather than the store, so a naive adapter
  cannot silently corrupt a project.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import (
    Any,
    AsyncIterable,
    Awaitable,
    Literal,
    Mapping,
    Optional,
    Protocol,
    Sequence,
    Union,
    runtime_checkable,
)

__all__ = [
    # Aliases / value types
    "FileMap",
    "ToolSchema",
    "ChatMessage",
    "Project",
    "NewProject",
    "Snapshot",
    "SnapshotDetail",
    "ConnectorSummary",
    "LLMCallConfig",
    "ToolContext",
    "RuntimeContext",
    "TokenUsage",
    "GenerationEvent",
    "BundleResult",
    "BundlerCaps",
    "LLMDelta",
    "TextDelta",
    "ToolCallDelta",
    "ToolResult",
    # Identity
    "Principal",
    "AuthDenied",
    "AuthProvider",
    # Providers
    "LLMProvider",
    "Bundler",
    "PackageInstaller",
    "ProjectStore",
    "AgentTool",
    "ConnectorProvider",
    "TelemetrySink",
]


# ---------------------------------------------------------------------------
# Value types - the shapes the generated wire models formalize
# ---------------------------------------------------------------------------
# TODO: replace these permissive aliases with pydantic models generated
# from the protocol JSON Schema, so they cannot drift from the TS source.

#: "/index.tsx" -> source. The whole file map for a project.
FileMap = Mapping[str, str]

#: An OpenAI function-tool schema: {"type": "function", "function": {...}}.
ToolSchema = Mapping[str, Any]

#: A single message in OpenAI chat shape, plus the optional custom content
#: part ``attachment_csv`` (readers MUST also accept the legacy alias
#: ``speculos_csv``). Plan-mode choices ride as a fenced ``harness-choices``
#: JSON block (legacy alias ``speculos-choices`` accepted on read).
ChatMessage = Mapping[str, Any]

#: The minimal Project schema: {id, name, template, files?, dependencies,
#: messages, createdBy?, updatedAt, connections?}. Host-owned extras live in
#: an opaque ``meta`` and are not part of the contract.
Project = Mapping[str, Any]

#: Input to ``ProjectStore.create_project``.
NewProject = Mapping[str, Any]

#: A version-timeline entry: {id, messageIndex, createdAt, kind}.
Snapshot = Mapping[str, Any]

#: A snapshot with its captured files and messages inlined.
SnapshotDetail = Mapping[str, Any]

#: Plugin-contributed connector summary (chip UI + prompt context). Extensible;
#: each connector kind defines its own namespaced entry, never protocol v1.
ConnectorSummary = Mapping[str, Any]

#: Per-call LLM configuration resolved by ``LLMProvider.config_for``.
LLMCallConfig = Mapping[str, Any]

#: Context handed to an ``AgentTool.execute`` / ``available`` / ``prompt_fragment``.
ToolContext = Mapping[str, Any]

#: Context handed to ``ConnectorProvider.handle`` for a runtime bridge RPC.
RuntimeContext = Mapping[str, Any]


@dataclass(frozen=True)
class TokenUsage:
    """Token accounting for one generation.

    Cache reads and writes are reported separately from fresh input tokens
    because providers bill them differently.
    """

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0


@dataclass(frozen=True)
class GenerationEvent:
    """The event passed to ``TelemetrySink.on_generation`` after each turn."""

    model: str
    usage: TokenUsage
    principal: "Principal"
    latency_ms: float


# ---- Bundler result shapes -------------------------------------------------

#: ``{"code": str, "css": str}`` on success (HTTP 200) or ``{"error": str}``
#: on a build failure (HTTP 422).
BundleResult = Mapping[str, Any]


@dataclass(frozen=True)
class BundlerCaps:
    """Static capabilities advertised by a :class:`Bundler`."""

    location: Literal["server", "browser"]
    supports_install: bool
    jsx_runtime: Literal["automatic", "classic"]


# ---- LLM streaming deltas --------------------------------------------------


@dataclass(frozen=True)
class TextDelta:
    """A chunk of assistant text."""

    text_delta: str


@dataclass(frozen=True)
class ToolCallDelta:
    """A chunk of a streaming tool call.

    ``id`` and ``name`` may be unknown on the first deltas; ``args_delta`` is a
    partial JSON string that concatenates across deltas for the same ``index``.
    """

    index: int
    id: Optional[str] = None
    name: Optional[str] = None
    args_delta: Optional[str] = None


#: One item yielded by :meth:`LLMProvider.stream`.
LLMDelta = Union[TextDelta, ToolCallDelta]


@dataclass(frozen=True)
class ToolResult:
    """The value an :class:`AgentTool.execute` returns.

    ``ok`` follows the wire convention: success is ``ok is not False`` (a
    result with no ``ok`` key still counts as success). Any extra keys are
    passed through to the ``tool-result`` SSE event's ``output``.
    """

    ok: bool = True
    extra: Mapping[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Identity / auth
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Principal:
    """The resolved caller. Follows the request everywhere.

    ``scope`` tags every downstream decision: which projects the user sees,
    how their token usage is attributed in telemetry, and what their data
    connectors are allowed to touch.
    """

    user_id: str
    can_edit: bool
    scope: Optional[Mapping[str, str]] = None
    is_viewer: bool = False


@dataclass(frozen=True)
class AuthDenied:
    """A typed, in-band denial for an authenticated-but-blocked caller.

    Returning this (instead of raising around the abstraction) is how a
    billing gate expresses "we know who you are, but you can't do this" -
    e.g. ``AuthDenied(status=402, message="upgrade required")``.
    """

    status: Literal[401, 402, 403]
    message: Optional[str] = None
    deny: Literal[True] = True


@runtime_checkable
class AuthProvider(Protocol):
    """Turn an inbound request into a caller. Replaces a bespoke auth gate.

    Default: a single-user provider that always allows and returns
    ``Principal(user_id="local", can_edit=True)``.
    """

    async def resolve(
        self, request: Any
    ) -> Union[Principal, AuthDenied, None]:
        """Resolve the request.

        Returns a :class:`Principal` when allowed, an :class:`AuthDenied` for a
        typed denial (402/403/…), or ``None`` for a plain 401.
        """
        ...


# ---------------------------------------------------------------------------
# LLM provider
# ---------------------------------------------------------------------------


@runtime_checkable
class LLMProvider(Protocol):
    """The model layer. Reference impl: :class:`speculos_harness.llm.LiteLLMProvider`."""

    def config_for(
        self, ctx: Mapping[str, Any]
    ) -> LLMCallConfig:
        """Resolve the per-call config.

        ``ctx`` carries ``requested_model`` (optional per-turn override, honored
        only if allowed) and ``principal``. Returns at least ``model`` plus
        optional ``api_key``, ``api_base``, ``supports_prompt_cache``, and
        provider ``extra``.
        """
        ...

    def allowed_models(self, principal: Principal) -> Sequence[str]:
        """The model picker's menu for this principal.

        OPTIONAL. Populates ``/capabilities`` ``models``. Omit (or return the
        single default) to hide the picker.
        """
        ...

    def stream(
        self,
        messages: Sequence[ChatMessage],
        tools: Optional[Sequence[ToolSchema]],
        cfg: LLMCallConfig,
        signal: Any,
    ) -> AsyncIterable[LLMDelta]:
        """Stream a completion as :class:`LLMDelta` items.

        ``tools`` MUST be ``None`` (never ``[]``) in plan mode - some providers
        reject an empty tools array. ``signal`` is an abort handle the agent
        loop uses to cancel in flight.
        """
        ...

    def is_context_window_error(self, err: BaseException) -> bool:
        """Whether ``err`` is a context-window overflow.

        Drives the shrink-and-retry path: on ``True`` the loop trims history
        and retries rather than surfacing an error.
        """
        ...

    def route_for(self, ctx: Mapping[str, Any]) -> Optional[str]:
        """Pick a model for one task. OPTIONAL: the open seam for routing.

        ``ctx`` carries ``task`` (``"plan" | "build" | "analyze"``) and
        ``principal``. Only consulted when the user has not explicitly picked a
        model; an explicit per-turn ``model`` always wins, and the routed choice
        must come from ``allowed_models``. Implement it and ``/capabilities``
        advertises ``routing: true``.

        The hook is yours to implement. Speculos's ready-made routing policy is
        a closed-beta module (https://speculos.ai/enterprise).
        """
        ...


# ---------------------------------------------------------------------------
# Sandbox / bundler
# ---------------------------------------------------------------------------


@runtime_checkable
class Bundler(Protocol):
    """Turns ``{files, deps}`` into browser-ready ``{code, css}``.

    Usually a client for the ``@speculos-harness/bundler`` sidecar container.
    A browser-side (esbuild-wasm) implementation is on the core roadmap: it
    ships once a shared bundler conformance suite proves parity with the
    sidecar, and until then ``/capabilities`` advertises server bundling.
    """

    async def bundle(
        self,
        files: FileMap,
        deps: Mapping[str, str],
        signal: Any = None,
    ) -> BundleResult:
        """Bundle a project. ``{code, css}`` on success or ``{error}`` on failure."""
        ...

    @property
    def caps(self) -> BundlerCaps:
        """Static capabilities: location, install support, JSX runtime."""
        ...


@runtime_checkable
class PackageInstaller(Protocol):
    """Installs a package into the bundler's resolution root.

    Only meaningful when ``Bundler.caps.supports_install`` is true.
    """

    async def install(
        self, name: str, version: Optional[str] = None
    ) -> Mapping[str, Any]:
        """Install ``name``. Returns ``{ok, error?}``. MUST keep ``--ignore-scripts``."""
        ...


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


@runtime_checkable
class ProjectStore(Protocol):
    """Project / file / history / snapshot persistence.

    Replaces a remote-storage HTTP hop with a local interface. Reference impls:
    :class:`speculos_harness.stores.SQLiteProjectStore` and
    :class:`speculos_harness.stores.FsProjectStore`.

    The snapshot methods (``create_snapshot`` / ``list_snapshots`` /
    ``get_snapshot``) are OPTIONAL: when a store omits them, ``/capabilities``
    omits snapshot support and the version timeline / rollback UI hides itself.
    Both reference stores implement them.
    """

    async def get_project(self, id: str) -> Optional[Project]: ...

    async def create_project(self, input: NewProject) -> Project: ...

    async def patch_project(
        self, id: str, patch: Mapping[str, Any]
    ) -> None: ...

    async def get_files(self, id: str) -> FileMap: ...

    async def put_files(self, id: str, files: FileMap) -> None:
        """FULL REPLACE, transactional.

        The whole file map is swapped atomically - partial writes must never be
        observable, and the agent (not the store) owns pre-turn snapshots.
        """
        ...

    async def get_messages(self, id: str) -> Sequence[ChatMessage]: ...

    async def save_messages(
        self, id: str, messages: Sequence[ChatMessage]
    ) -> None:
        """Persist the full message list. Called before the stream, per tool,
        at ``done``, and in the loop's ``finally``."""
        ...

    # ---- OPTIONAL snapshot surface (version timeline / rollback) ----------

    async def create_snapshot(
        self, id: str, s: Mapping[str, Any]
    ) -> Snapshot:
        """Optional. ``s`` carries ``messageIndex``, ``kind``
        (``"pre-turn" | "undo"``), ``files``, and optional ``messages``."""
        ...

    async def list_snapshots(self, id: str) -> Sequence[Snapshot]:
        """Optional. Pre-turn snapshots only; keep ~30."""
        ...

    async def get_snapshot(
        self, id: str, snapshot_id: str
    ) -> Optional[SnapshotDetail]:
        """Optional. A snapshot with its ``files`` and ``messages`` inlined."""
        ...


# ---------------------------------------------------------------------------
# Agent tool registry (schema + executor + prompt + availability, co-located)
# ---------------------------------------------------------------------------


@runtime_checkable
class AgentTool(Protocol):
    """One tool the agent can call, with everything it needs co-located.

    Built-ins: ``write_file``, ``edit_file`` (match-exactly-once), ``read_file``,
    ``delete_file``, ``install_package`` - see
    :mod:`speculos_harness.tools.files`.
    """

    #: Stable tool name, as sent on the wire.
    name: str

    #: OpenAI function-tool schema.
    schema: ToolSchema

    #: When true (write/edit/delete/install), a successful result makes the
    #: client bump ``fileSig`` and rebuild the preview.
    mutates_files: bool

    def available(self, ctx: ToolContext) -> bool:
        """Optional. When ``False``, the tool is pruned from the offered set."""
        ...

    def prompt_fragment(self, ctx: ToolContext) -> str:
        """Optional. Text injected into the system prompt - the tool and the
        prompt that describes it move as one unit."""
        ...

    async def execute(
        self, args: Mapping[str, Any], ctx: ToolContext
    ) -> Mapping[str, Any]:
        """Run the tool. Success is ``result.get("ok") is not False``."""
        ...


# ---------------------------------------------------------------------------
# Connector provider (optional plugin: data + tools + prompt + runtime bridge)
# ---------------------------------------------------------------------------


@runtime_checkable
class ConnectorProvider(Protocol):
    """A data source, bundled as one plugin.

    Reference impls are exposed as factories:
    ``postgres_connector(dsn=...)`` and ``mcp_connector(url=...)``. Connectors
    resolve per-request against the ``Principal`` scope, so two tenants on the
    same connector list see only their own data.
    """

    async def list(
        self, scope: Optional[Mapping[str, str]] = None
    ) -> ConnectorSummary:
        """The chip UI + prompt context for this connector, scoped to the caller."""
        ...

    def detect_used(self, files: FileMap) -> Sequence[str]:
        """Optional. Static scan of file contents for which connectors are used."""
        ...

    def tools(self) -> Sequence[AgentTool]:
        """Optional. The agent tools this connector contributes
        (``list_tables`` / ``call_app_tool`` / ...)."""
        ...

    async def handle(
        self, kind: str, payload: Any, ctx: RuntimeContext
    ) -> Any:
        """The parent side of a ``window.<ns>`` runtime RPC from the preview."""
        ...

    def shim(self, summary: ConnectorSummary, ns: str) -> str:
        """Optional. The in-iframe resolver contribution (JS source string)."""
        ...


# ---------------------------------------------------------------------------
# Telemetry (no-op default)
# ---------------------------------------------------------------------------


@runtime_checkable
class TelemetrySink(Protocol):
    """Metering / analytics hooks. Default: no-op.

    Both methods are optional. ``on_generation`` fires after every generation
    with the model, token usage, principal, and latency; ``on_event`` is a
    generic named event with arbitrary props.
    """

    def on_generation(self, e: GenerationEvent) -> None: ...

    def on_event(self, name: str, props: Mapping[str, Any]) -> None: ...
