"""Reference Postgres connector.

``postgres_connector(dsn=...)`` returns a
:class:`~speculos_harness.interfaces.ConnectorProvider` that lets the agent
build read views against a live Postgres database: it lists tables as chips +
prompt context, exposes ``list_tables`` / ``describe_table`` / ``run_query``
agent tools, handles the runtime bridge RPC the preview forwards to
``POST {base}/connectors/postgres``, and contributes the in-iframe
``window.<ns>`` shim. The credentials stay in the connector, server-side - the
generated app asks the bridge for rows, never for a password.

The ``dsn`` may be a fixed string or, for a **database-per-tenant** host, a
callable resolved per request against the ``Principal`` scope::

    postgres_connector(dsn=lambda principal: dsn_for(principal.scope["tenant"]))

Every statement - the agent's and the running app's alike - executes inside an
explicit ``BEGIN READ ONLY`` transaction with a statement timeout and a row
cap, and the transaction is always rolled back. A read-only transaction is
enforced by Postgres itself, so it holds regardless of what SQL the model or a
prompt-injected row talks the agent into writing.

``psycopg`` is the declared ``postgres`` extra and is imported lazily, so the
base package installs and boots without it.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Any, Callable, Mapping, Optional, Sequence, Union

from ._bridge import bridge_preamble
from ..interfaces import (
    AgentTool,
    ConnectorProvider,
    ConnectorSummary,
    FileMap,
    Principal,
    RuntimeContext,
    ToolContext,
    ToolSchema,
)

#: A fixed DSN string, or a resolver called per request with the caller's
#: ``Principal`` to return that tenant's DSN.
DsnResolver = Callable[[Principal], str]
Dsn = Union[str, DsnResolver]

#: Schemas that are never interesting to an app builder.
_SYSTEM_SCHEMAS = ("pg_catalog", "information_schema", "pg_toast")

#: How long an introspection result stays warm, per resolved DSN. The prompt is
#: rebuilt every turn; re-reading the catalog every turn is wasted latency.
_SCHEMA_CACHE_TTL_S = 300.0

#: Prompt-size guards. A 900-table warehouse must not evict the actual
#: conversation from the context window.
_PROMPT_MAX_TABLES = 60
_PROMPT_MAX_COLUMNS = 30

_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")


def _principal_from_scope(scope: Optional[Mapping[str, str]]) -> Principal:
    """A caller stand-in for the paths that only carry a scope.

    ``ConnectorProvider.list`` is handed a scope, not a principal, but a
    per-tenant DSN resolver is written against the principal. Synthesizing one
    from the scope keeps both call paths on the same resolver.
    """
    scope = dict(scope or {})
    return Principal(
        user_id=str(scope.get("user_id") or scope.get("userId") or "local"),
        can_edit=True,
        scope=scope or None,
    )


def _jsonable(value: Any) -> Any:
    """Coerce a Postgres value into something JSON can carry.

    Numerics, dates, UUIDs, intervals and ranges all arrive as Python objects
    the JSON encoder does not know. Everything unknown becomes its string form,
    which is what a chart or a table wants anyway.
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).decode("utf-8", "replace")
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, Mapping):
        return {str(k): _jsonable(v) for k, v in value.items()}
    return str(value)


