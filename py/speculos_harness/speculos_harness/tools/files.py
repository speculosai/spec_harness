"""Built-in file and package tools.

The five tools the agent uses to build an app. Each is an
:class:`~speculos_harness.interfaces.AgentTool`: its OpenAI function schema,
its system-prompt fragment, and its executor live together so a tool and the
prompt text that describes it can never drift apart.

File writes never touch the host filesystem directly - the executor reads the
whole file map from the ``ProjectStore``, applies its change, and full-replaces
it back (the agent owns snapshots). ``write_file`` and ``delete_file`` mutate
the map; ``edit_file`` mutates it and MUST match its ``old_string``
**exactly once** (zero or multiple matches is an error, so an edit can never
land ambiguously); ``read_file`` is read-only; ``install_package`` calls the
bundler's installer (always ``--ignore-scripts``) and is only offered when the
bundler reports ``supports_install``.

An optional :data:`WriteValidator` seam lets a host reject or rewrite content
before it is persisted (size caps, forbidden imports, a house lint).

The tool context
----------------

Every executor reads its collaborators out of the ``ToolContext`` mapping the
agent loop passes in. The keys these tools consult, all optional unless noted:

``store``
    The :class:`~speculos_harness.interfaces.ProjectStore`. Required for the
    four file tools - without it they return a failure result rather than
    guessing where files live.
``project_id``
    The project being edited. Required alongside ``store``.
``files``
    The turn's cached file map. Read only as a fallback when no ``store`` is
    present; when it is a mutable mapping the executors keep it in step with
    what they persisted, so two tools in the same turn agree.
``bundler_url``
    Base URL of the bundler sidecar, for ``install_package``.
``installer``
    A :class:`~speculos_harness.interfaces.PackageInstaller`. Preferred over
    ``bundler_url`` when both are present.
``bundler`` / ``bundler_caps`` / ``supports_install``
    Any one of these answers "can this deployment install packages?" for
    ``InstallPackageTool.available``.
``principal``, ``namespace``, ``scope``
    Passed through by the loop; carried here for host-supplied tools and the
    write validator.
"""

from __future__ import annotations

import re
from typing import Any, Callable, Mapping, MutableMapping, Optional, Sequence

from ..interfaces import AgentTool, ToolContext, ToolSchema

#: A host seam invoked before a write/edit is persisted. Receives the target
#: path and the proposed content; returns the (possibly rewritten) content, or
#: raises to reject the write. Threaded into ``write_file`` and ``edit_file``.
WriteValidator = Callable[[str, str], str]

#: npm's own name rule, tightened: lowercase, optional single scope, no leading
#: dot or underscore, and none of the shell/path characters that would make a
#: name interesting to a package manager. Validated before anything is sent to
#: the bundler - see spec/security.md, threat 2.
_PACKAGE_NAME_RE = re.compile(
    r"^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$"
)

#: A semver-ish range (``1.2.3``, ``^2.15.0``, ``~1.0``) or a plain dist-tag
#: (``latest``, ``next``, ``beta``). Deliberately narrow: no spaces, no logical
#: operators, no URLs, no ``file:``/``git+ssh:`` specifiers.
_PACKAGE_VERSION_RE = re.compile(
    r"^(?:[\^~]?\d+(?:\.\d+){0,2}"
    r"(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?"
    r"|[a-z][a-z0-9.-]*)$"
)

#: npm's hard cap on a package name.
_MAX_PACKAGE_NAME = 214

#: How long to wait on the sidecar's install endpoint. Installing a cold
#: package pulls the tarball and resolves its tree, so this is generous.
_INSTALL_TIMEOUT_S = 180.0


def _fail(error: str, **extra: Any) -> dict[str, Any]:
    """A failure result. ``ok`` is explicitly ``False`` - the only thing the
    wire convention treats as a failure."""
    return {"ok": False, "error": error, **extra}


