"""``HarnessAgent`` - assemble the adapters and expose the mountable router.

This is the one object an integrator constructs. It holds the configured
adapters (store, LLM, auth, connectors, bundler, telemetry) and builds a
:class:`fastapi.APIRouter` that speaks the versioned Harness wire protocol.

Mount it under any prefix and every route in the protocol is registered.
"""

from __future__ import annotations

from typing import Any, Iterable, Literal, Mapping, Optional, Sequence, Union

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from .interfaces import (
    AgentTool,
    AuthDenied,
    AuthProvider,
    Bundler,
    BundlerCaps,
    ConnectorProvider,
    FileMap,
    LLMProvider,
    PackageInstaller,
    Principal,
    ProjectStore,
    TelemetrySink,
)
from .loop import DEFAULT_MAX_STEPS, connector_summary, detect_used, run_turn
from .prompt import _resolve_namespace
from .templates import get_template
from .tools.files import WriteValidator, builtin_file_tools

#: The advertised wire-protocol integer. Sent/consumed as ``Harness-Protocol``.
PROTOCOL_VERSION = 1

#: The response header every route carries. A client that reads an integer it
#: was not built for surfaces a protocol mismatch instead of parsing a stream
#: it does not understand.
PROTOCOL_HEADER = "Harness-Protocol"

#: The attachment kinds this server accepts, advertised via ``/capabilities``.
ATTACHMENT_KINDS = ("image", "csv")

#: Headers on the chat stream. ``no-transform`` and the nginx-specific
#: ``X-Accel-Buffering`` both exist for the same reason: an intermediary that
#: buffers the response turns a live token stream into one delivery at the end
#: of the turn, which looks exactly like a hung server.
_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    PROTOCOL_HEADER: str(PROTOCOL_VERSION),
}

#: How long to wait on the bundler sidecar. A cold build that installs a
#: package can take a while; a client waiting on the preview would rather wait
#: than see a spurious failure.
_BUNDLE_TIMEOUT_S = 120.0

__all__ = [
    "PROTOCOL_VERSION",
    "PROTOCOL_HEADER",
    "HarnessAgent",
    "single_user",
]


# ---------------------------------------------------------------------------
# Responses
# ---------------------------------------------------------------------------


def _json(content: Any, status: int = 200) -> JSONResponse:
    """A JSON response carrying the protocol header.

    Every response in the protocol carries ``Harness-Protocol``, including
    errors - it is the handshake, and a client that only sees it on the happy
    path cannot tell "protocol 1 server said no" from "this is not a Harness
    server at all".
    """
    return JSONResponse(
        status_code=status,
        content=content,
        headers={PROTOCOL_HEADER: str(PROTOCOL_VERSION)},
    )


def _error(message: str, status: int) -> JSONResponse:
    return _json({"error": message}, status)


async def _body(request: Request) -> Optional[dict[str, Any]]:
    """Parse a JSON object body, or ``None`` when it is not one."""
    try:
        parsed = await request.json()
    except Exception:
        return None
    return dict(parsed) if isinstance(parsed, Mapping) else None


def _unique(values: Iterable[str]) -> list[str]:
    """De-duplicate while preserving first-seen order."""
    seen: dict[str, None] = {}
    for value in values:
        if value:
            seen.setdefault(str(value), None)
    return list(seen)


# ---------------------------------------------------------------------------
# The zero-configuration auth default
# ---------------------------------------------------------------------------


class _SingleUserAuth(AuthProvider):
    """Always allows, and always the same caller.

    The right default for a laptop or a single-tenant deployment: the kit boots
    and works with no auth wiring at all. It is deliberately not "no auth" in
    the router - every route still resolves a principal and scopes every
    project access to it, so putting a real :class:`AuthProvider` in front is a
    one-line change rather than an audit.
    """

    def __init__(self, user_id: str = "local", *, can_edit: bool = True) -> None:
        self._principal = Principal(user_id=user_id, can_edit=can_edit)

    async def resolve(self, request: Any) -> Principal:
        return self._principal


def single_user(user_id: str = "local", *, can_edit: bool = True) -> AuthProvider:
    """The permissive default :class:`AuthProvider`.

    Returns ``Principal(user_id="local", can_edit=True)`` for every request.
    Replace it the moment real sessions matter - see
    ``docs/adapters.md#authprovider``.
    """
    return _SingleUserAuth(user_id, can_edit=can_edit)


