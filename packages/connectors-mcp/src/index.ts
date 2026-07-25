/**
 * @speculos-harness/connectors-mcp
 *
 * The reference MCP connector - the TypeScript client half (the bridge handler and the
 * in-iframe resolver shim). The server half (agent tools + the parent-side data fetch)
 * lives in the Python kit as `speculos_harness.connectors.mcp`; this package and that
 * one are versioned together.
 *
 * A connector bundles everything a data source needs: the tools the agent can call, the
 * lines it adds to the system prompt, the parent-side RPC handler, and the in-iframe
 * resolver shim the generated app fetches through. Credentials stay server-side - the
 * generated app asks the bridge for rows, never for a URL or a token.
 */

import type {
  ConnectorProvider,
  ConnectorSummary,
  RuntimeContext,
} from '@speculos-harness/protocol';

/** Placeholder message for the exports the implementation drops into. */
const NOT_IMPLEMENTED = '@speculos-harness/connectors-mcp: implementation pending';

/** Options for {@link mcpConnector}. */
export interface McpConnectorOptions {
  /** The MCP server URL to bridge to. */
  url: string;
  /**
   * The `clientInfo.name` this connector announces to the MCP server. Defaults to a
   * neutral Speculos Harness identifier.
   */
  clientName?: string;
}

/**
 * Create the client half of the reference MCP connector: the `handle` that the preview
 * bridge forwards `<ns>-mcp` messages to, and the `shim` contribution injected into the
 * in-iframe resolver so a generated app can call MCP tools through the bridge.
 *
 * Pair it with `mcp_connector(url=...)` on the Python side (the server half that
 * contributes the agent tools and the actual per-request fetch). Both resolve against
 * the caller's `Principal` scope, so two tenants on the same connector see only their
 * own data.
 *
 * TODO: the MCP client - `handle` bridging `<ns>-mcp` calls to the MCP server, `list`
 * summarizing available tools for the chip UI and prompt, and `shim` contributing the
 * in-iframe `window.<ns>.mcp` resolver, with `clientInfo.name` parameterized.
 */
export function mcpConnector(opts: McpConnectorOptions): ConnectorProvider {
  const _url = opts.url;
  return {
    async list(_scope?: Record<string, string>): Promise<ConnectorSummary> {
      throw new Error(NOT_IMPLEMENTED);
    },
    async handle(_kind: string, _payload: unknown, _ctx: RuntimeContext): Promise<unknown> {
      throw new Error(NOT_IMPLEMENTED);
    },
    shim(_summary: ConnectorSummary, _ns: string): string {
      throw new Error(NOT_IMPLEMENTED);
    },
  };
}