def _normalize_path(raw: Any) -> tuple[Optional[str], Optional[str]]:
    """Normalize a model-supplied project path.

    Returns ``(path, None)`` or ``(None, error)``. Project paths are absolute
    within the project (``/App.tsx``); a bare ``App.tsx`` is accepted and
    normalized so a model that forgets the slash does not create a second,
    shadow entry in the file map. ``..`` segments and NUL bytes are rejected
    outright: the file map is not a filesystem, and a store that mirrors it to
    disk must never be handed a traversal.
    """
    if not isinstance(raw, str) or not raw.strip():
        return None, "path is required and must be a non-empty string"
    path = raw.strip()
    if "\x00" in path:
        return None, "path contains a NUL byte"
    path = path.replace("\\", "/")
    if not path.startswith("/"):
        path = "/" + path
    segments = [s for s in path.split("/") if s not in ("", ".")]
    if any(s == ".." for s in segments):
        return None, f"path escapes the project root: {raw}"
    if not segments:
        return None, "path must name a file, not a directory"
    return "/" + "/".join(segments), None


def _lookup(files: Mapping[str, str], path: str, raw: Any) -> Optional[str]:
    """Find the key a project file actually lives under.

    Prefers the normalized path, then the literal string the model sent, so a
    project whose historical map has un-normalized keys stays readable.
    """
    if path in files:
        return path
    if isinstance(raw, str) and raw in files:
        return raw
    return None


async def _load_files(ctx: ToolContext) -> tuple[Optional[dict[str, str]], Optional[str]]:
    """Read the whole file map for this turn.

    The store is the source of truth: tools re-read it rather than trusting a
    map cached at the start of the turn, because a turn runs several mutating
    tools back to back.
    """
    store = ctx.get("store")
    project_id = ctx.get("project_id") or ctx.get("projectId")
    if store is not None and project_id:
        return dict(await store.get_files(str(project_id))), None
    cached = ctx.get("files")
    if isinstance(cached, Mapping):
        return dict(cached), None
    return None, "no project store is configured for this turn"


async def _save_files(ctx: ToolContext, files: Mapping[str, str]) -> Optional[str]:
    """Full-replace the file map, then keep the turn's cached copy in step."""
    store = ctx.get("store")
    project_id = ctx.get("project_id") or ctx.get("projectId")
    if store is not None and project_id:
        await store.put_files(str(project_id), dict(files))
    cached = ctx.get("files")
    if isinstance(cached, MutableMapping):
        cached.clear()
        cached.update(files)
    elif store is None:
        return "no project store is configured for this turn"
    return None


def _validate(
    validator: Optional[WriteValidator], path: str, content: str
) -> tuple[Optional[str], Optional[str]]:
    """Run the host's write validator. Returns ``(content, None)`` or
    ``(None, reason)`` - a rejected write is a failure result the model can
    read and act on, never a silent drop."""
    if validator is None:
        return content, None
    try:
        rewritten = validator(path, content)
    except Exception as exc:  # the documented way to reject a write
        reason = str(exc) or exc.__class__.__name__
        return None, f"write to {path} rejected: {reason}"
    if rewritten is None:
        return None, f"write to {path} rejected by the host write validator"
    if not isinstance(rewritten, str):
        return None, (
            f"write validator for {path} returned "
            f"{type(rewritten).__name__}, expected str"
        )
    return rewritten, None


class _FileTool(AgentTool):
    """Base for the built-in tools: carries name/schema/mutates_files and
    default no-op ``available`` / ``prompt_fragment``."""

    name: str = ""
    schema: ToolSchema = {}
    mutates_files: bool = False

    def available(self, ctx: ToolContext) -> bool:
        """Offered by default. ``install_package`` overrides it."""
        return True

    def prompt_fragment(self, ctx: ToolContext) -> str:
        """The system-prompt lines describing this tool."""
        return ""

    async def execute(
        self, args: Mapping[str, Any], ctx: ToolContext
    ) -> Mapping[str, Any]:
        raise NotImplementedError(f"{self.name} has no executor")


