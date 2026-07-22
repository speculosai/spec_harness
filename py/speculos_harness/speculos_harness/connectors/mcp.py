"""Reference MCP connector.

MCP is the cleanest connector to ship first: an open standard, so one adapter
reaches any MCP server. ``mcp_connector(url=...)`` returns a
:class:`~speculos_harness.interfaces.ConnectorProvider` that lists the server's
tools as chips + prompt context, exposes them as agent tools
(``call_app_tool`` / ...), handles the runtime bridge RPC the preview forwards
to ``POST {base}/connectors/mcp``, and contributes the in-iframe ``window.<ns>``
shim.

Every method is a stub until the v0.1 code drop.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional, Sequence

from ..interfaces import (
    AgentTool,
    ConnectorProvider,
    ConnectorSummary,
    FileMap,
    RuntimeContext,
)

_NOT_IMPLEMENTED = (
    "speculos-harness: not yet implemented — arrives with the v0.1 code drop"
)


class _McpConnector(ConnectorProvider):
    """The MCP ``ConnectorProvider``. Constructed via :func:`mcp_connector`."""

    kind = "mcp"

    def __init__(self, url: str) -> None:
        self.url = url
        # TODO(v0.1): lazily open the MCP session; cache the tool listing.

    async def list(
        self, scope: Optional[Mapping[str, str]] = None
    ) -> ConnectorSummary:
        """TODO(v0.1): the MCP server's tools as a scoped ConnectorSummary."""
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def detect_used(self, files: FileMap) -> Sequence[str]:
        """TODO(v0.1): scan files for references to this connector's namespace."""
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def tools(self) -> Sequence[AgentTool]:
        """TODO(v0.1): agent tools that proxy to the MCP server's tools."""
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def handle(
        self, kind: str, payload: Any, ctx: RuntimeContext
    ) -> Any:
        """TODO(v0.1): parent side of the window.<ns> RPC — call the MCP tool."""
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def shim(self, summary: ConnectorSummary, ns: str) -> str:
        """TODO(v0.1): the in-iframe resolver JS for window.<ns> MCP calls."""
        raise NotImplementedError(_NOT_IMPLEMENTED)


def mcp_connector(url: str) -> ConnectorProvider:
    """Build an MCP connector pointed at an MCP server.

    Args:
        url: The MCP server URL (e.g. ``"https://your-mcp-host.example/notion"``).

    Returns:
        A :class:`~speculos_harness.interfaces.ConnectorProvider` to pass in
        ``HarnessAgent(connectors=[...])``.
    """
    return _McpConnector(url=url)
