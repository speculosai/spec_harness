# With-connectors example - live data and metering

The minimal example builds apps from files and pasted CSVs. This one wires the
agent to real data and meters what it costs - the setup a multi-tenant SaaS
ships. It builds on [`../minimal`](../minimal); read that first, then read this
for what is added.

## What this adds

- **A Postgres connector.** `postgres_connector(dsn=...)` gives the agent read
  views over a live database - it lists tables as prompt context, exposes
  read-only query tools, and answers the preview's data fetches through the
  bridge. Credentials stay server-side; the generated app asks the bridge for
  rows, never for a password.
- **Two MCP connectors.** `mcp_connector(url=...)` bridges to any MCP server -
  an open standard, so one adapter reaches all of them. This example points at a
  Notion and a Linear MCP server.
- **Per-tenant scoping.** A `MyAuth` provider stamps `Principal.scope["tenant"]`
  on every request, and the Postgres DSN is resolved *from that scope*, so two
  tenants on the same connector list only ever reach their own database.
- **Metering.** A `Metering(TelemetrySink)` records per-principal token usage
  after every generation - input, output, and cache reads separately - keyed by
  tenant, ready for per-seat billing or team caps.

Postgres and MCP are the reference connectors, and they ship in this repo. The
wider governed connector catalog - warehouses, CRMs, and internal systems,
granted per person by an admin - is a closed-beta module, deployed on your own
servers: [talk to our team](https://speculos.ai/enterprise).

## Per-tenant scoping

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
   connection string. A single-tenant deployment passes a plain string instead -
   `postgres_connector(dsn=os.environ["DATABASE_URL"])`.

3. **Connectors resolve per request.** Every runtime data fetch runs against the
   caller's scope, so the same connector list serves every tenant while each one
   sees only its own rows. No per-tenant connector wiring, no cross-tenant leak.

The same `scope` tags telemetry, which is why the metering rows below are keyed
by tenant.

## Metering

`Metering.on_generation(e)` fires once per generation. It records
`e.principal.user_id`, `e.model`, and the token counts from `e.usage`. Cache
reads (`e.usage.cache_read_tokens`) and cache writes are reported separately
from fresh input tokens because providers bill them differently, and
`LiteLLMProvider(..., supports_prompt_cache=True)` turns cache-breakpoint
placement on. Point `record_usage` at whatever your per-seat billing, team caps,
or usage graphs read from. Inference is billed by your provider, on your keys -
no markup.

## Environment

Copy `.env.example` to `.env` and fill in your values (all placeholders):

| Variable | Required | Example (placeholder) | What it does |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | `sk-ant-...` | Provider key for the default model (`anthropic/claude-fable-5`). |
| `DATABASE_URL` | yes | `postgresql://user:pass@db/northwind` | Base connection string; the resolver derives each tenant's database from it. |
| `NOTION_MCP_URL` | no | `https://your-mcp-host.example/notion` | First MCP server URL. |
| `LINEAR_MCP_URL` | no | `https://your-mcp-host.example/linear` | Second MCP server URL. |
| `HARNESS_MODEL` | no | `anthropic/claude-fable-5` | Company-wide default model, in LiteLLM notation. |
| `BUNDLER_URL` | no | `http://bundler:8081` | Where the build-service sidecar is reachable. |

## Running it

This directory carries its own `requirements.txt` and `Dockerfile`, so point the
`agent` service in [`../minimal/docker-compose.yml`](../minimal/docker-compose.yml)
at it (the context stays the repository root, like the minimal example, so the
kit installs from this checkout):

```yaml
agent:
  build:
    context: ../..
    dockerfile: examples/with-connectors/Dockerfile
```

Two things differ from the minimal example. The Postgres driver is an optional
extra, so this example installs the kit with the `[postgres]` extra rather than
the base package. And `DATABASE_URL` has to point at a database you supply - the compose
file has no `db` service, on the assumption that a real deployment already has
one. Add one if you want the example self-contained.

The frontend (`../minimal/web`) and the bundler are unchanged - connectors are a
backend-side concern, surfaced to the workspace through `/capabilities`.
