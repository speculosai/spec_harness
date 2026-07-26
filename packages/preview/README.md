# @speculos-harness/preview

The framework-agnostic preview core for [Speculos Harness](https://speculos.ai). It assembles the null-origin `srcdoc` document, wires the parent side of the `postMessage` data bridge, and generates the in-iframe resolver shim. `@speculos-harness/react` renders around this; a non-React host can use it directly.

## What it gives you

- `buildSrcDoc(opts)` - assembles the full null-origin `srcdoc` document: the head, the bundled CSS, a `#root`, the injected `window.<ns>` shim, the error-capture script, the escaped user code, and the "rendered nothing" watchdog.
- `buildErrorDoc(opts)` - the readable fallback document for a failed build, which also posts `preview-error` so a build failure reaches the agent through the same channel as a runtime crash.
- `createBridge(opts)` - wires the parent side of the bridge: correlated request/reply, a 60-second per-request timeout, never-throwing stubs for unknown connector kinds, and `preview-error` routing.
- `makeShim(ns, summary?, opts?)` - generates the in-iframe resolver shim that installs `window.<ns>` and dispatches `<ns>-<kind>` messages to the parent.
- `bridgePreamble(ns, strings?)` - the shared in-frame transport a connector plugin's own `shim()` contribution builds on. Its Python counterpart is `speculos_harness.connectors._bridge`; the two are semantically identical, so a connector contributed from either language shares one transport.
- `escapeForScript` / `escapeForStyle` / `escapeHtml` - the escapers used during assembly, exported for hosts that assemble their own document.
- `assertSandboxSafe(sandbox?)` - the startup self-check that refuses a weakened sandbox string.
- `SANDBOX_ATTRIBUTES`, `DEFAULT_NAMESPACE`, `BRIDGE_TIMEOUT_MS` - re-exported from the protocol package so a host needs one import.

## Security (normative)

The preview iframe is a **null-origin `srcdoc` document**. Its sandbox attribute is the fixed string from `@speculos-harness/protocol`:

```
allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-top-navigation-by-user-activation
```

`allow-same-origin` **must never** be added - that omission is *why* the data bridge exists. Ungated `allow-top-navigation` must never be added either; only the user-activation-gated form is permitted. `buildSrcDoc` runs `assertSandboxSafe()` on first use and throws rather than assembling a document for a weakened sandbox.

Because the frame is null-origin, relative `fetch` cannot reach your API, so all data access is proxied through the parent page over the correlated `postMessage` envelope. See [`spec/preview-bridge.md`](../../spec/preview-bridge.md) and [`spec/security.md`](../../spec/security.md).

The bundled code is escaped before injection so it cannot break out of its `<script>` element: `</script` and `<!--` are neutralised (the second matters because it puts the HTML tokenizer into script-data-escaped state, where a later `</script>` no longer closes the element) and U+2028 / U+2029 are escaped. The parent bridge additionally ignores any message whose `event.source` is not this iframe's own window - with a null origin, source identity is the only check available.

## Usage

```ts
import { buildSrcDoc, createBridge, makeShim, SANDBOX_ATTRIBUTES } from '@speculos-harness/preview'

const srcDoc = buildSrcDoc({
  code,               // bundled JS from the build service
  css,                // bundled CSS
  namespace: 'app',
  shim: makeShim('app', connectorSummary),
})

const iframe = document.querySelector('iframe')!
iframe.setAttribute('sandbox', SANDBOX_ATTRIBUTES)
iframe.srcdoc = srcDoc

const bridge = createBridge({
  iframe,
  namespace: 'app',
  onRequest: (kind, payload) => fetchThroughYourServer(kind, payload),
  onError: (err) => askAgentToFix(err),
})
// ...later
bridge.destroy()
```

`connectorSummary` is the `connectors` object from the bundle response. Its `shim` key carries each mounted connector's own in-frame contribution, which `makeShim` folds in around the core transport. A summary with no contributions still produces a working `window.<ns>` - every name simply resolves to a never-throw stub.

A failed build never leaves a blank frame: `buildErrorDoc` renders a readable fallback and posts `preview-error` to the parent, which is what lets the agent read the error and repair it.

## The namespace

`window.<ns>` and the `<ns>-*` message types come from one constant, bound in three places that must agree: the system prompt, the generated app code, and this bridge. A mismatch is quiet and nasty - the preview loads, the app renders, and every data call silently returns nothing. When `ns` is not the default `"app"`, `makeShim` installs `window.app` as an alias so apps generated before the rename keep resolving.

## Styling and CSP

The default head loads Tailwind from a CDN, which is what lets a generated app use utility classes with no build step. It is the only external dependency in the document. A host with a strict CSP or an offline requirement passes its own precompiled stylesheet as `headHtml`; charset, viewport and the bundled CSS are emitted around it either way, so only the styling delivery changes.

## Self-check

```
bun run self-check
```

Asserts the sandbox invariants, that the assembled document contains every required piece in the required order, and that the escaper defeats a `</script>` breakout. It exits non-zero on failure, so it works as a CI gate.

## License

Apache-2.0.
