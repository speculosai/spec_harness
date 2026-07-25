"""Speculos Harness backend with live data - Northwind Property Group.

This extends the minimal example (``../minimal/backend/main.py``) with the parts
that turn a file-only builder into one that queries a live database and calls
out to MCP servers, under real per-tenant scoping, with token usage metered per
principal.

Read the minimal example first - this file only annotates what is *added*:

1. A ``postgres_connector`` against Northwind's database, with the DSN as a
   per-tenant resolver so two tenants on the same connector list see only their
   own data.
2. Two ``mcp_connector`` entries - an open-standard bridge to any MCP server.
3. A ``Metering`` telemetry sink that records per-principal token usage,
   including cache reads (billed separately from fresh input tokens).
4. A ``MyAuth`` provider that stamps ``Principal.scope["tenant"]``, which is what
   the DSN resolver and the connectors key off.

Postgres and MCP are the reference connectors, and they ship here. The wider
governed connector catalog - warehouses, CRMs, and internal systems, granted per
person by an admin - is a closed-beta module: https://speculos.ai/enterprise
"""

from __future__ import annotations

import os

from fastapi import FastAPI, Request

from speculos_harness import (
    AuthDenied,
    AuthProvider,
    HarnessAgent,
    Principal,
    TelemetrySink,
)
from speculos_harness.connectors import mcp_connector, postgres_connector
from speculos_harness.llm import LiteLLMProvider
from speculos_harness.stores import SQLiteProjectStore

# ---------------------------------------------------------------------------
# Configuration (see .env.example).
# ---------------------------------------------------------------------------

DEFAULT_MODEL = os.environ.get("HARNESS_MODEL", "anthropic/claude-fable-5")
BUNDLER_URL = os.environ.get("BUNDLER_URL", "http://bundler:8081")

#: The base connection string for Northwind's database. In a single-tenant
#: deployment you would pass this directly as ``postgres_connector(dsn=...)``.
#: Here we wrap it in a resolver (below) to scope queries per tenant.
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://user:pass@db/northwind")

INSTRUCTIONS = """
We are Northwind Property Group, a property-management company.

- Amounts are in USD. Format them like $1,234.56.
- The fiscal year runs April 1 to March 31.
- Use the Northwind design system for every app.
- Every table needs a CSV export button.
- When a view needs data, read it from the connected database - never invent
  figures.
""".strip()


# ---------------------------------------------------------------------------
# Auth - stamp the tenant onto every Principal.
#
# The `scope` is the load-bearing field here: the DSN resolver and the
# connectors read `scope["tenant"]` to decide which data the request may touch.
# ---------------------------------------------------------------------------


class MyAuth(AuthProvider):
    async def resolve(self, request: Request):
        user = await my_session_lookup(request.headers.get("authorization"))
        if user is None:
            return None  # -> plain 401
        if user.plan_expired:
            return AuthDenied(status=402, message="upgrade required")
        return Principal(
            user_id=user.id,
            can_edit=True,
            scope={"tenant": user.org_id},  # <- drives per-tenant data scoping
        )


async def my_session_lookup(_authorization: str | None):
    """Stand-in for your real session lookup.

    TODO: replace with your auth library. Returns an object with ``id``,
    ``org_id``, and ``plan_expired``, or ``None`` for an unauthenticated
    request.
    """
    raise NotImplementedError("wire up your own session lookup")


# ---------------------------------------------------------------------------
# Per-tenant DSN resolution.
#
# `postgres_connector(dsn=...)` accepts either a fixed string (single-tenant) or
# a callable resolved per request against the caller's Principal. Northwind runs
# a database per tenant, so we resolve the DSN from `scope["tenant"]`. The
# credentials stay server-side - the generated app asks the bridge for rows,
# never for a password.
# ---------------------------------------------------------------------------


def dsn_for_tenant(principal: Principal) -> str:
    """Return the DSN for the caller's tenant.

    TODO: map a tenant id to its connection string however you store it - a
    lookup table, a secrets manager, a templated URL. This placeholder just
    templates the tenant into a database name.
    """
    tenant = (principal.scope or {}).get("tenant", "public")
    return DATABASE_URL.replace("/northwind", f"/northwind_{tenant}")


# ---------------------------------------------------------------------------
# Metering - record per-principal token usage after every generation.
#
# The hook fires once per generation with the model, the principal who ran it,
# and the token counts. Cache reads are reported separately because providers
# bill them differently from fresh input tokens - meter them separately too.
# Inference is billed by your provider, on your keys - no markup.
# ---------------------------------------------------------------------------


class Metering(TelemetrySink):
    def on_generation(self, e) -> None:
        # `e` carries `.model`, `.principal`, `.usage`, and `.latency_ms`.
        tenant = (e.principal.scope or {}).get("tenant", "unknown")
        record_usage(
            tenant=tenant,
            user=e.principal.user_id,
            model=e.model,
            tokens_in=e.usage.input_tokens,
            tokens_out=e.usage.output_tokens,
            cache_read=e.usage.cache_read_tokens,   # billed separately
            cache_write=e.usage.cache_write_tokens,
            latency_ms=e.latency_ms,
        )


def record_usage(**row) -> None:
    """Stand-in for your metering store (a usage table, a billing meter, a
    metrics pipeline). Called once per generation.

    TODO: persist `row` wherever your per-seat billing / team caps / usage
    graphs read from.
    """
    raise NotImplementedError("wire up your own usage recorder")


# ---------------------------------------------------------------------------
# Assemble the agent and mount it.
# ---------------------------------------------------------------------------

agent = HarnessAgent(
    store=SQLiteProjectStore("./projects.db"),
    llm=LiteLLMProvider(
        model=DEFAULT_MODEL,
        api_key=os.environ.get("ANTHROPIC_API_KEY", "sk-ant-..."),
        allowed_models=[
            "anthropic/claude-fable-5",
            "openai/gpt-5.6-sol",
            "zai/glm-5.2",  # open weights
        ],
        supports_prompt_cache=True,  # place cache breakpoints; cache reads metered above
    ),
    instructions=INSTRUCTIONS,
    bundler_url=BUNDLER_URL,
    namespace="app",
    auth=MyAuth(),
    connectors=[
        # Live database, scoped per tenant via the resolver above.
        postgres_connector(dsn=dsn_for_tenant),
        # Two MCP servers - an open standard, so one adapter reaches any of them.
        mcp_connector(url=os.environ.get("NOTION_MCP_URL", "https://your-mcp-host.example/notion")),
        mcp_connector(url=os.environ.get("LINEAR_MCP_URL", "https://your-mcp-host.example/linear")),
    ],
    telemetry=Metering(),
)

app = FastAPI(title="Northwind Harness (with connectors)")
app.include_router(agent.router, prefix="/api/builder")


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