class WriteFileTool(_FileTool):
    """``write_file`` - create or overwrite a file.

    Schema: ``{path: string, content: string}``. Mutating: a successful result
    bumps ``fileSig`` and rebuilds the preview.

    Reads the file map, sets ``path`` to ``content`` (through the optional
    ``write_validator``), and full-replaces the map back.
    """

    name = "write_file"
    mutates_files = True

    schema: ToolSchema = {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": (
                "Create a new file or overwrite an existing one. Use for new "
                "files, or for rewrites of more than about 40% of a file; "
                "prefer edit_file for targeted changes."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": (
                            "Project path starting with /, e.g. /App.tsx"
                        ),
                    },
                    "content": {
                        "type": "string",
                        "description": "The complete new contents of the file.",
                    },
                },
                "required": ["path", "content"],
                "additionalProperties": False,
            },
        },
    }

    def __init__(self, write_validator: Optional[WriteValidator] = None) -> None:
        self.write_validator = write_validator

    def prompt_fragment(self, ctx: ToolContext) -> str:
        return (
            "- write_file(path, content): create or fully replace a file. "
            "Paths are absolute within the project and start with a slash."
        )

    async def execute(
        self, args: Mapping[str, Any], ctx: ToolContext
    ) -> Mapping[str, Any]:
        raw_path = args.get("path")
        path, err = _normalize_path(raw_path)
        if err or path is None:
            return _fail(err or "invalid path")
        content = args.get("content")
        if not isinstance(content, str):
            return _fail(f"content is required and must be a string ({path})")

        files, load_err = await _load_files(ctx)
        if files is None:
            return _fail(load_err or "could not read the project files")

        checked, reason = _validate(self.write_validator, path, content)
        if checked is None:
            return _fail(reason or "write rejected")

        # Replace whichever key the file already lives under, so a normalized
        # write does not leave a stale duplicate behind.
        existing = _lookup(files, path, raw_path)
        if existing is not None and existing != path:
            del files[existing]
        files[path] = checked

        save_err = await _save_files(ctx, files)
        if save_err:
            return _fail(save_err)
        return {"ok": True, "path": path, "bytes": len(checked)}


class EditFileTool(_FileTool):
    """``edit_file`` - replace an exact substring in an existing file.

    Schema: ``{path: string, old_string: string, new_string: string}``.
    Mutating. The ``old_string`` MUST match **exactly once**; zero or multiple
    matches is an error and the file is left untouched.

    Locates the single match, applies ``new_string`` (through the optional
    ``write_validator``), and full-replaces the map back. On 0 or >1 matches it
    returns a failure result naming which case it hit - never a partial write.
    """

    name = "edit_file"
    mutates_files = True

    schema: ToolSchema = {
        "type": "function",
        "function": {
            "name": "edit_file",
            "description": (
                "Replace old_string with new_string in a file. old_string must "
                "match exactly once - if it matches zero times or more than "
                "once the edit is refused and the file is left untouched, so "
                "include enough surrounding context to be unambiguous. Call "
                "read_file first so old_string matches the file's exact "
                "current text."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": (
                            "Project path starting with /, e.g. /App.tsx"
                        ),
                    },
                    "old_string": {
                        "type": "string",
                        "description": (
                            "The exact text to replace. Must occur exactly "
                            "once in the file."
                        ),
                    },
                    "new_string": {
                        "type": "string",
                        "description": "The replacement text. May be empty.",
                    },
                },
                "required": ["path", "old_string", "new_string"],
                "additionalProperties": False,
            },
        },
    }

    #: Accepted spellings of the two edit arguments. Models trained on other
    #: harnesses reach for camelCase or search/replace; taking all three costs
    #: nothing and turns a wasted turn into a working edit.
    _OLD_KEYS = ("old_string", "oldString", "search", "old")
    _NEW_KEYS = ("new_string", "newString", "replace", "new")

    def __init__(self, write_validator: Optional[WriteValidator] = None) -> None:
        self.write_validator = write_validator

    def prompt_fragment(self, ctx: ToolContext) -> str:
        return (
            "- edit_file(path, old_string, new_string): replace an exact "
            "substring. old_string must match exactly once, so quote enough "
            "surrounding lines to be unique; a zero-match or multi-match edit "
            "is refused and nothing is written."
        )

    @staticmethod
    def _pick(args: Mapping[str, Any], keys: Sequence[str]) -> Optional[str]:
        for key in keys:
            value = args.get(key)
            if isinstance(value, str):
                return value
        return None

    async def execute(
        self, args: Mapping[str, Any], ctx: ToolContext
    ) -> Mapping[str, Any]:
        raw_path = args.get("path")
        path, err = _normalize_path(raw_path)
        if err or path is None:
            return _fail(err or "invalid path")
        old = self._pick(args, self._OLD_KEYS)
        new = self._pick(args, self._NEW_KEYS)
        if old is None:
            return _fail("old_string is required and must be a string")
        if new is None:
            return _fail("new_string is required and must be a string")
        if old == "":
            return _fail(
                "old_string must not be empty - an empty match is ambiguous "
                "by definition; use write_file to replace the whole file"
            )

        files, load_err = await _load_files(ctx)
        if files is None:
            return _fail(load_err or "could not read the project files")

        key = _lookup(files, path, raw_path)
        if key is None:
            return _fail(
                f"File not found: {path}",
                available=", ".join(sorted(files)[:60]),
            )

        source = files[key]
        count = source.count(old)
        # The match-exactly-once property, stated as two distinct failures so
        # the model knows which way to correct itself.
        if count == 0:
            return _fail(
                f"old_string not found in {path}. Call read_file({path}) and "
                "copy the exact current text, including indentation."
            )
        if count > 1:
            return _fail(
                f"old_string matches {count} times in {path}; include more "
                "surrounding context so it matches exactly once."
            )

        updated = source.replace(old, new, 1)
        checked, reason = _validate(self.write_validator, path, updated)
        if checked is None:
            return _fail(reason or "write rejected")

        files[key] = checked
        save_err = await _save_files(ctx, files)
        if save_err:
            return _fail(save_err)
        return {"ok": True, "path": path, "bytes": len(checked), "replacements": 1}