def _quote_ident(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


class _PostgresConnector(ConnectorProvider):
    """The Postgres ``ConnectorProvider``. Constructed via
    :func:`postgres_connector`."""

    kind = "postgres"

    #: The preview-bridge message kinds this provider answers. The router maps
    #: ``POST {base}/connectors/{kind}`` onto a provider by matching ``kind``
    #: against this tuple as well as :attr:`kind`, so the in-frame
    #: ``<ns>-query`` message and the ``postgres`` connector name both land
    #: here.
    bridge_kinds = ("query", "postgres")

    def __init__(
        self,
        dsn: Dsn,
        *,
        name: str = "postgres",
        namespace: str = "app",
        schemas: Optional[Sequence[str]] = None,
        max_rows: int = 1000,
        plan_max_rows: int = 50,
        statement_timeout_ms: int = 15_000,
        connect_timeout_s: int = 8,
    ) -> None:
        self.dsn = dsn
        #: The name the generated app reaches this connector by:
        #: ``window.<ns>.<name>.query(...)``.
        self.name = name
        #: The runtime namespace. ``HarnessAgent`` sets this at boot so the
        #: prompt, the generated code and the bridge cannot drift apart.
        self.namespace = namespace
        self.schemas = tuple(schemas) if schemas else None
        self.max_rows = int(max_rows)
        self.plan_max_rows = int(plan_max_rows)
        self.statement_timeout_ms = int(statement_timeout_ms)
        self.connect_timeout_s = int(connect_timeout_s)
        # Introspection cache, keyed by resolved DSN so a per-tenant resolver
        # never serves one tenant's catalog to another.
        self._schema_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}

    # -- connection ----------------------------------------------------------

    def _resolve_dsn(self, principal: Optional[Principal]) -> str:
        """Resolve the DSN for a caller.

        Returns ``self.dsn`` when it is a string, else calls it with
        ``principal`` - the database-per-tenant path.
        """
        if isinstance(self.dsn, str):
            return self.dsn
        if not callable(self.dsn):
            raise TypeError("dsn must be a string or a callable (principal) -> str")
        resolved = self.dsn(principal or _principal_from_scope(None))
        if not isinstance(resolved, str) or not resolved:
            raise ValueError("the dsn resolver returned no DSN for this caller")
        return resolved

    @staticmethod
    def _psycopg() -> Any:
        try:
            import psycopg  # noqa: PLC0415 - optional extra, imported on use
            from psycopg.rows import dict_row  # noqa: PLC0415
        except ModuleNotFoundError as exc:  # pragma: no cover - env dependent
            raise RuntimeError(
                "the postgres connector needs psycopg: "
                "pip install 'speculos-harness[postgres]'"
            ) from exc
        return psycopg, dict_row

    def _run_readonly(
        self,
        dsn: str,
        sql: str,
        params: Optional[Sequence[Any]] = None,
        limit: Optional[int] = None,
    ) -> list[dict[str, Any]]:
        """Execute one statement inside a read-only transaction.

        Blocking; callers hand it to a worker thread. Read-only is enforced by
        Postgres (``BEGIN READ ONLY``), not by inspecting the SQL - a regex
        over SQL is not a security boundary, a read-only transaction is.
        """
        psycopg, dict_row = self._psycopg()
        cap = self.max_rows if limit is None else max(1, min(int(limit), self.max_rows))
        # autocommit so our explicit BEGIN is the transaction, rather than
        # opening one inside a transaction the driver already started.
        with psycopg.connect(
            dsn, connect_timeout=self.connect_timeout_s, autocommit=True
        ) as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute("begin read only")
                try:
                    cur.execute(
                        f"set local statement_timeout = {int(self.statement_timeout_ms)}"
                    )
                    cur.execute(sql, list(params or []))
                    if cur.description is None:
                        return []
                    return [
                        {str(k): _jsonable(v) for k, v in row.items()}
                        for row in cur.fetchmany(cap)
                    ]
                finally:
                    cur.execute("rollback")

    async def _query(
        self,
        principal: Optional[Principal],
        sql: str,
        params: Optional[Sequence[Any]] = None,
        limit: Optional[int] = None,
    ) -> list[dict[str, Any]]:
        dsn = self._resolve_dsn(principal)
        return await asyncio.to_thread(self._run_readonly, dsn, sql, params, limit)

    # -- introspection -------------------------------------------------------

    # The system schemas are inlined rather than bound because they are a
    # fixed literal tuple in this module, and a bound array would make the
    # statement depend on the driver's array adaptation for no benefit.
    _CATALOG_SQL = f"""
        select c.table_schema as schema,
               c.table_name   as name,
               c.column_name  as column,
               c.data_type    as type,
               c.is_nullable  as nullable
          from information_schema.columns c
          join information_schema.tables t
            on t.table_schema = c.table_schema
           and t.table_name   = c.table_name
         where t.table_type in ('BASE TABLE', 'VIEW')
           and c.table_schema not in ({', '.join(repr(s) for s in _SYSTEM_SCHEMAS)})
         order by c.table_schema, c.table_name, c.ordinal_position
    """

    async def _tables(
        self, principal: Optional[Principal], *, refresh: bool = False
    ) -> list[dict[str, Any]]:
        dsn = self._resolve_dsn(principal)
        cached = self._schema_cache.get(dsn)
        if cached and not refresh and cached[0] > time.time():
            return cached[1]

        rows = await asyncio.to_thread(
            self._run_readonly, dsn, self._CATALOG_SQL, [], 5000
        )
        allowed = set(self.schemas) if self.schemas else None
        tables: dict[tuple[str, str], dict[str, Any]] = {}
        for row in rows:
            if allowed is not None and str(row.get("schema")) not in allowed:
                continue
            key = (str(row.get("schema")), str(row.get("name")))
            table = tables.setdefault(
                key, {"schema": key[0], "name": key[1], "columns": []}
            )
            table["columns"].append(
                {
                    "name": row.get("column"),
                    "type": row.get("type"),
                    "nullable": str(row.get("nullable")).upper() == "YES",
                }
            )
        result = list(tables.values())
        self._schema_cache[dsn] = (time.time() + _SCHEMA_CACHE_TTL_S, result)
        return result

    # -- summary + prompt ----------------------------------------------------

    def _qualified(self, table: Mapping[str, Any]) -> str:
        schema = str(table.get("schema") or "public")
        name = str(table.get("name") or "")
        return name if schema == "public" else f"{schema}.{name}"

    def _prompt(self, tables: Sequence[Mapping[str, Any]], error: Optional[str]) -> str:
        ns = self.namespace
        head = [
            f"DATA SOURCE {self.name} (postgres)",
            f"  Runtime access: await window.{ns}.{self.name}.query(sql, params?)"
            " -> { rows } (or { rows: [], error } if it fails).",
            "  Queries run read-only on the server. The app never holds the"
            " credentials, so never ask the user for one and never put a"
            " connection string in the code.",
            "  Fetch inside an effect at runtime and render whatever comes"
            " back; never paste query results into the source.",
        ]
        if error:
            head.append(f"  NOTE: the schema could not be read ({error}).")
            return "\n".join(head)
        if not tables:
            head.append("  NOTE: this database exposes no readable tables.")
            return "\n".join(head)

        head.append("  Tables:")
        for table in tables[:_PROMPT_MAX_TABLES]:
            columns = table.get("columns") or []
            rendered = ", ".join(
                f"{c.get('name')} {c.get('type')}"
                for c in columns[:_PROMPT_MAX_COLUMNS]
            )
            if len(columns) > _PROMPT_MAX_COLUMNS:
                rendered += f", ... (+{len(columns) - _PROMPT_MAX_COLUMNS} more)"
            head.append(f"    {self._qualified(table)}({rendered})")
        if len(tables) > _PROMPT_MAX_TABLES:
            head.append(
                f"    ... (+{len(tables) - _PROMPT_MAX_TABLES} more tables; call"
                f" {self._tool_name('list_tables')} to see them)"
            )
        return "\n".join(head)

    async def list(
        self,
        scope: Optional[Mapping[str, str]] = None,
        *,
        principal: Optional[Principal] = None,
    ) -> ConnectorSummary:
        """The tenant's tables and columns as a scoped ``ConnectorSummary``.

        ``principal`` is an additive keyword the router passes when it has one;
        with only a scope, a stand-in principal carrying that scope is
        synthesized so a per-tenant DSN resolver still routes correctly.
        """
        caller = principal or _principal_from_scope(scope)
        error: Optional[str] = None
        tables: list[dict[str, Any]] = []
        try:
            tables = await self._tables(caller)
        except Exception as exc:
            # A connector that cannot reach its database still reports itself,
            # so the chip renders "not connected" instead of vanishing.
            error = str(exc)

        entry: dict[str, Any] = {
            "kind": "postgres",
            "name": self.name,
            "connected": error is None,
            "tableCount": len(tables),
            "tables": [
                {
                    "schema": t["schema"],
                    "name": t["name"],
                    "qualified": self._qualified(t),
                    "columns": t["columns"],
                }
                for t in tables
            ],
        }
        if error:
            entry["error"] = error
        return {
            "kinds": ["postgres"],
            self.name: entry,
            "prompt": self._prompt(tables, error),
        }

    def detect_used(self, files: FileMap) -> Sequence[str]:
        """Scan files for references to this connector's namespace."""
        aliases = {self.name, self.name.replace("-", "_")}
        needles = [f".{a}." for a in aliases]
        needles += [f'["{a}"]' for a in aliases] + [f"['{a}']" for a in aliases]
        for source in (files or {}).values():
            if not isinstance(source, str):
                continue
            if any(needle in source for needle in needles):
                return [self.name]
        return []

    # -- agent tools ---------------------------------------------------------

    def _tool_name(self, base: str) -> str:
        """Namespace a tool name when more than one Postgres connector could be
        mounted. The default single connector keeps the plain names."""
        if self.name == "postgres":
            return base
        slug = re.sub(r"[^a-z0-9_]+", "_", self.name.lower()).strip("_")
        return f"{slug}_{base}" if slug else base

    def tools(self) -> Sequence[AgentTool]:
        """The ``list_tables`` / ``describe_table`` / ``run_query`` agent tools
        (read-only)."""
        return (
            _ListTablesTool(self),
            _DescribeTableTool(self),
            _RunQueryTool(self),
        )

    # -- runtime bridge ------------------------------------------------------

    async def handle(
        self, kind: str, payload: Any, ctx: RuntimeContext
    ) -> Any:
        """Parent side of the ``window.<ns>`` RPC: run the scoped query.

        Answers ``<ns>-query`` (and the ``postgres`` connector name). Returns
        ``{"rows": [...]}`` or ``{"error": "..."}`` - the DSN, the password and
        the host never appear in the reply. That is the whole point of routing
        the app's data access through here.
        """
        if kind not in self.bridge_kinds:
            return {"error": f"{self.name} does not handle {kind!r}"}
        body = payload if isinstance(payload, Mapping) else {}
        target = body.get("connector") or body.get("name")
        if target and str(target) not in (self.name, self.name.replace("-", "_")):
            return {"rows": [], "error": f"unknown connector {target!r}"}

        sql = body.get("sql") or body.get("query")
        if not isinstance(sql, str) or not sql.strip():
            return {"rows": [], "error": "sql is required"}
        params = body.get("params")
        if params is not None and not isinstance(params, (list, tuple)):
            return {"rows": [], "error": "params must be an array"}

        principal = ctx.get("principal") if isinstance(ctx, Mapping) else None
        if principal is None:
            principal = _principal_from_scope(
                ctx.get("scope") if isinstance(ctx, Mapping) else None
            )
        try:
            rows = await self._query(
                principal, sql, list(params or []), body.get("limit")
            )
        except Exception as exc:
            return {"rows": [], "error": str(exc)}
        return {"rows": rows}

    # -- in-iframe shim ------------------------------------------------------

    def shim(self, summary: ConnectorSummary, ns: str) -> str:
        """The in-iframe resolver JS for ``window.<ns>`` queries.

        Self-contained: it installs the shared bridge helper if the core shim
        has not already, then registers ``query`` under this connector's name on
        ``window.__harnessConnectors`` (the object the core shim proxies) and,
        if it already exists, on ``window[ns]`` directly.
        """
        names = json.dumps([self.name])
        return bridge_preamble(ns) + f"""
(function () {{
  var send = window.__harnessBridge.send;
  {names}.forEach(function (name) {{
    window.__harnessRegister(name, {{
      query: function (sql, params) {{
        return send(
          {{ type: {json.dumps(ns)} + '-query', connector: name, sql: sql, params: params || [] }},
          function (d) {{ return {{ rows: d.rows || [] }}; }},
          {{ rows: [] }}
        );
      }}
    }});
  }});
}})();
"""


