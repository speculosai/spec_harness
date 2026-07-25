/**
 * @speculos-harness/preview
 *
 * The framework-agnostic preview core: it assembles the null-origin `srcdoc`
 * document, wires the parent side of the postMessage data bridge, and generates the
 * in-iframe resolver shim. `@speculos-harness/react` renders around this; a non-React
 * host can use it directly.
 *
 * Security is load-bearing here: the iframe is null-origin (`allow-same-origin` is
 * never added - that omission is *why* the bridge exists), and the sandbox attribute
 * is the fixed, normative {@link SANDBOX_ATTRIBUTES} string from the protocol package.
 */

import { SANDBOX_ATTRIBUTES, BRIDGE_TIMEOUT_MS } from '@speculos-harness/protocol';
import type { ConnectorSummary } from '@speculos-harness/protocol';

/** Placeholder message for the exports the implementation drops into. */
const NOT_IMPLEMENTED = '@speculos-harness/preview: implementation pending';

/** Re-exported for hosts that assemble the iframe themselves. Never alter this string. */
export { SANDBOX_ATTRIBUTES } from '@speculos-harness/protocol';

/** Label overrides shown inside the preview (the "rendered nothing" watchdog, fallback copy). */
export interface IframeStrings {
  /** Message shown when the app builds but renders nothing. */
  renderedNothing?: string;
  /** Heading shown on a build or runtime failure. */
  errorHeading?: string;
  /** Sub-copy shown on a failure while the agent is asked to repair it. */
  errorRepairing?: string;
}

/** Options for {@link buildSrcDoc}. */
export interface BuildSrcDocOptions {
  /** The bundled, browser-ready JS (escaped for inline embedding by this function). */
  code: string;
  /** The bundled CSS. */
  css: string;
  /** The runtime namespace bound into `window.<ns>` and the bridge. Defaults to `"app"`. */
  namespace?: string;
  /**
   * The document `<head>` contents. Defaults to the standard preview head (the styling
   * strategy the system prompt promises). Supply a precompiled/inlined head for
   * CSP-restricted or offline hosts.
   */
  headHtml?: string;
  /** The in-iframe resolver shim; typically the output of {@link makeShim}. */
  shim?: string;
  /** Preview-facing label overrides. */
  strings?: IframeStrings;
}

/**
 * Assemble the full null-origin `srcdoc` HTML document: the head, the bundled CSS, a
 * `#root`, the injected `window.<ns>` shim, the error-capture script, the escaped user
 * code, and the "rendered nothing" watchdog. Set the result as the iframe `srcDoc` with
 * `sandbox={SANDBOX_ATTRIBUTES}`.
 *
 * TODO: head assembly, CSS inlining, `escapeForScript` for the user code, the shim
 * injection point, the error capture that posts `preview-error`, and the render
 * watchdog.
 */
export function buildSrcDoc(_opts: BuildSrcDocOptions): string {
  throw new Error(NOT_IMPLEMENTED);
}

/** Options for {@link createBridge}. */
export interface CreateBridgeOptions {
  /** The iframe element to bridge. */
  iframe: HTMLIFrameElement;
  /** The runtime namespace; only `<ns>-*` messages are handled. */
  namespace: string;
  /**
   * Handle one bridge request. The kind is the message type minus the `<ns>-` prefix
   * (e.g. `query`, `app`, `mcp`). Return the payload to reply with. Errors are caught
   * and returned as never-throwing stubs to the iframe.
   */
  onRequest: (kind: string, payload: unknown) => Promise<unknown>;
  /** Called when the iframe reports a `preview-error`. */
  onError?: (err: { message: string; stack?: string }) => void;
  /** Per-request timeout. Defaults to {@link BRIDGE_TIMEOUT_MS} (60s). */
  timeoutMs?: number;
}

/** A live bridge; call {@link Bridge.destroy} to detach the message listener. */
export interface Bridge {
  /** Remove the listener and cancel pending requests. */
  destroy(): void;
}

/**
 * Wire the parent side of the postMessage bridge: listen for `{ type: '<ns>-<kind>',
 * id, ... }` requests, dispatch to `onRequest`, and reply with `{ type: '<ns>-result',
 * id, ...payload }` at `targetOrigin = origin === 'null' ? '*' : origin`. Enforces the
 * per-request timeout and returns never-throwing stubs for unknown connector kinds;
 * surfaces `preview-error` messages through `onError`.
 *
 * TODO: the parent `onMsg`/`reply` bridge - correlation by `id`, the 60s timeout, the
 * never-throw `Proxy` stub for unknown kinds, and `preview-error` routing.
 */
export function createBridge(_opts: CreateBridgeOptions): Bridge {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Generate the in-iframe resolver shim: the script that installs `window.<ns>` with the
 * connector resolvers a generated app calls, each dispatching a `<ns>-<kind>`
 * postMessage and awaiting the correlated `<ns>-result`. Unknown connector names
 * resolve to never-throwing stubs (`{ rows: [], error }` / `{ data: null, error }`).
 *
 * When `ns !== 'app'`, the shim also installs an alias so code written against a
 * different namespace keeps working.
 *
 * TODO: the shim generator, parameterized by namespace, folding in each connector's
 * `shim(summary, ns)` contribution.
 */
export function makeShim(_ns: string, _summary?: ConnectorSummary): string {
  throw new Error(NOT_IMPLEMENTED);
}

// Surface the default timeout so hosts assembling their own bridge can reuse it.
export { BRIDGE_TIMEOUT_MS } from '@speculos-harness/protocol';
