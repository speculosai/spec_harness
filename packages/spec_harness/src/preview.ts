/**
 * @speculosai/spec_harness/preview
 *
 * The framework-agnostic preview core: it assembles the null-origin `srcdoc`
 * document, wires the parent side of the postMessage data bridge, and generates the
 * in-iframe resolver shim. `@speculosai/spec_harness` renders around this; a non-React
 * host can use it directly.
 *
 * Security is load-bearing here: the iframe is null-origin (`allow-same-origin` is
 * never added - that omission is *why* the bridge exists), and the sandbox attribute
 * is the fixed, normative {@link SANDBOX_ATTRIBUTES} string from the protocol package.
 */

import { SANDBOX_ATTRIBUTES, BRIDGE_TIMEOUT_MS, DEFAULT_NAMESPACE } from './protocol';
import type { ConnectorSummary } from './protocol';

/** Re-exported for hosts that assemble the iframe themselves. Never alter this string. */
export { SANDBOX_ATTRIBUTES } from './protocol';

/** The default runtime namespace (`"app"`), re-exported so callers need one import. */
export { DEFAULT_NAMESPACE } from './protocol';

/* ------------------------------------------------------------------------- *
 * The sandbox invariant
 * ------------------------------------------------------------------------- */

/** Tokens whose presence collapses the isolation model. See `spec/security.md`. */
const FORBIDDEN_SANDBOX_TOKENS = ['allow-same-origin', 'allow-top-navigation'] as const;

/** Tokens without which the preview cannot do its job at all. */
const REQUIRED_SANDBOX_TOKENS = ['allow-scripts'] as const;

let sandboxChecked = false;

/**
 * Refuse to assemble a preview when the sandbox string has been weakened.
 *
 * `allow-same-origin` would hand the frame the host's origin - its cookies, its
 * storage, its DOM - and there would no longer be any reason for the bridge to exist.
 * Ungated `allow-top-navigation` would let generated code redirect the host page with
 * no user gesture; only the `-by-user-activation` form is permitted. Both are
 * normative MUST-NOTs in `spec/security.md`, so this throws rather than warns.
 *
 * Called by {@link buildSrcDoc} on first use (the package is `sideEffects: false`, so
 * a module-level check would be legal to tree-shake away). Exported so a host that
 * assembles its own iframe can run the same check at boot.
 */