# ---------------------------------------------------------------------------
# Agent tools
# ---------------------------------------------------------------------------


class _PgTool(AgentTool):
    """Base for the Postgres agent tools: read-only, never mutates files."""

    mutates_files = False

    def __init__(self, connector: _PostgresConnector) -> None:
        self._c = connector

    def available(self, ctx: ToolContext) -> bool:
        return True

    def prompt_fragment(self, ctx: ToolContext) -> str:
        return ""

    def _principal(self, ctx: ToolContext) -> Principal:
        principal = ctx.get("principal") if isinstance(ctx, Mapping) else None
        if isinstance(principal, Principal):
            return principal
        return _principal_from_scope(
            ctx.get("scope") if isinstance(ctx, Mapping) else None
        )

    async def execute(
        self, args: Mapping[str, Any], ctx: ToolContext
    ) -> Mapping[str, Any]:
        raise NotImplementedError


class _ListTablesTool(_PgTool):
    """``list_tables`` - the connector's tables and their columns."""

    def __init__(self, connector: _PostgresConnector) -> None:
        super().__init__(connector)
        self.name = connector._tool_name("list_tables")
        self.schema: ToolSchema = {
            "type": "function",
            "function": {
                "name": self.name,
                "description": (
                    f"List the tables and views in the {connector.name} Postgres "
                    "database, with their columns and types."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "schema": {
                            "type": "string",
                            "description": (
                                "Optional schema to filter by, e.g. public."
                            ),
                        },
                        "refresh": {
                            "type": "boolean",
                            "description": (
                                "Re-read the catalog instead of using the "
                                "cached listing."
                            ),
                        },
                    },
                    "additionalProperties": False,
                },
            },
        }

    def prompt_fragment(self, ctx: ToolContext) -> str:
        return (
            f"- {self.name}(schema?): list the {self._c.name} tables and their "
            "columns."
        )

    async def execute(
        self, args: Mapping[str, Any], ctx: ToolContext
    ) -> Mapping[str, Any]:
        try:
            tables = await self._c._tables(
                self._principal(ctx), refresh=bool(args.get("refresh"))
            )
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        wanted = args.get("schema")
        if isinstance(wanted, str) and wanted:
            tables = [t for t in tables if t["schema"] == wanted]
        return {
            "ok": True,
            "connector": self._c.name,
            "tables": [
                {
                    "table": self._c._qualified(t),
                    "columns": [
                        f"{c['name']} {c['type']}" for c in t["columns"]
                    ],
                }
                for t in tables
            ],
        }


