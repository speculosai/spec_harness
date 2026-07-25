# @speculos-harness/connectors-mcp

The reference MCP connector for [Speculos Harness](https://speculos.ai) - the TypeScript **client half**: the bridge handler and the in-iframe resolver shim. The **server half**, the agent tools and the parent-side data fetch, lives in the Python kit as `speculos_harness.connectors.mcp` (the factory `mcp_connector(url=...)`). The two halves are versioned together.

## What a connector is

A connector bundles everything a data source needs:

- the **tools** the agent can call (server half),
- the **prompt lines** it contributes (server half),
- the parent-side **RPC handler** (`handle`), and
- the in-iframe **resolver shim** (`shim`) the generated app fetches through.

Credentials stay server-side. The generated app, sealed in the null-origin iframe, asks the bridge for rows - never for a URL or a token. Both halves resolve against the caller's `Principal` scope, so two tenants pointed at the same connector see only their own data.

## What it gives you

`mcpConnector({ url, clientName? })` returns the client half as a `ConnectorProvider` (from `@speculos-harness/protocol`): `list` for the chip UI and prompt context, `handle` for `<ns>-mcp` bridge calls, and `shim` for the in-iframe `window.<ns>.mcp` resolver.

## Usage

Client half (React):

```tsx
import { mcpConnector } from '@speculos-harness/connectors-mcp'
import { HarnessProvider, Builder } from '@speculos-harness/react'

<HarnessProvider
  baseUrl="/api/builder"
  auth={{ getHeaders }}
  connectors={[mcpConnector({ url: 'https://your-mcp-host.example/notion' })]}
>
  <Builder projectId={projectId} />
</HarnessProvider>
```

Server half (Python), paired at boot:

```python
from speculos_harness.connectors import mcp_connector

agent = HarnessAgent(
    connectors=[mcp_connector(url="https://your-mcp-host.example/notion")],
    ...
)
```

## Writing your own

`ConnectorProvider` is open, so any data source can be wired the same way: MCP and Postgres are the references in this repo. The wider governed catalog - warehouses, CRMs, internal systems, granted per person by an admin - is a [closed-beta module](https://speculos.ai/enterprise).

## License

Apache-2.0.
