/**
 * @speculos-harness/connectors-mcp
 *
 * The reference MCP connector — the TypeScript client half (the bridge handler and the
 * in-iframe resolver shim). MCP is the cleanest connector to ship first because it is
 * an open standard. The server half (agent tools + the parent-side data fetch) lives in
 * the Python kit as `speculos_harness.connectors.mcp`; this package and that one are
 * versioned together.
 *
 * A connector bundles everything a data source needs: the tools the agent can call, the
 * lines it adds to the system prompt, the parent-side RPC handler, and the in-iframe
 * resolver shim the generated app fetches through. Credentials stay server-side — the
 * generated app asks the bridge for rows, never for a URL or a token.
 *
 * PRE-RELEASE: the `mcpConnector` factory signature is frozen; the `handle` and `shim`
 * bodies are stubs that throw. The implementation — carved from the production MCP
 * client behind Speculos — arrives with the v0.1 code drop.
 */

import type {
  ConnectorProvider,
  ConnectorSummary,
  RuntimeContext,
} from '@speculos-harness/protocol';

/** Thrown by every stub in this package until the v0.1 code drop lands. */
const NOT_IMPLEMENTED = 'speculos-harness: not yet implemented — arrives with the v0.1 code drop';

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
 * TODO(v0.1): port the MCP client (`handle` bridging `<ns>-mcp` calls to the MCP server,
 * `list` summarizing available tools for the chip UI and prompt, and `shim` contributing
 * the in-iframe `window.<ns>.mcp` resolver), parameterizing `clientInfo.name`.
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
