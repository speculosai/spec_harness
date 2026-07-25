# Examples

Complete Speculos Harness deployments you can run. Each is a full stack - a
React embed, a FastAPI backend, and a bundler sidecar - kept small enough to
read in one sitting and copy into your own product. The recurring customer
throughout is **Northwind Property Group**, a property-management SaaS whose
operators build an arrears dashboard by asking for one.

## The examples

| Example | What it shows |
|---|---|
| [`minimal/`](./minimal) | The smallest complete deployment: `<HarnessProvider>` + `<Builder>`, a FastAPI backend with `LiteLLMProvider` + `SQLiteProjectStore`, a Northwind build brief, and the three-service `docker-compose`. File and package tools only - no connectors. Start here. |
| [`with-connectors/`](./with-connectors) | Extends the minimal backend with live data: a `postgres_connector` against Northwind's database, two `mcp_connector` entries, per-tenant scoping via `Principal.scope` and a DSN resolver, and a `TelemetrySink` that meters per-principal token usage, cache reads separate. |

## Run one

```bash
git clone https://github.com/speculosai/spec_harness
cd spec_harness/examples/minimal
export ANTHROPIC_API_KEY=sk-ant-...   # any LiteLLM-supported provider works
docker compose up
```

## How to read them

Start with `minimal/` - `backend/main.py` and `web/BuilderPage.tsx` between them
are the whole integration: one mounted router, one embedded component, one
sidecar. Then read `with-connectors/` for the parts that turn a file-only
builder into one that queries real data under multi-tenant scoping.

Both examples use the same base URL (`/api/builder`) and namespace (`app`) on
the frontend and backend, because those two strings must agree across the wire -
the namespace binds the system prompt, the generated code, and the preview
bridge.