export function assertSandboxSafe(sandbox: string = SANDBOX_ATTRIBUTES): void {
  // Sandbox keywords are ASCII case-insensitive to the HTML parser, so `ALLOW-SAME-ORIGIN`
  // weakens the frame exactly as `allow-same-origin` does. Lowercase before tokenising, or
  // a mixed-case forbidden token slips past this check while the browser still honours it.
  const tokens = sandbox.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const failures: string[] = [];
  for (const forbidden of FORBIDDEN_SANDBOX_TOKENS) {
    if (tokens.includes(forbidden)) {
      failures.push(`the sandbox attribute contains ${forbidden}`);
    }
  }
  for (const required of REQUIRED_SANDBOX_TOKENS) {
    if (!tokens.includes(required)) {
      failures.push(`the sandbox attribute is missing ${required}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `preview startup self-check failed:\n  - ${failures.join('\n  - ')}\nSee spec/security.md.`,
    );
  }
}

function assertSandboxSafeOnce(): void {
  if (sandboxChecked) return;
  assertSandboxSafe();
  sandboxChecked = true;
}

/* ------------------------------------------------------------------------- *
 * Escaping
 * ------------------------------------------------------------------------- */

/**
 * Escape bundled JavaScript so it cannot break out of the `<script>` element it is
 * inlined into.
 *
 * Three sequences matter, and only three:
 *
 * - `</script` ends the element wherever it appears, including inside a string
 *   literal - the classic breakout.
 * - `<!--` puts the HTML tokenizer into script-data-escaped state, after which a
 *   later `</script>` no longer closes the element, and in JS it also opens a legacy
 *   single-line comment that silently eats the rest of the line.
 * - U+2028 / U+2029 are JavaScript line terminators. A bundler that emits them raw
 *   inside a string literal produces code that parses differently once inlined.
 *
 * Each is rewritten to an equivalent that is inert to the HTML tokenizer and
 * identical to the JS parser *inside a literal*, which is where these sequences
 * occur in real bundler output. Outside a literal they are not valid JS to begin
 * with (`</script` would have to be a comparison against a regex), so the rewrite
 * cannot corrupt working code.
 */
export function escapeForScript(source: string): string {
  return String(source ?? '')
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Escape bundled CSS so it cannot close its `<style>` element. `\/` is a valid CSS
 * escape for `/`, and `</style` only ever occurs inside a string or a comment in
 * real stylesheets.
 */
export function escapeForStyle(css: string): string {
  return String(css ?? '').replace(/<\/style/gi, '<\\/style');
}

/**
 * Escape text for interpolation into HTML markup. The result is safe in both text and
 * quoted-attribute contexts: the single quote is escaped as well, so a value dropped into
 * a single-quoted attribute (`<div title='…'>`) cannot break out of it.
 */
export function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON, safe to inline into a `<script>` body. */
function js(value: unknown): string {
  return escapeForScript(JSON.stringify(value ?? null));
}

/* ------------------------------------------------------------------------- *
 * Strings and head
 * ------------------------------------------------------------------------- */

/** Label overrides shown inside the preview (the "rendered nothing" watchdog, fallback copy). */
export interface IframeStrings {
  /** Message shown when the app builds but renders nothing. */
  renderedNothing?: string;
  /** Heading shown on a build or runtime failure. */
  errorHeading?: string;
  /** Sub-copy shown on a failure while the agent is asked to repair it. */
  errorRepairing?: string;
  /**
   * Shown by a never-throw stub for a connector the host did not mount. Any
   * `{{name}}` placeholder is replaced with the connector name.
   */
  notConnected?: string;
  /** The `error` a bridge request resolves with when it hits the 60-second timeout. */
  requestTimedOut?: string;
  /** Used when a failure carries no message of its own. */
  unknownError?: string;
}

/** Built-in English copy. Every key is overridable through {@link IframeStrings}. */
const DEFAULT_STRINGS: Required<IframeStrings> = {
  renderedNothing: 'The app loaded but rendered nothing.',
  errorHeading: 'This preview could not run',
  errorRepairing: 'The error was reported back to the agent, which can read the files and repair it.',
  notConnected: '{{name}} is not connected',
  requestTimedOut: `Request timed out after ${Math.round(BRIDGE_TIMEOUT_MS / 1000)}s`,
  unknownError: 'Unknown error',
};

/**
 * The default styling strategy: Tailwind from a CDN, plus a minimal reset, which is
 * what lets a generated app use utility classes with no build step.
 *
 * This is the one external dependency in the preview document. A host with a strict
 * CSP or an offline requirement passes its own precompiled stylesheet as
 * {@link BuildSrcDocOptions.headHtml} instead; nothing else about the bridge changes.
 */
export const DEFAULT_HEAD_HTML = [
  '<script src="https://cdn.tailwindcss.com"></script>',
  '<style>',
  '  html,body{margin:0;height:100%}',
  '  body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#fff;color:#0a0a0a}',
  '  #root{min-height:100%}',
  '</style>',
].join('\n');

/* ------------------------------------------------------------------------- *
 * The in-iframe runtime shim
 * ------------------------------------------------------------------------- */

/** Options for {@link makeShim}. */
export interface MakeShimOptions {
  /** Copy for the never-throw stubs and the timeout error. */
  strings?: IframeStrings;
  /**
   * Extra namespaces aliased onto the same runtime object. A deployment that renamed
   * its namespace keeps already-generated apps resolving; the previous default is
   * aliased automatically whenever `ns` is not `"app"`.
   */
  aliases?: string[];
  /** Additional connector shim sources to fold in, beyond the summary's own. */
  contributions?: string[];
}

/**
 * The shared in-iframe bridge preamble every connector shim carries.
 *
 * It installs two idempotent globals, so shim contributions can be injected in any
 * order and each one can stand alone:
 *
 * - `window.__harnessBridge.send(payload, unwrap, emptyShape)` posts a correlated
 *   `{type: '<ns>-<kind>', id, ...}` request to the parent and resolves with the
 *   matching `<ns>-result`. It **never rejects**: a parent-side error, a failed
 *   `postMessage` and the 60-second timeout all resolve to `emptyShape` plus an
 *   `error` key, so one data call can never take the preview down.
 * - `window.__harnessRegister(name, api)` publishes a connector onto
 *   `window.__harnessConnectors`, the object the core shim wraps in its never-throw
 *   `Proxy`. A hyphenated name is also registered under its snake_case alias, because
 *   generated code reaches for `window.app.my_db`, not `window.app['my-db']`.
 *
 * This is the exact counterpart of `speculos_harness.connectors._bridge`; the two
 * must stay semantically identical or a Python-contributed shim and a
 * TypeScript-contributed one will not share a transport.
 */
export function bridgePreamble(ns: string, strings?: IframeStrings): string {
  const namespace = ns || DEFAULT_NAMESPACE;
  const timedOut = strings?.requestTimedOut ?? DEFAULT_STRINGS.requestTimedOut;
  return `
(function () {
  var NS = ${js(namespace)};
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

/**
 * Install `window[ns]` as a never-throw `Proxy` over the registered connectors.
 *
 * The `Proxy` is the whole reason "graceful missing connections" is a property and
 * not an accident: a generated app that references a connector the host did not mount
 * gets a stub whose calls resolve to a shaped empty result with an `error`, so the app
 * renders empty instead of crashing the preview.
 */
function installNamespace(ns: string, aliases: string[], strings: Required<IframeStrings>): string {
  return `
(function () {
  var NS = ${js(ns)};
  var ALIASES = ${js(aliases)};
  var NOT_CONNECTED = ${js(strings.notConnected)};
  window.__harnessConnectors = window.__harnessConnectors || {};
  var target = window.__harnessConnectors;

  function stub(name) {
    var msg = NOT_CONNECTED.replace('{{name}}', name);
    // Two shapes cover every call an app makes: row-shaped reads and
    // object-shaped tool calls. Anything else falls through to the
    // object-shaped stub rather than becoming undefined.
    var rowShaped = function () { return Promise.resolve({ rows: [], error: msg }); };
    var objectShaped = function () { return Promise.resolve({ data: null, error: msg }); };
    var concrete = {
      query: rowShaped,
      callTool: objectShaped,
      call: objectShaped,
      run: objectShaped,
      __notConnected: true,
      __name: name
    };
    try {
      return new Proxy(concrete, {
        get: function (t, prop) {
          if (prop in t) return t[prop];
          if (typeof prop === 'symbol') return undefined;
          if (prop === 'then') return undefined;
          return objectShaped;
        }
      });
    } catch (e) {
      return concrete;
    }
  }

  var api;
  try {
    api = new Proxy(target, {
      get: function (t, prop) {
        if (prop in t) return t[prop];
        // Framework probes (Symbol.iterator, Symbol.toPrimitive) must answer
        // normally, and the object must never look thenable or an await on it
        // would hang forever.
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'then') return undefined;
        // Tolerate a connector that was re-added with different casing rather
        // than silently breaking every app that referenced the old spelling.
        var lower = String(prop).toLowerCase();
        for (var k in t) { if (k.toLowerCase() === lower) return t[k]; }
        return stub(String(prop));
      },
      has: function (t, prop) {
        if (prop in t) return true;
        if (typeof prop === 'symbol') return false;
        var lower = String(prop).toLowerCase();
        for (var k in t) { if (k.toLowerCase() === lower) return true; }
        return false;
      }
    });
  } catch (e) {
    // No Proxy: expose the concrete map. Calls to unmounted connectors throw
    // instead of resolving empty, but everything mounted still works.
    api = target;
  }

  window[NS] = api;
  for (var i = 0; i < ALIASES.length; i++) {
    var alias = ALIASES[i];
    if (!alias || alias === NS) continue;
    try { window[alias] = api; } catch (e) {}
  }
})();
`;
}

/** Pull the connector-contributed shim sources out of a merged summary. */
function contributionsOf(summary?: ConnectorSummary): string[] {
  if (!summary || typeof summary !== 'object') return [];
  const out: string[] = [];
  const single = (summary as Record<string, unknown>).shim;
  if (typeof single === 'string' && single.trim()) out.push(single);
  const many = (summary as Record<string, unknown>).shims;
  if (Array.isArray(many)) {
    for (const entry of many) {
      if (typeof entry === 'string' && entry.trim()) out.push(entry);
    }
  }
  return out;
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
 * Connector *kinds* are not core: this generates the envelope, the correlation, the
 * 60-second timeout and the stub behaviour, then folds in each mounted connector's own
 * `shim(summary, ns)` contribution, which the server hands over as the `shim` key of
 * the merged {@link ConnectorSummary}. A summary with no contributions still produces a
 * working `window.<ns>` - every name simply resolves to a stub.
 */
export function makeShim(ns: string, summary?: ConnectorSummary, opts: MakeShimOptions = {}): string {
  const namespace = ns || DEFAULT_NAMESPACE;
  const strings: Required<IframeStrings> = { ...DEFAULT_STRINGS, ...opts.strings };
  const aliases = new Set<string>(opts.aliases ?? []);
  // Already-generated apps have the old namespace baked into them; aliasing keeps a
  // renamed deployment from silently returning no data (spec/preview-bridge.md).
  if (namespace !== DEFAULT_NAMESPACE) aliases.add(DEFAULT_NAMESPACE);

  const parts = [
    bridgePreamble(namespace, strings),
    ...contributionsOf(summary),
    ...(opts.contributions ?? []),
    installNamespace(namespace, [...aliases], strings),
  ];
  return parts.filter((part) => part && part.trim()).join('\n');
}

/* ------------------------------------------------------------------------- *
 * The srcdoc document
 * ------------------------------------------------------------------------- */

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
   *
   * Charset, viewport and the bundled `css` are emitted around this either way, so a
   * host overriding the head only replaces the styling delivery.
   */
  headHtml?: string;
  /** The in-iframe resolver shim; typically the output of {@link makeShim}. */
  shim?: string;
  /** Preview-facing label overrides. */
  strings?: IframeStrings;
  /** How long the blank-render watchdog waits before reporting. Defaults to 1500ms. */
  blankRenderDelayMs?: number;
  /**
   * Whether a blank render is reported to the parent as `preview-error`. Defaults to
   * `true`. Turn it off for apps that legitimately paint nothing on first frame.
   */
  reportBlankRender?: boolean;
}

/** The inline fallback card plus the error capture that feeds it and the parent. */
function errorRuntime(strings: Required<IframeStrings>): string {
  return `
(function () {
  var HEADING = ${js(strings.errorHeading)};
  var BODY = ${js(strings.errorRepairing)};
  var UNKNOWN = ${js(strings.unknownError)};

  function esc(text) {
    return String(text).replace(/[<>&]/g, function (c) {
      return c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;';
    });
  }

  // The parent is the only place an error can be acted on: it surfaces the
  // failure and, at most once per rebuild, asks the agent to repair it.
  function report(message, stack) {
    try {
      parent.postMessage({
        type: 'preview-error',
        message: String(message == null || message === '' ? UNKNOWN : message),
        stack: stack ? String(stack) : undefined
      }, '*');
    } catch (e) {}
  }

  // Render the failure inline as well, so the frame is never a white screen
  // even when the host has no error UI of its own. First failure wins - a
  // cascade of follow-on errors must not redraw the card over and over.
  function show(message) {
    try {
      var root = document.getElementById('root');
      if (!root) return;
      if (root.getAttribute('data-harness-fallback') === '1') return;
      root.setAttribute('data-harness-fallback', '1');
      root.innerHTML =
        '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;background:#f8fafc;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;">' +
          '<div style="max-width:560px;width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;box-shadow:0 1px 2px rgba(0,0,0,0.04);">' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' +
              '<span style="width:8px;height:8px;border-radius:9999px;background:#f59e0b;display:inline-block;"></span>' +
              '<span style="font-weight:600;color:#0f172a;font-size:14px;">' + esc(HEADING) + '</span>' +
            '</div>' +
            '<div style="color:#475569;font-size:13px;line-height:1.6;margin-bottom:14px;">' + esc(BODY) + '</div>' +
            '<pre style="background:#f1f5f9;border-radius:6px;padding:10px;font-size:12px;color:#334155;overflow:auto;max-height:220px;white-space:pre-wrap;word-break:break-word;margin:0;">' +
              esc(message == null || message === '' ? UNKNOWN : message) +
            '</pre>' +
          '</div>' +
        '</div>';
    } catch (e) {}
  }

  window.__harnessReportError = report;
  window.__harnessShowFallback = show;

  window.addEventListener('error', function (e) {
    report(e.message, e.error && e.error.stack);
    show(e.message);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var reason = e && e.reason;
    var message = 'unhandledrejection: ' + (reason && reason.message ? reason.message : String(reason));
    report(message, reason && reason.stack);
    show(message);
  });
})();
`;
}

/**
 * The blank-render watchdog.
 *
 * A React render that throws inside the commit phase can leave `#root` empty without
 * ever firing a global `error` event. Without this the user stares at a white frame
 * and the agent is never told anything went wrong.
 */
function blankRenderWatchdog(strings: Required<IframeStrings>, delayMs: number, report: boolean): string {
  return `
(function () {
  var MESSAGE = ${js(strings.renderedNothing)};
  setTimeout(function () {
    try {
      var root = document.getElementById('root');
      if (!root || root.firstChild) return;
      if (root.getAttribute('data-harness-fallback') === '1') return;
      ${report ? 'if (window.__harnessReportError) window.__harnessReportError(MESSAGE);' : ''}
      if (window.__harnessShowFallback) window.__harnessShowFallback(MESSAGE);
    } catch (e) {}
  }, ${Math.max(0, Math.floor(delayMs))});
})();
`;
}

function documentShell(headHtml: string, css: string, bodyScripts: string[]): string {
  const scripts = bodyScripts
    .filter((source) => source && source.trim())
    .map((source) => `  <script>${escapeForScript(source)}</script>`)
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
${headHtml}
  <style>${escapeForStyle(css)}</style>
</head>
<body>
  <div id="root"></div>
${scripts}
</body>
</html>`;
}

/**
 * Assemble the full null-origin `srcdoc` HTML document: the head, the bundled CSS, a
 * `#root`, the injected `window.<ns>` shim, the error-capture script, the escaped user
 * code, and the "rendered nothing" watchdog. Set the result as the iframe `srcDoc` with
 * `sandbox={SANDBOX_ATTRIBUTES}`.
 *
 * Script order is deliberate. Error capture is installed first so a throw inside the
 * shim itself is still reported; the shim comes next so `window.<ns>` exists before the
 * app's first line runs; the app follows; the watchdog runs last and only fires if
 * nothing painted.
 */
export function buildSrcDoc(opts: BuildSrcDocOptions): string {
  assertSandboxSafeOnce();
  const namespace = opts.namespace || DEFAULT_NAMESPACE;
  const strings: Required<IframeStrings> = { ...DEFAULT_STRINGS, ...opts.strings };
  const headHtml = opts.headHtml ?? DEFAULT_HEAD_HTML;
  // No shim supplied still yields a working `window.<ns>`: every name resolves to a
  // never-throw stub, which is what keeps a misconfigured host from showing a crash.
  const shim = opts.shim ?? makeShim(namespace, undefined, { strings });

  return documentShell(headHtml, opts.css ?? '', [
    errorRuntime(strings),
    shim,
    opts.code ?? '',
    blankRenderWatchdog(strings, opts.blankRenderDelayMs ?? 1500, opts.reportBlankRender !== false),
  ]);
}

/** Options for {@link buildErrorDoc}. */
export interface BuildErrorDocOptions {
  /** The build error to show. */
  error: string;
  /**
   * Head contents, same contract as {@link BuildSrcDocOptions.headHtml}. Defaults to
   * empty: the fallback card is styled entirely inline, so the one document a host
   * sees when things are already broken never waits on a network fetch.
   */
  headHtml?: string;
  /** Preview-facing label overrides. */
  strings?: IframeStrings;
  /**
   * Whether to post `preview-error` to the parent. Defaults to `true` so a build
   * failure reaches the agent through exactly the same channel as a runtime crash.
   */
  report?: boolean;
}

/**
 * The readable fallback document shown when a build fails.
 *
 * A failed build must never leave a blank frame, and it must reach the agent the same
 * way a runtime crash does: this renders the same card the in-frame error handler
 * renders and posts the same `preview-error` message, so the parent needs one code
 * path for both.
 */
export function buildErrorDoc(opts: BuildErrorDocOptions): string {
  assertSandboxSafeOnce();
  const strings: Required<IframeStrings> = { ...DEFAULT_STRINGS, ...opts.strings };
  const headHtml = opts.headHtml ?? '';
  const report = opts.report !== false;
  const boot = `
(function () {
  var MESSAGE = ${js(opts.error)};
  ${report ? 'if (window.__harnessReportError) window.__harnessReportError(MESSAGE);' : ''}
  if (window.__harnessShowFallback) window.__harnessShowFallback(MESSAGE);
})();
`;
  return documentShell(headHtml, '', [errorRuntime(strings), boot]);
}

/* ------------------------------------------------------------------------- *
 * The parent half of the bridge
 * ------------------------------------------------------------------------- */

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
  /** Alias of {@link Bridge.destroy}, for hosts that speak `dispose`. */
  dispose(): void;
}

/** The shape a message from the frame is narrowed to before anything reads it. */
interface FrameMessage {
  type?: unknown;
  id?: unknown;
  message?: unknown;
  stack?: unknown;
  [key: string]: unknown;
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

/**
 * Spread a handler result into the reply envelope.
 *
 * Connectors answer with a plain object - `{rows}`, `{result}`, `{value}` - whose keys
 * the in-frame unwrap function reads directly. Anything else is wrapped under `result`
 * so a handler that returns a scalar is still legible to the shim.
 */
function replyPayload(result: unknown): Record<string, unknown> {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { ...(result as Record<string, unknown>) };
  }
  return { result: result ?? null };
}

/**
 * Wire the parent side of the postMessage bridge: listen for `{ type: '<ns>-<kind>',
 * id, ... }` requests, dispatch to `onRequest`, and reply with `{ type: '<ns>-result',
 * id, ...payload }` at `targetOrigin = origin === 'null' ? '*' : origin`. Enforces the
 * per-request timeout and returns never-throwing stubs for unknown connector kinds;
 * surfaces `preview-error` messages through `onError`.
 *
 * A sandboxed `srcdoc` frame has the literal origin `'null'`, which `postMessage` will
 * not accept as a concrete target - hence the `'*'` branch. That is also why the frame
 * is identified by `event.source`, not by origin: the message must come from this
 * iframe's own window or it is ignored.
 */
export function createBridge(opts: CreateBridgeOptions): Bridge {
  const namespace = opts.namespace || DEFAULT_NAMESPACE;
  const prefix = `${namespace}-`;
  const resultType = `${namespace}-result`;
  const timeoutMs = opts.timeoutMs ?? BRIDGE_TIMEOUT_MS;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;

  function reply(source: MessageEventSource | null, origin: string, payload: Record<string, unknown>): void {
    if (!source) return;
    try {
      (source as Window).postMessage(
        { type: resultType, ...payload },
        origin === 'null' || origin === '' ? '*' : origin,
      );
    } catch {
      // The frame was torn down mid-flight. Nothing to deliver to.
    }
  }

  async function dispatch(
    kind: string,
    payload: unknown,
    id: string,
    source: MessageEventSource | null,
    origin: string,
  ): Promise<void> {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      timers.delete(timer);
      // The frame times out on its own too; replying keeps the two sides in step
      // instead of leaving the in-frame promise to expire silently.
      reply(source, origin, { id, error: DEFAULT_STRINGS.requestTimedOut });
    }, timeoutMs);
    timers.add(timer);

    try {
      const result = await opts.onRequest(kind, payload);
      if (settled || disposed) return;
      settled = true;
      clearTimeout(timer);
      timers.delete(timer);
      reply(source, origin, { id, ...replyPayload(result) });
    } catch (err) {
      if (settled || disposed) return;
      settled = true;
      clearTimeout(timer);
      timers.delete(timer);
      // An unmounted kind lands here. The frame turns `{error}` into a shaped empty
      // result, so a missing connector is empty data rather than a dead preview.
      reply(source, origin, { id, error: messageOf(err) });
    }
  }

  function onMessage(event: MessageEvent): void {
    if (disposed) return;
    const data = event.data as FrameMessage | null;
    if (!data || typeof data !== 'object') return;
    const type = data.type;
    if (typeof type !== 'string' || !type) return;

    // Only this iframe may talk to this bridge. The frame is null-origin, so identity
    // is the only check available - and it is the one that matters. Fail closed: a
    // legitimate message always has a live `contentWindow` to compare against, so when
    // there is no frame (detached, or not yet attached) nothing is accepted.
    const frame = opts.iframe?.contentWindow ?? null;
    if (!frame || event.source !== frame) return;

    if (type === 'preview-error') {
      opts.onError?.({
        message: typeof data.message === 'string' ? data.message : DEFAULT_STRINGS.unknownError,
        stack: typeof data.stack === 'string' ? data.stack : undefined,
      });
      return;
    }

    if (!type.startsWith(prefix)) return;
    const kind = type.slice(prefix.length);
    // Never treat our own reply envelope as a request; a hostile frame could echo it.
    if (!kind || kind === 'result') return;
    const id = data.id;
    if (typeof id !== 'string' || !id) return;

    const { type: _type, id: _id, ...payload } = data;
    void dispatch(kind, payload, id, event.source, event.origin);
  }

  window.addEventListener('message', onMessage);

  function destroy(): void {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('message', onMessage);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  return { destroy, dispose: destroy };
}

// Surface the default timeout so hosts assembling their own bridge can reuse it.
export { BRIDGE_TIMEOUT_MS } from './protocol';