# ---------------------------------------------------------------------------
# The default bundler: a thin client for the sidecar container
# ---------------------------------------------------------------------------


class _SidecarBundler(Bundler):
    """A client for the ``@speculos-harness/bundler`` sidecar.

    Knows two endpoints and nothing else: ``POST /bundle`` and
    ``POST /packages/install``. The distinction it draws is the one the
    protocol cares about - a *build failure* comes back as ``{"error": ...}``
    (an expected outcome the workspace shows as "patching..." and asks the
    agent to repair), while a service that is unreachable or broken raises, so
    the route can answer 502 instead of pretending the user's code is wrong.
    """

    def __init__(self, url: str, *, timeout_s: float = _BUNDLE_TIMEOUT_S) -> None:
        self.url = str(url).rstrip("/")
        self.timeout_s = float(timeout_s)

    @property
    def caps(self) -> BundlerCaps:
        return BundlerCaps(
            location="server", supports_install=True, jsx_runtime="automatic"
        )

    async def bundle(
        self,
        files: FileMap,
        deps: Mapping[str, str],
        signal: Any = None,
    ) -> Mapping[str, Any]:
        import httpx  # imported lazily: the kit boots without a bundler

        try:
            async with httpx.AsyncClient(timeout=self.timeout_s) as client:
                response = await client.post(
                    f"{self.url}/bundle",
                    json={"files": dict(files), "deps": dict(deps or {})},
                )
        except Exception as exc:
            raise RuntimeError(f"the build service is unreachable: {exc}") from exc

        if response.status_code >= 500:
            raise RuntimeError(
                f"the build service failed (HTTP {response.status_code})"
            )
        try:
            payload = response.json()
        except Exception:
            payload = None
        if not isinstance(payload, Mapping):
            raise RuntimeError("the build service returned an unreadable response")
        if payload.get("error"):
            return {"error": str(payload["error"])}
        if "code" not in payload:
            return {"error": "the build service returned no code"}
        return {"code": payload.get("code") or "", "css": payload.get("css") or ""}

    async def install(
        self, name: str, version: Optional[str] = None
    ) -> Mapping[str, Any]:
        """Install one package through the sidecar (always ``--ignore-scripts``).

        Present so the same object satisfies :class:`PackageInstaller`; the
        ``install_package`` tool reaches it through the tool context.
        """
        import httpx  # noqa: PLC0415 - see bundle()

        body: dict[str, Any] = {"name": name}
        if version:
            body["version"] = version
        try:
            async with httpx.AsyncClient(timeout=self.timeout_s) as client:
                response = await client.post(f"{self.url}/packages/install", json=body)
            payload = response.json()
        except Exception as exc:
            return {"ok": False, "error": f"install request failed: {exc}"}
        if not isinstance(payload, Mapping):
            return {"ok": False, "error": "the build service returned no result"}
        return dict(payload)