class ReadFileTool(_FileTool):
    """``read_file`` - return a file's current contents.

    Schema: ``{path: string}``. Read-only (does not mutate files).

    Returns the file's text, or an error result listing the project's paths
    when it is absent.
    """

    name = "read_file"
    mutates_files = False

    schema: ToolSchema = {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": (
                "Read the full current contents of ONE file. File contents are "
                "not shown to you up front - only the file list is. Call "
                "read_file before edit_file so old_string matches the file's "
                "exact current text. Read only the files relevant to the task; "
                "several read_file calls may be issued in parallel."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": (
                            "Project path starting with /, e.g. /App.tsx"
                        ),
                    },
                },
                "required": ["path"],
                "additionalProperties": False,
            },
        },
    }

    def prompt_fragment(self, ctx: ToolContext) -> str:
        return (
            "- read_file(path): read a file's current contents. Always read a "
            "file before editing it."
        )

    async def execute(
        self, args: Mapping[str, Any], ctx: ToolContext
    ) -> Mapping[str, Any]:
        raw_path = args.get("path")
        path, err = _normalize_path(raw_path)
        if err or path is None:
            return _fail(err or "invalid path")

        files, load_err = await _load_files(ctx)
        if files is None:
            return _fail(load_err or "could not read the project files")

        key = _lookup(files, path, raw_path)
        if key is None:
            return _fail(
                f"File not found: {path}",
                available=", ".join(sorted(files)[:60]),
            )
        content = files[key]
        return {"ok": True, "path": path, "content": content, "bytes": len(content)}


class DeleteFileTool(_FileTool):
    """``delete_file`` - remove a file from the project.

    Schema: ``{path: string}``. Mutating.

    Drops ``path`` from the file map and full-replaces the map back.
    """

    name = "delete_file"
    mutates_files = True

    schema: ToolSchema = {
        "type": "function",
        "function": {
            "name": "delete_file",
            "description": "Delete a file from the project.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": (
                            "Project path starting with /, e.g. /old.tsx"
                        ),
                    },
                },
                "required": ["path"],
                "additionalProperties": False,
            },
        },
    }

    def prompt_fragment(self, ctx: ToolContext) -> str:
        return "- delete_file(path): remove a file from the project."

    async def execute(
        self, args: Mapping[str, Any], ctx: ToolContext
    ) -> Mapping[str, Any]:
        raw_path = args.get("path")
        path, err = _normalize_path(raw_path)
        if err or path is None:
            return _fail(err or "invalid path")

        files, load_err = await _load_files(ctx)
        if files is None:
            return _fail(load_err or "could not read the project files")

        key = _lookup(files, path, raw_path)
        if key is None:
            return _fail(
                f"File not found: {path}",
                available=", ".join(sorted(files)[:60]),
            )
        del files[key]

        save_err = await _save_files(ctx, files)
        if save_err:
            return _fail(save_err)
        return {"ok": True, "path": path}


