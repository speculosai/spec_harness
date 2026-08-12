/**
 * @speculosai/spec_harness/connectors-mcp
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
 *
 * This half is deliberately thin, and it never contacts the MCP server itself. Doing so
 * would put the server URL - and whatever token it needs - in the browser, which is the
 * one thing the bridge exists to prevent. A runtime call is forwarded to
 * `POST {base}/connectors/mcp` on the mounted router, where the server half holds the
 * credential and resolves the caller's `Principal` scope.
 */

import { BRIDGE_TIMEOUT_MS, DEFAULT_NAMESPACE } from './protocol';
import type {
  ConnectorProvider,
  ConnectorSummary,
  RuntimeContext,
} from './protocol';

/**
 * The bridge message kind this connector answers: an app posting `<ns>-mcp` reaches the
 * MCP server half. Matches `_McpConnector.bridge_kinds` in the Python package, which is
 * what makes `POST {base}/connectors/mcp` route to it.
 */
const KIND = 'mcp';

/** The default connector name - what a generated app reaches it by. */
const DEFAULT_NAME = 'mcp';

/** Options for {@link mcpConnector}. */
export interface McpConnectorOptions {
  /** The MCP server URL to bridge to. */
  url: string;
  /**
   * The `clientInfo.name` this connector announces to the MCP server. Defaults to a
   * neutral Speculos Harness identifier.
   */
  clientName?: string;
  /**
   * The name a generated app reaches this server by: `window.<ns>.<name>.callTool(...)`.
   * Defaults to `"mcp"`. Two MCP servers means giving each a distinct name, here and in
   * the matching `mcp_connector(url=..., name=...)` on the server.
   */
  name?: string;
  /**
   * Where the agent router is mounted, e.g. `"/api/builder"`.
   *
   * Only needed when the preview bridge host does not supply a route on the runtime
   * context (see {@link McpRuntimeContext}). A host that does supply one is the better
   * path, because its request helper already attaches the caller's identity.
   */
  baseUrl?: string;
  /** Extra headers for the {@link McpConnectorOptions.baseUrl} path. Identity goes here. */
  headers?: Record<string, string>;
}

/**
 * The {@link RuntimeContext} this connector's {@link ConnectorProvider.handle} reads, as
 * a preview bridge host may supply it.
 *
 * Both additions are optional and both are routes to the mounted router. `request` is a
 * workspace's own authenticated request helper - it already attaches the auth headers,
 * the `Harness-Protocol` header and any share token, which is why it is preferred over
 * everything else. `baseUrl` is the fallback for a host that wires the bridge by hand;
 * identity then has to come from `headers`.
 */
export interface McpRuntimeContext extends RuntimeContext {
  /** The workspace's authenticated request helper, relative to the mounted router. */
  request?: (path: string, init?: RequestInit) => Promise<Response>;
  /** Where the agent router is mounted. Used when `request` is absent. */
  baseUrl?: string;
  /** Extra headers for the `baseUrl` path. Ignored when `request` is supplied. */
  headers?: Record<string, string>;
}

/** A bridge reply body. The frame's unwrap reads `result`; `{data, error}` is the failure shape. */
type BridgeReplyBody = Record<string, unknown>;

/* ------------------------------------------------------------------------- *
 * Helpers
 * ------------------------------------------------------------------------- */

/** JSON, escaped so it cannot break out of the `<script>` the shim is inlined into. */
function js(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const tail = path.startsWith('/') ? path : `/${path}`;
  return `${base}${tail}`;
}

/**
 * A shaped failure. `handle` never throws and never rejects: the in-frame unwrap turns
 * `{error}` into a shaped empty result, so one bad data call renders empty data instead
 * of taking the preview down.
 */
