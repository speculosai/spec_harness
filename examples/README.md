# Examples

Speculos Harness deployments you can run. Two are a full stack - a React embed, a
FastAPI backend, and a bundler sidecar - and one is the workspace on its own,
against a mock backend in the page. All three are kept small enough to read in
one sitting and copy into your own product. The recurring customer throughout is
**Northwind Property Group**, a property-management SaaS whose operators build a
late-payments board by asking for one.

## The examples

| Example | What it shows |
|---|---|
| [`minimal/`](./minimal) | The smallest complete deployment: `<HarnessProvider>` + `<Builder>`, a FastAPI backend with `LiteLLMProvider` + `SQLiteProjectStore`, a Northwind build brief, and the three-service `docker-compose`. File and package tools only - no connectors. Start here. |
| [`with-connectors/`](./with-connectors) | Extends the minimal backend with live data: a `postgres_connector` against Northwind's database, two `mcp_connector` entries, per-tenant scoping via `Principal.scope` and a DSN resolver, and a `TelemetrySink` that meters per-principal token usage, cache reads separate. |
| [`frontend-only/`](./frontend-only) | The workspace with nothing behind it: `<HarnessProvider>` + `<Builder>` against an in-browser mock backend that speaks the real protocol. Three guided demos - Northwind, an online shop, a furniture factory - you click through end to end. No key, no Docker, no bundler. |

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

`frontend-only/` is the odd one out and the fastest to run: `npm install && npm
run dev`, no key and no containers. The workspace is the real one, but the agent
is a script and the backend is a few hundred lines of TypeScript answering
`fetch` inside the page. It is there to be clicked through - three companies
whose questions change every week, each ending on the step a dashboard cannot
take: sending the reminder, releasing the order, booking the check. Read its
`src/mock/server.ts` for a second, very small implementation of the wire
protocol, and its `npm run check` for a machine-checked reading of the same
contract.

The two full-stack examples use the same base URL (`/api/builder`) and namespace
(`app`) on the frontend and backend, because those two strings must agree across
the wire - the namespace binds the system prompt, the generated code, and the
preview bridge. `frontend-only/` moves the base URL (its mock answers
`/demo-api/<demo>`) and keeps the namespace, for the same reason.