class _DescribeTableTool(_PgTool):
    """``describe_table`` - columns plus a few sample rows."""

    def __init__(self, connector: _PostgresConnector) -> None:
        super().__init__(connector)
        self.name = connector._tool_name("describe_table")
        self.schema: ToolSchema = {
            "type": "function",
            "function": {
                "name": self.name,
                "description": (
                    "Return a table's columns, types, and a few sample rows. "
                    "Use it to understand a table's shape before writing a "
                    "query against it."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table": {
                            "type": "string",
                            "description": (
                                "Table name, optionally schema-qualified "
                                "(schema.table). Defaults to the public schema."
                            ),
                        },
                        "limit": {
                            "type": "integer",
                            "description": "How many sample rows to return.",
                        },
                    },
                    "required": ["table"],
                    "additionalProperties": False,
                },
            },
        }

    def prompt_fragment(self, ctx: ToolContext) -> str:
        return (
            f"- {self.name}(table): a table's columns plus a few sample rows."
        )

    async def execute(
        self, args: Mapping[str, Any], ctx: ToolContext
    ) -> Mapping[str, Any]:
        raw = args.get("table")
        if not isinstance(raw, str) or not raw.strip():
            return {"ok": False, "error": "table is required"}
        schema, _, table = raw.strip().rpartition(".")
        schema = schema or "public"
        # Identifiers cannot be bound as parameters, so they are validated
        # against a strict identifier pattern and then quoted.
        if not _IDENT_RE.match(schema) or not _IDENT_RE.match(table):
            return {
                "ok": False,
                "error": (
                    f"invalid table name {raw!r}: expected an identifier like "
                    "units or public.units"
                ),
            }
        try:
            limit = max(1, min(int(args.get("limit") or 3), 20))
        except (TypeError, ValueError):
            limit = 3
        principal = self._principal(ctx)
        try:
            columns = await self._c._query(
                principal,
                "select column_name as name, data_type as type,"
                " is_nullable as nullable"
                " from information_schema.columns"
                " where table_schema = %s and table_name = %s"
                " order by ordinal_position",
                [schema, table],
                200,
            )
            if not columns:
                return {
                    "ok": False,
                    "error": f"table {schema}.{table} not found or not readable",
                }
            rows = await self._c._query(
                principal,
                f"select * from {_quote_ident(schema)}.{_quote_ident(table)}"
                f" limit {limit}",
                [],
                limit,
            )
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        return {
            "ok": True,
            "connector": self._c.name,
            "table": f"{schema}.{table}",
            "columns": columns,
            "sample": rows,
        }


