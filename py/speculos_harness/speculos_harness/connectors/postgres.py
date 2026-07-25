"""Reference Postgres connector.

``postgres_connector(dsn=...)`` returns a
:class:`~speculos_harness.interfaces.ConnectorProvider` that lets the agent
build read views against a live Postgres database: it lists tables as chips +
prompt context, exposes ``list_tables`` / ``run_query`` agent tools, handles the
runtime bridge RPC the preview forwards to ``POST {base}/connectors/postgres``,
and contributes the in-iframe ``window.<ns>`` shim. The credentials stay in the
connector, server-side - the generated app asks the bridge for rows, never for
a password.

The ``dsn`` may be a fixed string or, for a **database-per-tenant** host, a
callable resolved per request against the ``Principal`` scope::

    postgres_connector(dsn=lambda principal: dsn_for(principal.scope["tenant"]))
"""

from __future__ import annotations

from typing import Any, Callable, Mapping, Optional, Sequence, Union

from ..interfaces import (
    AgentTool,
    ConnectorProvider,
    ConnectorSummary,
    FileMap,
    Principal,
    RuntimeContext,
)

_NOT_IMPLEMENTED = "speculos_harness.connectors.postgres: implementation pending"

#: A fixed DSN string, or a resolver called per request with the caller's
#: ``Principal`` to return that tenant's DSN.
DsnResolver = Callable[[Principal], str]
Dsn = Union[str, DsnResolver]


class _PostgresConnector(ConnectorProvider):
    """The Postgres ``ConnectorProvider``. Constructed via
    :func:`postgres_connector`."""

    kind = "postgres"

    def __init__(self, dsn: Dsn) -> None:
        self.dsn = dsn
        # TODO: if dsn is a str, hold one pool; if callable, resolve and
        # pool per tenant. Queries run read-only, scoped to the Principal.

    def _resolve_dsn(self, principal: Optional[Principal]) -> str:
        """Resolve the DSN for a caller.

        Returns ``self.dsn`` when it is a string, else calls it with
        ``principal`` - the database-per-tenant path.
        """
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def list(
        self, scope: Optional[Mapping[str, str]] = None
    ) -> ConnectorSummary:
        """The tenant's tables and columns as a scoped ``ConnectorSummary``."""
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def detect_used(self, files: FileMap) -> Sequence[str]:
        """Scan files for references to this connector's namespace."""
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def tools(self) -> Sequence[AgentTool]:
        """The ``list_tables`` / ``run_query`` agent tools (read-only)."""
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def handle(
        self, kind: str, payload: Any, ctx: RuntimeContext
    ) -> Any:
        """Parent side of the ``window.<ns>`` RPC: run the scoped query."""
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def shim(self, summary: ConnectorSummary, ns: str) -> str:
        """The in-iframe resolver JS for ``window.<ns>`` queries."""
        raise NotImplementedError(_NOT_IMPLEMENTED)


def postgres_connector(dsn: Dsn) -> ConnectorProvider:
    """Build a Postgres connector.

    Args:
        dsn: A DSN string (e.g. ``"postgresql://user:pass@host/db"``), or a
            callable ``(principal) -> dsn`` for database-per-tenant hosts.

    Returns:
        A :class:`~speculos_harness.interfaces.ConnectorProvider` to pass in
        ``HarnessAgent(connectors=[...])``.
    """
    return _PostgresConnector(dsn=dsn)
