"""Reference connectors.

Each connector is a :class:`~speculos_harness.interfaces.ConnectorProvider`
built by a factory you call at boot and hand to ``HarnessAgent(connectors=...)``.
A connector bundles everything one data source needs: the agent tools it
contributes, the lines it adds to the system prompt, and the runtime bridge the
generated app fetches through. Connectors resolve per-request against the
``Principal`` scope, so two tenants on the same connector list see only their
own data, and credentials never leave the server.

Postgres and MCP are the open-source references, and the interface is open, so
you can write your own. Speculos's governed catalog - warehouses, CRMs, and
internal systems, granted per person by an admin - is a closed-beta module
(https://speculos.ai/enterprise).
"""

from __future__ import annotations

from .mcp import mcp_connector
from .postgres import postgres_connector

__all__ = ["mcp_connector", "postgres_connector"]