class _RunQueryTool(_PgTool):
    """``run_query`` - a capped read-only query, for shaping a view."""

    def __init__(self, connector: _PostgresConnector) -> None:
        super().__init__(connector)
        self.name = connector._tool_name("run_query")
        self.schema: ToolSchema = {
            "type": "function",
            "function": {
                "name": self.name,
                "description": (
                    "Run a read-only SQL query to sanity-check a result's "
                    f"shape while building. Capped at {connector.plan_max_rows} "
                    "rows. The running app must fetch its own data at runtime "
                    f"through window.{connector.namespace}.{connector.name}"
                    ".query - never paste these rows into the source."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "sql": {
                            "type": "string",
                            "description": "The SELECT statement to run.",
                        },
                        "params": {
                            "type": "array",
                            "description": (
                                "Optional positional parameters for %s "
                                "placeholders."
                            ),
                            "items": {},
                        },
                    },
                    "required": ["sql"],
                    "additionalProperties": False,
                },
            },
        }

    def prompt_fragment(self, ctx: ToolContext) -> str:
        return (
            f"- {self.name}(sql): run a capped read-only query while building, "
            "to check a result's shape. Never inline its rows into the app."
        )

    async def execute(
        self, args: Mapping[str, Any], ctx: ToolContext
    ) -> Mapping[str, Any]:
        sql = args.get("sql")
        if not isinstance(sql, str) or not sql.strip():
            return {"ok": False, "error": "sql is required"}
        params = args.get("params")
        if params is not None and not isinstance(params, (list, tuple)):
            return {"ok": False, "error": "params must be an array"}
        try:
            rows = await self._c._query(
                self._principal(ctx),
                sql,
                list(params or []),
                self._c.plan_max_rows,
            )
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        return {
            "ok": True,
            "connector": self._c.name,
            "rowCount": len(rows),
            "rows": rows,
            "truncated": len(rows) >= self._c.plan_max_rows,
        }