class InstallPackageTool(_FileTool):
    """``install_package`` - add an npm dependency for the bundler to resolve.

    Schema: ``{name: string, version?: string}``. Mutating. Only offered when
    the bundler reports ``supports_install``.

    Validates ``name`` and ``version`` against a conservative regex, calls the
    bundler's ``POST /packages/install`` (which always installs with
    ``--ignore-scripts``), and records the dependency on the project so a later
    bundle resolves it. An optional ``allowlist`` caps what may be installed at
    all - the deterministic backstop for a prompt-injected install, per
    ``spec/security.md``.

    ``available(ctx)`` returns the bundler's ``supports_install`` capability.
    """

    name = "install_package"
    mutates_files = True

    schema: ToolSchema = {
        "type": "function",
        "function": {
            "name": "install_package",
            "description": (
                "Add an npm package to the project's dependencies so the "
                "bundler can resolve it. Only needed for libraries outside the "
                "base set already available."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": (
                            "The npm package name, e.g. recharts or "
                            "@tanstack/react-table."
                        ),
                    },
                    "version": {
                        "type": "string",
                        "description": (
                            "Optional version or dist-tag, e.g. 2.15.0, "
                            "^2.15.0, latest. Defaults to latest."
                        ),
                    },
                },
                "required": ["name"],
                "additionalProperties": False,
            },
        },
    }

    def __init__(
        self,
        *,
        bundler_url: Optional[str] = None,
        allowlist: Optional[Sequence[str]] = None,
    ) -> None:
        self.bundler_url = bundler_url
        #: When set, the only package names this tool will install. ``None``
        #: means "anything that passes the name/version regex".
        self.allowlist: Optional[frozenset[str]] = (
            frozenset(allowlist) if allowlist is not None else None
        )

    # -- availability --------------------------------------------------------

    def _resolve_bundler_url(self, ctx: ToolContext) -> Optional[str]:
        return self.bundler_url or ctx.get("bundler_url") or ctx.get("bundlerUrl")

    def available(self, ctx: ToolContext) -> bool:
        """Whether this deployment can install packages at all.

        Consulted in order: an explicit ``supports_install`` flag, a
        ``bundler_caps`` descriptor, a live ``bundler`` adapter, then the mere
        presence of an installer or a bundler URL. A browser bundler that
        resolves from a CDN advertises ``supports_install: False`` and the tool
        is pruned from the offered set.
        """
        explicit = ctx.get("supports_install", ctx.get("supportsInstall"))
        if isinstance(explicit, bool):
            return explicit

        caps = ctx.get("bundler_caps") or ctx.get("bundlerCaps")
        if caps is None:
            bundler = ctx.get("bundler")
            caps = getattr(bundler, "caps", None) if bundler is not None else None
        if caps is not None:
            flag = getattr(caps, "supports_install", None)
            if flag is None and isinstance(caps, Mapping):
                flag = caps.get("supports_install", caps.get("supportsInstall"))
            if isinstance(flag, bool):
                return flag

        return ctx.get("installer") is not None or bool(self._resolve_bundler_url(ctx))

    def prompt_fragment(self, ctx: ToolContext) -> str:
        if not self.available(ctx):
            return ""
        line = (
            "- install_package(name, version?): add an npm dependency. Only "
            "reach for it when the base libraries genuinely cannot do the job; "
            "an install costs a build round-trip."
        )
        if self.allowlist:
            allowed = ", ".join(sorted(self.allowlist))
            line += f" Installable packages are limited to: {allowed}."
        return line

    # -- validation ----------------------------------------------------------

    def _check(self, name: Any, version: Any) -> tuple[Optional[tuple[str, str]], Optional[str]]:
        """Validate the package coordinates before anything is executed."""
        if not isinstance(name, str) or not name:
            return None, "name is required"
        if len(name) > _MAX_PACKAGE_NAME:
            return None, f"package name is longer than {_MAX_PACKAGE_NAME} characters"
        if not _PACKAGE_NAME_RE.match(name):
            return None, (
                f"invalid package name {name!r}: expected a plain npm name "
                "like recharts or @tanstack/react-table"
            )
        if version is None or version == "":
            version = "latest"
        if not isinstance(version, str) or not _PACKAGE_VERSION_RE.match(version):
            return None, (
                f"invalid version {version!r}: expected a semver range like "
                "2.15.0 or ^2.15.0, or a dist-tag like latest"
            )
        if self.allowlist is not None and name not in self.allowlist:
            return None, (
                f"{name} is not on this deployment's dependency allowlist. "
                "Build with the libraries already available."
            )
        return (name, version), None

    # -- execution -----------------------------------------------------------

    async def _install(
        self, ctx: ToolContext, name: str, version: str
    ) -> tuple[bool, Optional[str]]:
        """Run the install, preferring a host-supplied ``PackageInstaller``."""
        installer = ctx.get("installer")
        if installer is not None:
            try:
                result = await installer.install(name, version)
            except Exception as exc:
                return False, f"install failed: {exc}"
            if isinstance(result, Mapping) and result.get("ok") is False:
                return False, str(result.get("error") or f"install of {name} failed")
            return True, None

        base = self._resolve_bundler_url(ctx)
        if not base:
            return False, (
                "no bundler is configured, so packages cannot be installed"
            )

        import httpx  # imported lazily: the base package boots without a bundler

        url = f"{str(base).rstrip('/')}/packages/install"
        try:
            async with httpx.AsyncClient(timeout=_INSTALL_TIMEOUT_S) as client:
                response = await client.post(
                    url, json={"name": name, "version": version}
                )
        except Exception as exc:
            return False, f"install request failed: {exc}"

        try:
            body = response.json()
        except Exception:
            body = {"error": response.text[:400]}
        if response.status_code >= 400 or not isinstance(body, Mapping) or not body.get("ok"):
            error = None
            if isinstance(body, Mapping):
                error = body.get("error")
            return False, str(
                error or f"install of {name} failed (HTTP {response.status_code})"
            )
        return True, None

    async def _record_dependency(
        self, ctx: ToolContext, name: str, version: str
    ) -> None:
        """Record the dependency on the project so the next bundle declares it.

        Best effort: the package is already installed in the bundler's
        resolution root, so a failure to record it must not fail the tool.
        """
        store = ctx.get("store")
        project_id = ctx.get("project_id") or ctx.get("projectId")
        if store is None or not project_id:
            return
        try:
            project = await store.get_project(str(project_id))
            deps = dict((project or {}).get("dependencies") or {})
            deps[name] = version
            await store.patch_project(str(project_id), {"dependencies": deps})
        except Exception:
            pass

    async def execute(
        self, args: Mapping[str, Any], ctx: ToolContext
    ) -> Mapping[str, Any]:
        checked, reason = self._check(args.get("name"), args.get("version"))
        if checked is None:
            return _fail(reason or "invalid package")
        name, version = checked

        ok, error = await self._install(ctx, name, version)
        if not ok:
            return _fail(error or f"install of {name} failed")

        await self._record_dependency(ctx, name, version)
        return {"ok": True, "name": name, "version": version}


def builtin_file_tools(
    *,
    write_validator: Optional[WriteValidator] = None,
    supports_install: Optional[bool] = None,
    bundler_url: Optional[str] = None,
    package_allowlist: Optional[Sequence[str]] = None,
) -> Sequence[AgentTool]:
    """The default built-in tool set, in offer order.

    Args:
        write_validator: Optional host seam threaded into the mutating
            write/edit tools. A validator that raises rejects the write and the
            model gets a failure result explaining why.
        supports_install: Whether package installation is available. ``False``
            drops ``install_package`` from the set entirely; ``None`` (the
            default) keeps it and lets ``InstallPackageTool.available(ctx)``
            decide per turn from the bundler's capabilities.
        bundler_url: Base URL of the bundler sidecar, if it is known at
            construction time rather than per turn.
        package_allowlist: When given, the only package names
            ``install_package`` may install.
    """
    tools: list[AgentTool] = [
        WriteFileTool(write_validator),
        EditFileTool(write_validator),
        ReadFileTool(),
        DeleteFileTool(),
    ]
    if supports_install is not False:
        tools.append(
            InstallPackageTool(
                bundler_url=bundler_url, allowlist=package_allowlist
            )
        )
    return tuple(tools)