# ---------------------------------------------------------------------------
# The agent
# ---------------------------------------------------------------------------


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
        bundler: A :class:`Bundler` adapter. Defaults to a client for
            ``bundler_url``; supply your own to bundle somewhere else.
        installer: A :class:`PackageInstaller`. Defaults to the bundler when it
            supports installs.
        write_validator: Deterministic seam invoked before a write or edit is
            persisted. Raise from it to reject the write; the model gets a
            failure result explaining why. See ``spec/security.md``, threat 2.
        package_allowlist: When set, the only packages ``install_package`` may
            add - the deterministic backstop for a prompt-injected install.
        max_steps: Cap on tool-calling iterations per turn.
        auth_mode: ``"bearer"`` (default) or ``"cookie"``. Only used for the
            CORS self-check below and :meth:`cors_options`.
        allowed_origins: The CORS origin allowlist for cross-origin embeds.

    Raises:
        ValueError: if ``namespace`` is not a legal JavaScript identifier, or
            if ``auth_mode="cookie"`` is paired with a wildcard origin. The
            second is the startup self-check ``spec/security.md`` requires:
            browsers reject ``Access-Control-Allow-Origin: *`` on credentialed
            requests, so that combination is an embed that fails silently in
            production, and refusing to boot is the only honest response.
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
        bundler: Optional[Bundler] = None,
        installer: Optional[PackageInstaller] = None,
        write_validator: Optional[WriteValidator] = None,
        package_allowlist: Optional[Sequence[str]] = None,
        max_steps: int = DEFAULT_MAX_STEPS,
        auth_mode: Literal["bearer", "cookie"] = "bearer",
        allowed_origins: Optional[Sequence[str]] = None,
    ) -> None:
        self.store = store
        self.llm = llm
        # The kit boots with zero configuration: no auth argument means a
        # single local editing user, not an unauthenticated free-for-all - every
        # route still resolves and scopes to a principal.
        self.auth: AuthProvider = auth or single_user()
        self.connectors: Sequence[ConnectorProvider] = tuple(connectors or ())
        self.instructions = instructions
        self.bundler_url = bundler_url
        # Validated here rather than on the first turn: an illegal namespace
        # produces apps that parse but never receive data, which is the single
        # most expensive failure to debug in this system.
        self.namespace = _resolve_namespace(namespace)
        self.tools: Sequence[AgentTool] = tuple(tools or ())
        self.telemetry = telemetry
        self.max_steps = int(max_steps or DEFAULT_MAX_STEPS)

        self.auth_mode: Literal["bearer", "cookie"] = auth_mode
        self.allowed_origins: Sequence[str] = tuple(allowed_origins or ())
        if auth_mode == "cookie" and "*" in self.allowed_origins:
            raise ValueError(
                "cookie auth mode cannot be combined with the wildcard CORS "
                "origin '*': browsers reject Access-Control-Allow-Origin: * on "
                "credentialed requests, so this deployment would fail silently "
                "in the browser. Use bearer mode, or list the embedding "
                "origins explicitly. See spec/security.md."
            )

        self.bundler: Optional[Bundler] = bundler or (
            _SidecarBundler(bundler_url) if bundler_url else None
        )
        self.installer: Optional[PackageInstaller] = installer or (
            self.bundler if isinstance(self.bundler, PackageInstaller) else None
        )

        # False drops `install_package` from the offered set entirely, which is
        # the honest answer when nothing can install: describing a tool the
        # deployment cannot run is how a model ends up calling it and failing.
        supports_install = bool(
            self.installer is not None
            or (self.bundler is not None and self.bundler.caps.supports_install)
        )
        #: The built-in file/package tools, constructed once so the write
        #: validator and the dependency allowlist are bound before any turn.
        self.builtin_tools: Sequence[AgentTool] = builtin_file_tools(
            write_validator=write_validator,
            supports_install=supports_install,
            bundler_url=bundler_url,
            package_allowlist=package_allowlist,
        )

        # The namespace is triple-bound (prompt, generated code, bridge). Push
        # it onto every mounted connector so a connector's shim and its prompt
        # lines cannot drift from the router's value.
        for provider in self.connectors:
            if getattr(provider, "namespace", None) is not None:
                try:
                    provider.namespace = self.namespace  # type: ignore[attr-defined]
                except Exception:
                    pass

        self._router: Optional[APIRouter] = None

    # -- helpers -------------------------------------------------------------

    def cors_options(self) -> dict[str, Any]:
        """Arguments for Starlette's ``CORSMiddleware``, matching the auth mode.

        Convenience, not a requirement - CORS is applied by the app, not the
        router, so the host installs the middleware::

            app.add_middleware(CORSMiddleware, **agent.cors_options())

        Passing the same origins and mode here as to the constructor is what
        makes the cookie-mode-with-wildcard self-check meaningful.
        """
        return {
            "allow_origins": list(self.allowed_origins),
            "allow_credentials": self.auth_mode == "cookie",
            "allow_methods": ["GET", "POST", "PATCH", "OPTIONS"],
            "allow_headers": ["authorization", "content-type"],
            "expose_headers": [PROTOCOL_HEADER],
        }

    async def _principal(
        self, request: Request
    ) -> Union[Principal, JSONResponse]:
        """Resolve the caller, or the response that denies them.

        The three outcomes of ``AuthProvider.resolve`` map straight onto the
        wire: a ``Principal`` allows, ``None`` is a plain 401, and an
        ``AuthDenied`` carries its own status - which is how a billing gate
        says 402 without raising an exception around the abstraction.
        """
        resolved = await self.auth.resolve(request)
        if resolved is None:
            return _error("unauthorized", 401)
        if isinstance(resolved, AuthDenied) or getattr(resolved, "deny", None) is True:
            status = int(getattr(resolved, "status", 403) or 403)
            message = getattr(resolved, "message", None) or "forbidden"
            return _error(str(message), status)
        return resolved

    @staticmethod
    def _visible(project: Mapping[str, Any], principal: Principal) -> bool:
        """Whether this caller may see this project.

        The default rule is ownership: a project belongs to whoever created it,
        and a project with no creator (seeded by a script, migrated in) is
        visible to everyone. Team or tenant sharing is a host decision - either
        stamp the sharing rule into ``Principal.user_id`` (the run-as-creator
        pattern a share token uses) or supply a store whose reads are already
        scoped.
        """
        owner = project.get("createdBy") or project.get("created_by")
        return not owner or str(owner) == principal.user_id

    async def _load_project(
        self, project_id: str, principal: Principal
    ) -> Union[dict[str, Any], JSONResponse]:
        """Fetch a project the caller may see, or the 404 that hides it.

        An out-of-scope project answers 404, not 403: telling a caller that a
        project they cannot see exists is itself a disclosure.
        """
        project = await self.store.get_project(project_id)
        if project is None or not self._visible(project, principal):
            return _error("project not found", 404)
        return dict(project)

    async def _connector_payload(
        self, principal: Principal, files: FileMap
    ) -> Optional[dict[str, Any]]:
        """The merged, scoped ``ConnectorSummary`` for the bundle response.

        One summary per mounted connector, merged into a single extensible
        object: ``kinds`` is unioned, each connector's own namespaced entry is
        carried through untouched, ``used`` reports what a static scan found in
        the project's current files, and ``shim`` carries each connector's
        in-iframe resolver so the preview can expose ``window.<ns>``. The
        ``prompt`` text each connector contributes is dropped here - it is
        context for the model, not for the browser.
        """
        merged: dict[str, Any] = {}
        kinds: list[str] = []
        used: list[str] = []
        shims: list[str] = []

        for provider in self.connectors:
            summary = await connector_summary(provider, principal)
            if summary is None:
                continue
            for key, value in summary.items():
                if key == "kinds":
                    kinds.extend(str(k) for k in (value or ()))
                elif key != "prompt":
                    merged[key] = value
            used.extend(detect_used(provider, files))
            shim = getattr(provider, "shim", None)
            if callable(shim):
                try:
                    contribution = shim(summary, self.namespace)
                except Exception:
                    contribution = ""
                if isinstance(contribution, str) and contribution.strip():
                    shims.append(contribution)

        if not merged and not kinds:
            return None
        if kinds:
            merged["kinds"] = _unique(kinds)
        if used:
            merged["used"] = _unique(used)
        if shims:
            merged["shim"] = "\n".join(shims)
        return merged

    def _sandbox_caps(self) -> BundlerCaps:
        """What the client should assume about bundling on this deployment."""
        if self.bundler is not None:
            return self.bundler.caps
        # No bundler configured: still server-side by location, but nothing can
        # be installed, so the client hides the on-demand install affordance.
        return BundlerCaps(
            location="server", supports_install=False, jsx_runtime="automatic"
        )

    def _has_snapshots(self) -> bool:
        return all(
            callable(getattr(self.store, name, None))
            for name in ("create_snapshot", "list_snapshots", "get_snapshot")
        )

    # -- the router ----------------------------------------------------------

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

            Resolves the principal, loads the project, then hands off to the
            agent loop, which streams the seven protocol events until the model
            stops calling tools. The response is ``text/event-stream``, unbuffered
            and uncached, and carries ``Harness-Protocol``.
            """
            # Identity first, then the body: an unauthenticated caller learns
            # nothing about which requests this server would have accepted.
            principal = await self._principal(request)
            if isinstance(principal, JSONResponse):
                return principal
            if not principal.can_edit:
                # The real boundary. The frontend's canEdit only hides the
                # composer; a viewer calling this route directly still cannot
                # make the agent write files.
                return _error("this project is read-only for you", 403)

            body = await _body(request)
            if body is None:
                return _error("a JSON object body is required", 400)

            project_id = body.get("projectId") or body.get("project_id")
            message = body.get("message")
            message = message.strip() if isinstance(message, str) else ""
            # Only the advertised kinds are accepted; anything else is dropped
            # rather than handed to the model as an unknown content part.
            attachments = [
                a
                for a in (body.get("attachments") or [])
                if isinstance(a, Mapping) and a.get("kind") in ATTACHMENT_KINDS
            ]
            if not project_id or not isinstance(project_id, str):
                return _error("projectId is required", 400)
            if not message and not attachments:
                return _error("message or attachments are required", 400)

            project = await self._load_project(project_id, principal)
            if isinstance(project, JSONResponse):
                return project

            requested_model = body.get("model")
            lang = body.get("lang")
            return StreamingResponse(
                run_turn(
                    agent=self,
                    project_id=project_id,
                    principal=principal,
                    message=message,
                    plan_mode=bool(body.get("planMode") or body.get("plan_mode")),
                    requested_model=requested_model if isinstance(requested_model, str) else None,
                    lang=lang if isinstance(lang, str) else None,
                    attachments=attachments,
                    max_steps=self.max_steps,
                ),
                media_type="text/event-stream",
                headers=dict(_SSE_HEADERS),
            )

        # ---- 2. Bundle (proxy + connector scoping) -------------------------
        @router.post("/bundle/{project_id}")
        async def bundle(project_id: str, request: Request) -> Any:  # noqa: ANN401
            """Bundle a project's files and return ``{code, css, connectors?}``.

            A build failure is a 422 with ``{error}`` - an expected, recoverable
            outcome the workspace shows as "patching..." and asks the agent to
            repair. A bundler that is unreachable is a 502: that is a fault, not
            a broken app, and conflating the two makes the agent try to fix code
            that was never wrong.
            """
            principal = await self._principal(request)
            if isinstance(principal, JSONResponse):
                return principal

            project = await self._load_project(project_id, principal)
            if isinstance(project, JSONResponse):
                return project
            if self.bundler is None:
                return _error(
                    "no bundler is configured on this deployment", 503
                )

            files = dict(await self.store.get_files(project_id))
            deps = dict(project.get("dependencies") or {})
            try:
                result = await self.bundler.bundle(files, deps)
            except Exception as exc:
                return _error(str(exc), 502)

            if not isinstance(result, Mapping) or result.get("error"):
                error = (
                    result.get("error")
                    if isinstance(result, Mapping)
                    else "the build service returned an unreadable response"
                )
                return _error(str(error), 422)

            payload: dict[str, Any] = {
                "code": result.get("code") or "",
                "css": result.get("css") or "",
            }
            connectors = await self._connector_payload(principal, files)
            if connectors:
                payload["connectors"] = connectors
            return _json(payload)

        # ---- 3. Projects ---------------------------------------------------
        @router.get("/projects")
        async def list_projects(request: Request) -> Any:  # noqa: ANN401
            """List the caller's projects (scoped to their ``Principal``).

            Returns a JSON array of projects without their files or messages -
            a list response does not carry whole projects. A store that does not
            implement the optional ``list_projects`` returns an empty list
            rather than an error: listing is additive to the protocol.
            """
            principal = await self._principal(request)
            if isinstance(principal, JSONResponse):
                return principal

            lister = getattr(self.store, "list_projects", None)
            if not callable(lister):
                return _json([])
            try:
                projects = await lister(created_by=principal.user_id)
            except TypeError:
                projects = await lister(principal.user_id)
            return _json(
                [dict(p) for p in projects if self._visible(p, principal)]
            )

        @router.post("/projects")
        async def create_project(request: Request) -> Any:  # noqa: ANN401
            """Create a project from a ``NewProject`` body.

            Seeds the file map from the named starter template unless explicit
            ``files`` are supplied. An unknown template id falls back to the
            default rather than failing - a typo should give someone a working
            project, not a 400.
            """
            principal = await self._principal(request)
            if isinstance(principal, JSONResponse):
                return principal
            if not principal.can_edit:
                return _error("you cannot create projects", 403)

            body = await _body(request) or {}
            template = get_template(
                body.get("template") if isinstance(body.get("template"), str) else None
            )
            files = body.get("files")
            files = (
                {str(k): str(v) for k, v in files.items()}
                if isinstance(files, Mapping) and files
                else dict(template.files)
            )
            deps = dict(template.dependencies)
            if isinstance(body.get("dependencies"), Mapping):
                deps.update({str(k): str(v) for k, v in body["dependencies"].items()})

            project = await self.store.create_project(
                {
                    "name": body.get("name") or "Untitled project",
                    "template": template.id,
                    "files": files,
                    "dependencies": deps,
                    "createdBy": principal.user_id,
                    "meta": body.get("meta") if isinstance(body.get("meta"), Mapping) else None,
                }
            )
            return _json(dict(project), 201)

        @router.get("/projects/{project_id}")
        async def get_project(project_id: str, request: Request) -> Any:  # noqa: ANN401
            """Fetch one project over the minimal ``Project`` schema."""
            principal = await self._principal(request)
            if isinstance(principal, JSONResponse):
                return principal
            project = await self._load_project(project_id, principal)
            if isinstance(project, JSONResponse):
                return project
            return _json(project)

        @router.patch("/projects/{project_id}")
        async def patch_project(project_id: str, request: Request) -> Any:  # noqa: ANN401
            """Patch project metadata (name, dependencies, ...).

            Only the fields the schema owns are forwarded; anything else is
            ignored rather than written blind. ``messages`` is not patchable -
            the conversation is the loop's to write, and letting a client
            rewrite it would corrupt the transcript the next turn replays.
            """
            principal = await self._principal(request)
            if isinstance(principal, JSONResponse):
                return principal
            if not principal.can_edit:
                return _error("this project is read-only for you", 403)

            project = await self._load_project(project_id, principal)
            if isinstance(project, JSONResponse):
                return project

            body = await _body(request)
            if body is None:
                return _error("a JSON object body is required", 400)
            patch = {
                key: body[key]
                for key in ("name", "template", "dependencies", "connections", "meta", "files")
                if key in body
            }
            if not patch:
                return _error("no patchable fields in the body", 400)

            await self.store.patch_project(project_id, patch)
            updated = await self.store.get_project(project_id)
            return _json(dict(updated or {}))

        # ---- 4. Snapshots (version timeline + rollback) --------------------
        @router.get("/projects/{project_id}/snapshots")
        async def list_snapshots(project_id: str, request: Request) -> Any:  # noqa: ANN401
            """List pre-turn snapshots: ``[{id, messageIndex, createdAt, kind}]``."""
            principal = await self._principal(request)
            if isinstance(principal, JSONResponse):
                return principal
            project = await self._load_project(project_id, principal)
            if isinstance(project, JSONResponse):
                return project
            if not self._has_snapshots():
                return _error("this store does not keep snapshots", 404)
            snapshots = await self.store.list_snapshots(project_id)
            return _json([dict(s) for s in snapshots])

        @router.post("/projects/{project_id}/rollback")
        async def rollback(project_id: str, request: Request) -> Any:  # noqa: ANN401
            """Restore a snapshot and return ``{ok, messageIndex, undoSnapshotId}``.

            An undo snapshot of the *current* state is captured first, so a
            rollback is itself undoable - which is what makes the version
            timeline safe to click through.
            """
            principal = await self._principal(request)
            if isinstance(principal, JSONResponse):
                return principal
            if not principal.can_edit:
                return _error("this project is read-only for you", 403)
            project = await self._load_project(project_id, principal)
            if isinstance(project, JSONResponse):
                return project
            if not self._has_snapshots():
                return _error("this store does not keep snapshots", 404)

            body = await _body(request) or {}
            snapshot_id = body.get("snapshotId") or body.get("snapshot_id")
            if not isinstance(snapshot_id, str) or not snapshot_id:
                return _error("snapshotId is required", 400)

            target = await self.store.get_snapshot(project_id, snapshot_id)
            if target is None:
                return _error("snapshot not found", 404)

            current_files = dict(await self.store.get_files(project_id))
            current_messages = [dict(m) for m in await self.store.get_messages(project_id)]
            undo = await self.store.create_snapshot(
                project_id,
                {
                    "messageIndex": len(current_messages),
                    "kind": "undo",
                    "files": current_files,
                    "messages": current_messages,
                },
            )

            await self.store.put_files(project_id, dict(target.get("files") or {}))
            await self.store.save_messages(
                project_id, [dict(m) for m in (target.get("messages") or [])]
            )
            return _json(
                {
                    "ok": True,
                    "messageIndex": int(target.get("messageIndex") or 0),
                    "undoSnapshotId": str(undo.get("id") or ""),
                }
            )

        # ---- 5. Capabilities ----------------------------------------------
        @router.get("/capabilities")
        async def capabilities(request: Request) -> Any:  # noqa: ANN401
            """Advertise what this backend supports, for client negotiation.

            Everything here is read off the mounted adapters rather than
            configured twice: the models come from the provider, the sandbox
            descriptor from the bundler, the connector kinds from the mounted
            providers, and snapshot support from the store. A client that gets a
            404 from this route assumes protocol-1 defaults and proceeds.
            """
            principal = await self._principal(request)
            if isinstance(principal, JSONResponse):
                return principal

            models: list[str] = []
            allowed = getattr(self.llm, "allowed_models", None)
            if callable(allowed):
                try:
                    models = [str(m) for m in (allowed(principal) or ())]
                except Exception:
                    models = []

            caps = self._sandbox_caps()
            payload: dict[str, Any] = {
                "protocol": PROTOCOL_VERSION,
                "namespace": self.namespace,
                "sandbox": {
                    "location": caps.location,
                    "supportsInstall": bool(caps.supports_install),
                    "jsxRuntime": caps.jsx_runtime,
                },
                "planMode": True,
                "attachments": list(ATTACHMENT_KINDS),
                "models": models,
                "connectors": _unique(
                    str(getattr(p, "kind", "") or getattr(p, "name", ""))
                    for p in self.connectors
                ),
                # Additive: the version timeline and rollback UI hide themselves
                # when the mounted store has no snapshot surface.
                "snapshots": self._has_snapshots(),
            }

            # `routing` is advertised only when a mounted policy actually
            # answers for some task. The hook exists on every provider and a
            # stock deployment returns None from it, so testing for the
            # method's presence would advertise routing on every server.
            route_for = getattr(self.llm, "route_for", None)
            if callable(route_for):
                for task in ("build", "plan", "analyze"):
                    try:
                        routed = route_for({"task": task, "principal": principal})
                    except Exception:
                        routed = None
                    if isinstance(routed, str) and routed:
                        payload["routing"] = True
                        break
            return _json(payload)

        # ---- 6. Connector RPC ---------------------------------------------
        @router.post("/connectors/{kind}")
        async def connector(kind: str, request: Request) -> Any:  # noqa: ANN401
            """Dispatch a runtime bridge RPC to the matching connector.

            This is where the preview iframe's ``<ns>-*`` postMessages land
            after the React bridge forwards them. The credential never crosses
            the bridge: the connector runs the query here, with the
            server-held credential scoped to this principal, and only the rows
            travel back.
            """
            principal = await self._principal(request)
            if isinstance(principal, JSONResponse):
                return principal

            payload = await _body(request) or {}
            candidates = [
                provider
                for provider in self.connectors
                if kind in _bridge_kinds(provider)
            ]
            if not candidates:
                return _error(f"no connector handles {kind!r}", 404)

            # Several connectors of the same kind can be mounted (two MCP
            # servers, two databases); the payload names which one it wants.
            target = payload.get("connector") or payload.get("name") or payload.get("server")
            provider = candidates[0]
            if isinstance(target, str) and target:
                wanted = target.replace("-", "_")
                for candidate in candidates:
                    name = str(getattr(candidate, "name", "") or "")
                    if wanted in (name, name.replace("-", "_")):
                        provider = candidate
                        break

            ctx: dict[str, Any] = {
                "principal": principal,
                "namespace": self.namespace,
                "scope": dict(principal.scope or {}) or None,
            }
            token = request.query_params.get("token")
            if token:
                # Threaded through every runtime RPC so a shared, running app
                # fetches its data under the viewer's granted scope.
                ctx["shareToken"] = token
            try:
                result = await provider.handle(kind, payload, ctx)
            except Exception as exc:
                return _error(str(exc), 502)
            return _json(result if result is not None else {})

        return router


def _bridge_kinds(provider: Any) -> tuple[str, ...]:
    """Which bridge message kinds a connector answers.

    A connector declares ``bridge_kinds`` (the ``<ns>-<kind>`` suffixes it
    handles); its ``kind`` and its ``name`` are accepted too, so a shim that
    posts under the connector's own name still routes.
    """
    kinds = list(getattr(provider, "bridge_kinds", ()) or ())
    for extra in (getattr(provider, "kind", ""), getattr(provider, "name", "")):
        if extra:
            kinds.append(str(extra))
    return tuple(_unique(str(k) for k in kinds))
