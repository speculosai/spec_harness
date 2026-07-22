# Connectors

A connector is how a generated app gets real data. Without one, the agent builds
file-only apps — real, running, but working only from what the user typed or
uploaded. With one, an app for **Northwind Property Group** can run raw SQL
against their live arrears database and render "$1.4M outstanding across 812
units" — while the database password never enters the sandbox, the generated
code, or the browser.

This page is the connector model and how to configure the two reference
connectors. To author a connector from scratch, the interface is in
[Adapters](./adapters.md); the runtime wire is in
[`spec/preview-bridge.md`](../spec/preview-bridge.md).

## What a connector bundles

The reason connectors are one plugin rather than three loose pieces is that a data
source touches the system in three places that historically drift apart. A
connector keeps them together:

1. **Tools the agent can call.** Server-side functions like `list_tables` or
   `call_app_tool` that the model invokes while building — so it can discover your
   schema and shape queries against it.
2. **Lines it adds to the system prompt.** The context the agent needs to use the
   source well — what tables exist, what the connector is called, how to query it.
3. **The runtime bridge the generated app fetches through.** The parent-side
   handler that answers the app's data requests at runtime, plus an in-iframe shim
   that gives the app a clean `window.<ns>` API to call.

You hand connectors to the agent as a list at boot. Each one carries all three
parts, so adding a data source is adding one entry.

```python
from speculos_harness.connectors import postgres_connector, mcp_connector

agent = HarnessAgent(
    auth=MyAuth(),
    connectors=[
        postgres_connector(dsn=os.environ["DATABASE_URL"]),
        mcp_connector(url="https://your-mcp-host.example/notion"),
    ],
    ...
)
```

## The two reference connectors

### Postgres — `postgres_connector`

Gives the agent live SQL. The generated app queries a real database through the
bridge; the connector holds the DSN server-side and runs the query on the app's
behalf.

```python
from speculos_harness.connectors import postgres_connector

postgres_connector(dsn=os.environ["DATABASE_URL"])
```

The live-database connector is the thing browser-only builders structurally
cannot match: a browser sandbox can only reach an HTTP data API with a key that
lives in the app itself. Here the credential never leaves the server, so the app
can hold no key to leak.

### MCP — `mcp_connector`

Connects any tool or data source that speaks the Model Context Protocol. MCP is an
open standard, which makes it the cleanest way to reach the growing ecosystem of
MCP servers.

```python
from speculos_harness.connectors import mcp_connector

mcp_connector(url="https://your-mcp-host.example/notion")
mcp_connector(url="https://your-mcp-host.example/linear")
```

You can mount several MCP connectors alongside Postgres; the agent sees all of
their tools and picks among them as the build needs.

## The frontend half

A connector has a client half too — the bridge/shim that lets the preview iframe
talk to the parent page. Pass the client halves to `<HarnessProvider connectors>`:

```tsx
import { mcpConnector } from '@speculos-harness/connectors-mcp'

<HarnessProvider
  baseUrl="/api/builder"
  auth={{ getHeaders }}
  connectors={[ mcpConnector({ url: 'https://your-mcp-host.example/notion' }) ]}
>
```

If you omit `connectors` on the provider, the client degrades any connector the
server offers to a never-throw stub — the preview still runs, data calls just
return empty results instead of crashing. That is deliberate: a missing or
unconfigured connector never takes the preview down. Which connector kinds a
server actually has mounted is advertised through `GET /capabilities`, so the
client only wires up what exists.

## Per-`Principal` scoping

Connectors resolve **per request**, against the calling `Principal`'s scope. Two
tenants pointed at the same connector list only ever see their own data, because
the connector is handed the scope on every call and filters accordingly.

This is why identity flows all the way through: `AuthProvider.resolve` produces a
`Principal` with a `scope` (for example `{"tenant": "northwind"}`), that scope
rides on every connector call, and the connector uses it to constrain what it
returns. You do not build a separate authorization layer for data — the
`Principal` you already resolve for auth is the same one that scopes connectors.

## Per-tenant DSN resolvers

A fixed DSN is right for a single-tenant deploy. Multi-tenant hosts that put each
tenant in a **separate database** pass a resolver instead — a function from the
`Principal` to that tenant's DSN — so the connector points at the right database
for whoever is asking:

```python
def dsn_for(tenant: str) -> str:
    return TENANT_DSNS[tenant]

postgres_connector(dsn=lambda principal: dsn_for(principal.scope["tenant"]))
```

The resolver runs per request. A caller in tenant `northwind` queries Northwind's
database; a caller in another tenant queries theirs; neither can reach the other's
rows, because the DSN they resolve to is never the other tenant's. The `dsn`
argument accepts either a plain string or this resolver, so you move from
single-tenant to per-tenant without changing anything else.

## Credentials stay server-side

The single most important property, stated plainly: **the credential lives in the
connector, on the server, and nothing else ever holds it.**

Here is the full path of a data request, so it is concrete:

1. The generated app, running in the null-origin sandbox, calls its
   `window.<ns>` API for data. It cannot fetch your API directly — the frame is
   null-origin by design, precisely to force this step.
2. The request crosses the preview bridge as a `postMessage` to the parent page,
   correlated by id, with a 60-second timeout.
3. The parent forwards it to `POST {base}/connectors/{kind}`, carrying the
   caller's identity.
4. The router resolves the `Principal`, finds the connector for that kind, and
   calls its `handle(...)`, which runs the query with the **server-held**
   credential, scoped to the `Principal`.
5. Only the resulting rows come back — never the DSN, the token, or the password.

So the generated code asks the bridge for rows; it never asks for, sees, or holds
a password. A leaked or hostile generated app has nothing to leak, because the
credential was never in it. The residual risk — prompt injection through the
untrusted rows a connector returns — and its deterministic backstops are covered
honestly in [`spec/security.md`](../spec/security.md); connector output is treated
as untrusted model input.

## What stays out of the open-source connectors

The two reference connectors — Postgres and MCP — cover live SQL and the open MCP
ecosystem, and they ship in v0.1. Broader business-app integration suites and
data-warehouse connectors are commercial add-ons in the Speculos product; they
plug in through this same `ConnectorProvider` interface, so nothing about the
open-source connector model changes when a host adds proprietary ones. If a
connector you need is not here, the interface is small and documented — see
[Adapters](./adapters.md) — and a connector you write is a first-class citizen
alongside the reference two.
