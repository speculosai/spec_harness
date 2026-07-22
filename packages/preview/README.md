# @speculos-harness/preview

The framework-agnostic preview core for [Speculos Harness](https://speculos.ai). It assembles the null-origin `srcdoc` document, wires the parent side of the `postMessage` data bridge, and generates the in-iframe resolver shim. `@speculos-harness/react` renders around this; a non-React host can use it directly.

> **Pre-release — code lands with v0.1.** The signatures here are frozen to the decided API; the bodies are stubs that throw `not yet implemented`. The implementation — carved from the production preview that runs behind Speculos — arrives with the **v0.1 code drop**. Watch or star to follow.

## What it will contain

- `buildSrcDoc(opts)` — assemble the full null-origin `srcdoc` document: the head, the bundled CSS, a `#root`, the injected `window.<ns>` shim, the error-capture script, the escaped user code, and the "rendered nothing" watchdog.
- `createBridge(opts)` — wire the parent side of the bridge: correlated request/reply, a 60-second per-request timeout, never-throwing stubs for unknown connector kinds, and `preview-error` routing.
- `makeShim(ns, summary?)` — generate the in-iframe resolver shim that installs `window.<ns>` and dispatches `<ns>-<kind>` messages to the parent.
- `SANDBOX_ATTRIBUTES` — re-exported from the protocol package for hosts that assemble the iframe themselves.

## Security (normative)

The preview iframe is a **null-origin `srcdoc` document**. Its sandbox attribute is the fixed string from `@speculos-harness/protocol`:

```
allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-top-navigation-by-user-activation
```

`allow-same-origin` **must never** be added — that omission is *why* the data bridge exists. Because the frame is null-origin, relative `fetch` cannot reach your API, so all data access is proxied through the parent page over the correlated `postMessage` envelope. See [`spec/preview-bridge.md`](../../spec/preview-bridge.md) and [`spec/security.md`](../../spec/security.md).

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

## License

Apache-2.0.
