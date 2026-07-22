# With-connectors example — live data and metering

The minimal example builds apps from files and pasted CSVs. This one wires the
agent to real data and meters what it costs — the setup a multi-tenant SaaS
actually ships. It builds directly on [`../minimal`](../minimal); read that
first, then read this for what is added.

> [!IMPORTANT]
> **Pre-release — code lands with v0.1.** The code here is real and written
> against the decided public API, but the imported package is spec-first. The
> backend boots and answers `/capabilities`; the working routes and the
> reference connectors are stubs until the **v0.1 code drop**. Watch or star the
> repo to follow.

## What this adds

- **A Postgres connector.** `postgres_connector(dsn=...)` gives the agent
  read views over a live database — it lists tables as prompt context, exposes
  read-only query tools, and answers the preview's data fetches through the
  bridge. Credentials stay server-side; the generated app asks the bridge for
  rows, never for a password.
- **Two MCP connectors.** `mcp_connector(url=...)` bridges to any MCP server —
  an open standard, so one adapter reaches all of them. This example points at a
  Notion and a Linear MCP server.
- **Per-tenant scoping.** A `MyAuth` provider stamps `Principal.scope["tenant"]`
  on every request, and the Postgres DSN is resolved *from that scope*, so two
  tenants on the same connector list only ever reach their own database.
- **Metering.** A `Metering(TelemetrySink)` records per-principal token usage
  after every generation — input, output, and cache reads separately — keyed by
  tenant, ready for per-seat billing or team caps.

## Per-tenant scoping — how it fits together

Scoping is one field threaded through three places:

1. **Auth stamps the tenant.** `MyAuth.resolve` returns
   `Principal(user_id=..., can_edit=True, scope={"tenant": user.org_id})`. The
   `Principal` follows the request everywhere from here.

2. **The DSN resolves from the scope.** Instead of a fixed connection string,
   the connector is handed a callable:

   ```python
   postgres_connector(dsn=dsn_for_tenant)      # dsn_for_tenant(principal) -> str
   ```

   `dsn_for_tenant` reads `principal.scope["tenant"]` and returns that tenant's
   connection string. A single-tenant deployment would pass a plain string
   instead — `postgres_connector(dsn=os.environ["DATABASE_URL"])`.

3. **Connectors resolve per request.** Every runtime data fetch runs against the
   caller's scope, so the same connector list serves every tenant while each one
   sees only its own rows. No per-tenant connector wiring, no cross-tenant leak.

The same `scope` also tags telemetry, which is why the metering rows below are
keyed by tenant.

## Metering — token usage per principal

`Metering.on_generation(e)` fires once per generation. It records
`e.principal.user_id`, `e.model`, and the token counts from `e.usage`. Cache
reads (`e.usage.cache_read_tokens`) and cache writes are reported separately
from fresh input tokens because providers bill them differently — so the sink
records them as their own columns, and `LiteLLMProvider(..., supports_prompt_cache=True)`
turns cache-breakpoint placement on. Point `record_usage` at whatever your
per-seat billing, team caps, or usage graphs read from.

## Environment

Copy `.env.example` to `.env` and fill in your values (all placeholders):

| Variable | Required | Example (placeholder) | What it does |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | `sk-your-key-here` | Provider key for the default model (`anthropic/claude-sonnet-5`). |
| `DATABASE_URL` | yes | `postgresql://user:pass@db/northwind` | Base connection string; the resolver derives each tenant's database from it. |
| `NOTION_MCP_URL` | no | `https://your-mcp-host.example/notion` | First MCP server URL. |
| `LINEAR_MCP_URL` | no | `https://your-mcp-host.example/linear` | Second MCP server URL. |
| `HARNESS_MODEL` | no | `anthropic/claude-sonnet-5` | Company-wide default model, in LiteLLM notation. |
| `BUNDLER_URL` | no | `http://bundler:8081` | Where the build-service sidecar is reachable. |

## Running it (at v0.1)

Swap this `main.py` in for the minimal backend's, or point the minimal
`docker-compose.yml` `agent` build at this directory. The frontend
(`../minimal/web`) and the bundler are unchanged — connectors are a
backend-side concern, surfaced to the workspace through `/capabilities`.
