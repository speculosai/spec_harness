"""Built-in file and package tools.

The five tools the agent uses to build an app. Each is an
:class:`~speculos_harness.interfaces.AgentTool`: its OpenAI function schema,
its system-prompt fragment, and its executor live together so a tool and the
prompt text that describes it can never drift apart.

File writes never touch the host filesystem directly — the executor reads the
whole file map from the ``ProjectStore``, applies its change, and full-replaces
it back (the agent owns snapshots). ``write_file`` and ``delete_file`` mutate
the map; ``edit_file`` mutates it and MUST match its ``search`` string
**exactly once** (zero or multiple matches is an error, so an edit can never
land ambiguously); ``read_file`` is read-only; ``install_package`` calls the
bundler's installer (always ``--ignore-scripts``) and is only offered when the
bundler reports ``supports_install``.

An optional :data:`WriteValidator` seam lets a host reject or rewrite content
before it is persisted (size caps, forbidden imports, a house lint).

Every executor is a stub until the v0.1 code drop.
"""

from __future__ import annotations

from typing import Any, Callable, Mapping, Optional, Sequence

from ..interfaces import AgentTool, ToolContext, ToolSchema

_NOT_IMPLEMENTED = (
    "speculos-harness: not yet implemented — arrives with the v0.1 code drop"
)

#: A host seam invoked before a write/edit is persisted. Receives the target
#: path and the proposed content; returns the (possibly rewritten) content, or
#: raises to reject the write. TODO(v0.1): thread through write_file/edit_file.
WriteValidator = Callable[[str, str], str]


class _FileTool(AgentTool):
    """Base for the built-in tools: carries name/schema/mutates_files and
    default no-op ``available`` / ``prompt_fragment``."""

    name: str = ""
    schema: ToolSchema = {}
    mutates_files: bool = False

    def available(self, ctx: ToolContext) -> bool:
        """Offered by default. TODO(v0.1): override where a capability gates it."""
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def prompt_fragment(self, ctx: ToolContext) -> str:
        """The system-prompt lines describing this tool. TODO(v0.1)."""
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def execute(
        self, args: Mapping[str, Any], ctx: ToolContext
    ) -> Mapping[str, Any]:
        raise NotImplementedError(_NOT_IMPLEMENTED)


class WriteFileTool(_FileTool):
    """``write_file`` — create or overwrite a file.

    Schema: ``{path: string, content: string}``. Mutating: a successful result
    bumps ``fileSig`` and rebuilds the preview.

    TODO(v0.1): read the file map, set ``path`` to ``content`` (through the
    optional ``write_validator``), full-replace back.
    """

    name = "write_file"
    mutates_files = True

    def __init__(self, write_validator: Optional[WriteValidator] = None) -> None:
        self.write_validator = write_validator


class EditFileTool(_FileTool):
    """``edit_file`` — replace an exact substring in an existing file.

    Schema: ``{path: string, search: string, replace: string}``. Mutating.
    The ``search`` string MUST match **exactly once**; zero or multiple matches
    is an error and the file is left untouched.

    TODO(v0.1): locate the single match, apply ``replace`` (through the optional
    ``write_validator``), full-replace back; error on 0 or >1 matches.
    """

    name = "edit_file"
    mutates_files = True

    def __init__(self, write_validator: Optional[WriteValidator] = None) -> None:
        self.write_validator = write_validator


class ReadFileTool(_FileTool):
    """``read_file`` — return a file's current contents.

    Schema: ``{path: string}``. Read-only (does not mutate files).

    TODO(v0.1): return the file's text, or an error result when it is absent.
    """

    name = "read_file"
    mutates_files = False


class DeleteFileTool(_FileTool):
    """``delete_file`` — remove a file from the project.

    Schema: ``{path: string}``. Mutating.

    TODO(v0.1): drop ``path`` from the file map and full-replace back.
    """

    name = "delete_file"
    mutates_files = True


class InstallPackageTool(_FileTool):
    """``install_package`` — add an npm dependency for the bundler to resolve.

    Schema: ``{name: string, version?: string}``. Mutating. Only offered when
    the bundler reports ``supports_install``.

    TODO(v0.1): call the bundler's installer (always ``--ignore-scripts``,
    name/version regex-enforced) and record the dependency on the project.
    ``available(ctx)`` returns the bundler's ``supports_install`` capability.
    """

    name = "install_package"
    mutates_files = True


def builtin_file_tools(
    *, write_validator: Optional[WriteValidator] = None
) -> Sequence[AgentTool]:
    """The default built-in tool set, in offer order.

    TODO(v0.1): return concrete instances with real schemas and executors. The
    ``write_validator`` seam is threaded into the mutating write/edit tools.
    """
    return (
        WriteFileTool(write_validator),
        EditFileTool(write_validator),
        ReadFileTool(),
        DeleteFileTool(),
        InstallPackageTool(),
    )