function failure(message: string): BridgeReplyBody {
  return { data: null, error: message };
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

/** The host of an MCP URL, for display. Never the whole URL - a URL can carry a secret. */
function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The shared in-iframe bridge preamble every connector shim contribution carries.
 *
 * Contributions are injected in any order and each has to stand alone, so each one
 * installs the two globals itself if they are missing. Both installers are idempotent,
 * which is what makes including this N times free.
 *
 * It is the same preamble as `@speculosai/spec_harness/preview`'s `bridgePreamble()` and
 * `speculos_harness.connectors._bridge.bridge_preamble()`. Duplicated rather than
 * imported because the layering rule is that an adapter depends on the protocol package
 * and nothing else - but the three MUST stay semantically identical, or a shim
 * contributed here and one contributed there would not share a transport.
 */
function bridgePreamble(ns: string): string {
  const timedOut = `Request timed out after ${Math.round(BRIDGE_TIMEOUT_MS / 1000)}s`;
  return `
(function () {
  var NS = ${js(ns)};
  if (!window.__harnessBridge) {
    var pending = Object.create(null);
    window.addEventListener('message', function (e) {
      // A reply is always sent by the window the frame posted to (the parent), so any
      // other window - a sibling frame, an opener - is not a source of results.
      if (e.source !== parent) return;
      var d = e && e.data;
      if (!d || d.type !== NS + '-result') return;
      var fn = pending[d.id];
      if (!fn) return;
      delete pending[d.id];
      fn(d);
    });
    window.__harnessBridge = {
      ns: NS,
      send: function (payload, unwrap, emptyShape) {
        return new Promise(function (resolve) {
          var id = 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2);
          payload.id = id;
          var settled = false;
          pending[id] = function (d) {
            settled = true;
            if (d && d.error) resolve(Object.assign({}, emptyShape, { error: d.error }));
            else resolve(unwrap(d));
          };
          try {
            parent.postMessage(payload, '*');
          } catch (err) {
            delete pending[id];
            resolve(Object.assign({}, emptyShape, {
              error: 'postMessage to parent failed: ' + (err && err.message)
            }));
            return;
          }
          setTimeout(function () {
            if (settled) return;
            delete pending[id];
            resolve(Object.assign({}, emptyShape, { error: ${js(timedOut)} }));
          }, ${BRIDGE_TIMEOUT_MS});
        });
      }
    };
  }
  if (!window.__harnessRegister) {
    window.__harnessConnectors = window.__harnessConnectors || {};
    window.__harnessRegister = function (name, api) {
      window.__harnessConnectors[name] = api;
      var snake = String(name).replace(/-/g, '_');
      if (snake !== name) window.__harnessConnectors[snake] = api;
      var host = window[NS];
      if (host && typeof host === 'object') {
        try {
          host[name] = api;
          if (snake !== name) host[snake] = api;
        } catch (e) {}
      }
    };
  }
})();
`;
}

/* ------------------------------------------------------------------------- *
 * The connector
 * ------------------------------------------------------------------------- */

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
 * ```tsx
 * <HarnessProvider
 *   baseUrl="/api/builder"
 *   auth={{ getHeaders }}
 *   connectors={[mcpConnector({ url: 'https://your-mcp-host.example/notion' })]}
 * >
 * ```
 *
 * Mounting the client half is optional. Leave `connectors` off the provider and the
 * workspace proxies `<ns>-mcp` to `POST {base}/connectors/mcp` itself, with the caller's
 * identity attached - the same destination this `handle` forwards to. Mount it when you
 * want the connector named in the chip UI before the first build, or when you assemble
 * the preview yourself and need the `shim` contribution.
 */
export function mcpConnector(opts: McpConnectorOptions): ConnectorProvider {
  const url = opts.url;
  const name = opts.name || DEFAULT_NAME;
  // Announced by the server half on `initialize`. Carried here so a host can build one
  // options object and hand it to both halves.
  const clientName = opts.clientName || 'speculos-harness';
  const host = hostOf(url);

  return {
    /**
     * What the client half knows without asking anyone: the kind it answers, the name a
     * generated app reaches it by, and the host it points at.
     *
     * The authoritative, live summary - the tool listing, whether the server answered at
     * all - comes from the server half on the bundle response, and that is also what the
     * in-iframe shim is generated from. This local descriptor is what a chip UI has to
     * work with before the first build. It carries a host rather than the URL because a
     * URL can contain a token.
     *
     * `scope` is accepted for interface parity. One connector points at one server, so
     * the scope does not change what is listed; a per-tenant server is expressed by
     * mounting one connector per tenant, exactly as on the server side.
     */
    async list(_scope?: Record<string, string>): Promise<ConnectorSummary> {
      const entry: Record<string, unknown> = { kind: KIND, name, clientName };
      if (host) entry.host = host;
      return { kinds: [KIND], [name]: entry };
    },

    /**
     * Parent side of the `window.<ns>.<name>.callTool()` RPC.
     *
     * Forwards the frame's payload to `POST {base}/connectors/mcp` and hands the router's
     * answer straight back to the bridge, which spreads it into the `<ns>-result` reply.
     * The server half runs the MCP call with the server-held credential; the URL and any
     * token never cross into the browser.
     *
     * It never throws. The wrong kind, no route to the router, an HTTP error, an
     * unreadable body - all come back as `{ data: null, error }`.
     */
    async handle(kind: string, payload: unknown, ctx: RuntimeContext): Promise<unknown> {
      if (kind !== KIND) return failure(`${name} does not handle ${JSON.stringify(kind)}`);

      const runtime = ctx as McpRuntimeContext;
      const body: Record<string, unknown> = {
        // The shim already names the server it wants; this is the default for a
        // hand-written caller that omitted it. An explicit value in the payload wins,
        // because with two MCP connectors mounted it is the only thing that routes.
        server: name,
        ...(payload && typeof payload === 'object' && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : {}),
      };
      const baseUrl = runtime.baseUrl ?? opts.baseUrl;

      let response: Response;
      try {
        if (typeof runtime.request === 'function') {
          response = await runtime.request(`/connectors/${KIND}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
        } else if (baseUrl) {
          const target = joinUrl(baseUrl, `/connectors/${KIND}`);
          const shareToken = runtime.shareToken;
          response = await fetch(
            shareToken ? `${target}?token=${encodeURIComponent(String(shareToken))}` : target,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                ...(opts.headers ?? {}),
                ...(runtime.headers ?? {}),
              },
              body: JSON.stringify(body),
            },
          );
        } else {
          // Guessing a mount path would send unauthenticated requests somewhere and fail
          // as a silent 401, so say what is missing instead. Both fixes are one line.
          return failure(
            'the MCP connector has no route to the agent router. Pass it one - ' +
              "mcpConnector({ url, baseUrl: '/api/builder' }) - or drop the client half " +
              'and let the workspace proxy the call itself, which attaches the identity ' +
              'for you.',
          );
        }
      } catch (err) {
        return failure(messageOf(err));
      }

      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      if (!response.ok) {
        const raw = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
        const detail = raw.error ?? raw.detail ?? raw.message;
        return failure(typeof detail === 'string' && detail ? detail : `HTTP ${response.status}`);
      }
      // The router returns the server half's own reply body - `{result}` on success,
      // `{data: null, error}` on failure - and the bridge spreads it into the reply.
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      return { result: parsed ?? null };
    },

    /**
     * The in-iframe resolver contribution for this connector's kind.
     *
     * Equivalent to the Python half's `shim()`, because either half may be the one that
     * is mounted: it installs the shared bridge preamble if nothing has yet, then
     * registers `callTool` under this connector's name on `window.__harnessConnectors` -
     * the object the core shim wraps in its never-throw `Proxy` - and on `window[ns]`
     * directly if that object already exists.
     *
     * A workspace whose server contributes the shim already has this; hand it to
     * `makeShim(ns, summary, { contributions: [...] })` when you assemble the preview
     * document yourself, or when the backend is not the Python kit.
     *
     * `summary` is accepted for interface parity. The MCP resolver is one method and does
     * not vary with the tool listing - the listing reaches the *agent* through the
     * prompt, not the app through the shim.
     */
    shim(_summary: ConnectorSummary, ns: string): string {
      const namespace = ns || DEFAULT_NAMESPACE;
      return (
        bridgePreamble(namespace) +
        `
(function () {
  var send = window.__harnessBridge.send;
  var name = ${js(name)};
  window.__harnessRegister(name, {
    callTool: function (tool, args) {
      return send(
        { type: ${js(`${namespace}-${KIND}`)}, server: name, tool: tool, arguments: args || {} },
        function (d) { return d.result; },
        { data: null }
      );
    }
  });
})();
`
      );
    },
  };
}
