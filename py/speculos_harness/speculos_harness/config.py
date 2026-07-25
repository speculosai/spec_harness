"""``HarnessAgent`` - assemble the adapters and expose the mountable router.

This is the one object an integrator constructs. It holds the configured
adapters (store, LLM, auth, connectors, bundler, telemetry) and builds a
:class:`fastapi.APIRouter` that speaks the versioned Harness wire protocol.

Mount it under any prefix and every route in the protocol is registered.
"""

from __future__ import annotations

from typing import Any, Optional, Sequence

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .interfaces import (
    AgentTool,
    AuthProvider,
    ConnectorProvider,
    LLMProvider,
    ProjectStore,
    TelemetrySink,
)

#: The advertised wire-protocol integer. Sent/consumed as ``Harness-Protocol``.
PROTOCOL_VERSION = 1

_NOT_IMPL = {"error": "not implemented"}


def _not_implemented() -> JSONResponse:
    """The uniform 501 body, returned where a handler is pending."""
    return JSONResponse(status_code=501, content=_NOT_IMPL)


class HarnessAgent:
    """The configured agent: adapters in, a mountable router out.

    Args:
        store: Project/file/history/snapshot persistence. Required.
        llm: The model provider. Required.
        auth: Turns a request into a ``Principal``. Defaults to a single-user
            provider that always allows.
        connectors: Optional data-source plugins. Omit for file/package tools
            only.
        instructions: Org-wide build brief injected into the system prompt on
            every turn (currency, fiscal year, house rules, design system).
        bundler_url: Base URL of the ``@speculos-harness/bundler`` sidecar.
        namespace: The runtime namespace bound in the prompt, generated code,
            and the preview bridge (``window.<ns>`` + ``<ns>-*`` messages).
            MUST match the frontend. Defaults to ``"app"``.
        tools: Extra :class:`AgentTool` s appended to the built-ins.
        telemetry: Metering / analytics sink. Defaults to no-op.
    """

    def __init__(
        self,
        store: ProjectStore,
        llm: LLMProvider,
        *,
        auth: Optional[AuthProvider] = None,
        connectors: Optional[Sequence[ConnectorProvider]] = None,
        instructions: str = "",
        bundler_url: Optional[str] = None,
        namespace: str = "app",
        tools: Optional[Sequence[AgentTool]] = None,
        telemetry: Optional[TelemetrySink] = None,
    ) -> None:
        self.store = store
        self.llm = llm
        # TODO: default to single_user() - an AuthProvider that always
        # returns Principal(user_id="local", can_edit=True).
        self.auth = auth
        self.connectors: Sequence[ConnectorProvider] = tuple(connectors or ())
        self.instructions = instructions
        self.bundler_url = bundler_url
        self.namespace = namespace
        self.tools: Sequence[AgentTool] = tuple(tools or ())
        self.telemetry = telemetry
        self._router: Optional[APIRouter] = None

    @property
    def router(self) -> APIRouter:
        """The FastAPI router to mount under your chosen prefix.

        Registers the six route groups of the Harness wire protocol. Built
        lazily and cached, so ``agent.router`` is stable across accesses.
        """
        if self._router is None:
            self._router = self._build_router()
        return self._router

    # -- route registration --------------------------------------------------

    def _build_router(self) -> APIRouter:
        router = APIRouter()

        # ---- 1. Chat (SSE) -------------------------------------------------
        @router.post("/chat")
        async def chat(request: Request) -> Any:  # noqa: ANN401
            """Run one agent turn and stream the result as hand-rolled SSE.

            TODO: resolve the principal via ``auth``, load the project +
            history from ``store``, build the system prompt (``prompt.py``) with
            ``instructions`` injected, take a pre-turn snapshot, then run the
            agent loop (``loop.py``) - up to N steps of ``llm.stream(...)``,
            executing tools server-side and re-emitting the seven Harness events
            (``user-message``, ``text-delta``, ``tool-call-delta``,
            ``tool-call``, ``tool-result``, ``error``, ``done``) via
            ``sse.py``. Plan mode passes ``tools=None`` (never ``[]``).
            """
            return _not_implemented()

        # ---- 2. Bundle (proxy + connector scoping) -------------------------
        @router.post("/bundle/{project_id}")
        async def bundle(project_id: str, request: Request) -> Any:  # noqa: ANN401
            """Bundle a project's files and return ``{code, css, connectors?}``.

            TODO: read the project's files/deps from ``store``, proxy
            ``{files, deps}`` to the bundler at ``bundler_url``, and attach the
            scoped ``ConnectorSummary`` from ``ConnectorProvider.list`` +
            ``detect_used``. Returns 200 ``{code, css}`` or 422 ``{error}``.
            """
            return _not_implemented()

        # ---- 3. Projects ---------------------------------------------------
        @router.get("/projects")
        async def list_projects(request: Request) -> Any:  # noqa: ANN401
            """List the caller's projects (scoped to their ``Principal``).

            TODO: back onto ``store`` with principal-scoped filtering.
            """
            return _not_implemented()

        @router.post("/projects")
        async def create_project(request: Request) -> Any:  # noqa: ANN401
            """Create a project from a ``NewProject`` body.

            TODO: ``store.create_project(...)``; seed from a starter
            template when one is named.
            """
            return _not_implemented()

        @router.get("/projects/{project_id}")
        async def get_project(project_id: str, request: Request) -> Any:  # noqa: ANN401
            """Fetch one project over the minimal ``Project`` schema.

            TODO: ``store.get_project(...)``; 404 when missing or
            out-of-scope.
            """
            return _not_implemented()

        @router.patch("/projects/{project_id}")
        async def patch_project(project_id: str, request: Request) -> Any:  # noqa: ANN401
            """Patch project metadata (name, dependencies, ...).

            TODO: ``store.patch_project(...)``.
            """
            return _not_implemented()

        # ---- 4. Snapshots (version timeline + rollback) --------------------
        @router.get("/projects/{project_id}/snapshots")
        async def list_snapshots(project_id: str, request: Request) -> Any:  # noqa: ANN401
            """List pre-turn snapshots: ``[{id, messageIndex, createdAt, kind}]``.

            TODO: ``store.list_snapshots(...)`` when the store implements
            the optional snapshot surface; otherwise this route is not
            advertised in ``/capabilities``.
            """
            return _not_implemented()

        @router.post("/projects/{project_id}/rollback")
        async def rollback(project_id: str, request: Request) -> Any:  # noqa: ANN401
            """Restore a snapshot and return ``{ok, messageIndex, undoSnapshotId}``.

            TODO: take an undo snapshot of the current state, then
            full-replace files + messages from the target snapshot via ``store``.
            """
            return _not_implemented()

        # ---- 5. Capabilities ----------------------------------------------
        @router.get("/capabilities")
        async def capabilities(request: Request) -> Any:  # noqa: ANN401
            """Advertise what this backend supports, for client negotiation.

            TODO: return ``{protocol, namespace, sandbox{location,
            supportsInstall, jsxRuntime}, planMode, attachments, models,
            connectors}`` - ``models`` from ``llm.allowed_models``,
            ``connectors`` from the mounted providers, ``sandbox`` from the
            bundler's caps. Clients that get a 404 assume protocol-1 defaults.
            """
            return _not_implemented()

        # ---- 6. Connector RPC ---------------------------------------------
        @router.post("/connectors/{kind}")
        async def connector(kind: str, request: Request) -> Any:  # noqa: ANN401
            """Dispatch a runtime bridge RPC to the matching connector.

            TODO: resolve the principal, find the ``ConnectorProvider`` for
            ``kind``, and return ``provider.handle(kind, payload, ctx)``. This is
            where the preview iframe's ``<ns>-*`` postMessages land after the
            React bridge forwards them. Auth-gated like every other route.
            """
            return _not_implemented()

        return router