def postgres_connector(
    dsn: Dsn,
    *,
    name: str = "postgres",
    namespace: str = "app",
    schemas: Optional[Sequence[str]] = None,
    max_rows: int = 1000,
    plan_max_rows: int = 50,
    statement_timeout_ms: int = 15_000,
) -> ConnectorProvider:
    """Build a Postgres connector.

    Args:
        dsn: A DSN string (e.g. ``"postgresql://user:pass@host/db"``), or a
            callable ``(principal) -> dsn`` for database-per-tenant hosts.
        name: The name the generated app reaches it by
            (``window.<ns>.<name>.query``). Give a second Postgres connector a
            distinct name and its agent tools are namespaced to match.
        namespace: The runtime namespace to render into the prompt.
            ``HarnessAgent`` overwrites this at boot with its own, so the
            prompt, the generated code and the bridge stay in agreement.
        schemas: Restrict introspection to these schemas. Defaults to every
            non-system schema the connection can see.
        max_rows: Row cap for a runtime query from the generated app.
        plan_max_rows: Row cap for the agent's own ``run_query`` while
            building.
        statement_timeout_ms: Per-statement timeout applied server-side.

    Returns:
        A :class:`~speculos_harness.interfaces.ConnectorProvider` to pass in
        ``HarnessAgent(connectors=[...])``.
    """
    return _PostgresConnector(
        dsn=dsn,
        name=name,
        namespace=namespace,
        schemas=schemas,
        max_rows=max_rows,
        plan_max_rows=plan_max_rows,
        statement_timeout_ms=statement_timeout_ms,
    )
