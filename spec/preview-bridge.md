# Preview bridge

The preview runs the agent's generated app in an isolated iframe next to the
chat. Because that iframe holds code written by an AI from untrusted input, it is
deliberately given **no origin and no same-origin privileges** — which means it
cannot fetch data on its own. Everything it needs from the outside world travels
over a `postMessage` bridge to the parent page, which is the only place a
credential ever exists. This document specifies that iframe, that bridge, and the
`namespace` constant that ties them together.

## The null-origin `srcdoc` iframe

The preview is a full HTML document assembled by the client and set as the
iframe's `srcdoc`. Setting `srcdoc` (rather than pointing `src` at a URL) gives
the frame a **null origin**: it belongs to no site, shares nothing with the host
page, and — critically — cannot read the host's cookies, `localStorage`, or DOM.

A null-origin frame also cannot make same-origin `fetch` calls succeed, and that
is not a limitation to work around — it is the point. Because the frame can't
fetch anything directly, **all** data access is forced through the parent-mediated
bridge, where the host controls and scopes every request and where the
credentials live. Remove the null origin and you remove the entire security
model.

The assembled document contains: the styling head (see
[Head and styling](#head-and-styling)), the bundled CSS, a `#root` mount, the
injected in-iframe connector shim (`window.<ns>`), an error-capture script, the
bundled app code (escaped for safe inline injection), and a "rendered nothing"
watchdog that surfaces an app which mounts but paints nothing.

## The sandbox attribute (normative)

The iframe MUST carry exactly this `sandbox` attribute:

```
allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-top-navigation-by-user-activation
```

This string is security-load-bearing and non-configurable. Two omissions are
**normative MUST-NOTs**:

- **`allow-same-origin` MUST NOT be present.** Adding it gives the frame the
  parent's origin — its cookies, its storage, its DOM — and collapses the entire
  isolation model. The frame's null origin is *why* the bridge exists. A startup
  self-check in the reference implementation refuses to run if the configured
  sandbox string ever contains `allow-same-origin`.
- **Ungated `allow-top-navigation` MUST NOT be present.** Only the
  user-activation-gated form (`allow-top-navigation-by-user-activation`) is
  allowed, so generated code cannot navigate the host page away without a real
  user gesture.

The tokens that *are* present each earn their place: `allow-scripts` runs the
app; `allow-forms` lets it have inputs; `allow-popups` /
`allow-popups-to-escape-sandbox` let it open links in a new tab that behave
normally; `allow-modals` permits `alert`/`confirm`; and the gated top-navigation
token lets a real click on a real link work.

## The postMessage bridge

The frame talks to the parent with a small, correlated request/reply protocol.
Every message's `type` is namespaced (see [Namespace](#the-namespace-constant)),
and every request carries an `id` the reply echoes.

### Request (iframe to parent)

```jsonc
{ "type": "<ns>-<kind>", "id": "q_1721680000000_8f3a1c", /* ...fields */ }
```

- `type` is `<ns>-<kind>`, e.g. `app-query`, `app-mcp`. The `kind` selects which
  connector handles it.
- `id` is a fresh correlation id, generated as
  `'q_' + Date.now() + '_' + <random>`.
- Any additional fields are the request payload the connector expects.

### Reply (parent to iframe)

```jsonc
{ "type": "<ns>-result", "id": "q_1721680000000_8f3a1c", /* ...payload */ }
```

The parent posts the reply back with the **same `id`**, so the in-frame caller
can resolve the exact pending promise. The parent MUST post with
`targetOrigin = origin === 'null' ? '*' : origin` — because the frame's origin is
the literal string `'null'`, `postMessage` will not accept it as a concrete
target, so `'*'` is used for the null-origin case and the real origin otherwise.

### Error (iframe to parent)

```jsonc
{ "type": "preview-error", "message": "Cannot read properties of undefined", "stack": "…" }
```

The frame's error-capture script posts `preview-error` when the app throws at
runtime (and the build path reports a build failure the same way). The parent
surfaces a readable fallback and — at most once per rebuild key — asks the agent
to read the files and repair the error. `stack` is optional.

### Correlation, timeouts, and never-throw stubs

- **Correlation.** Each request's `id` maps to a pending promise in the frame; the
  matching `<ns>-result` resolves it. Unmatched replies are ignored.
- **60-second timeout.** Every request times out at 60s. A timed-out call
  resolves to an error result — it never hangs the app forever.
- **Never-throw stubs for unknown connectors.** The in-frame `window.<ns>` object
  is a `Proxy`: asking it for a connector the server didn't mount returns a stub
  that resolves to a shaped empty result rather than throwing —
  `{ rows: [], error }` for row-shaped calls, `{ data: null, error }` for
  object-shaped calls. A generated app that references a connector which happens
  not to be configured renders with empty data instead of crashing the whole
  preview. This is why "graceful missing connections" is a property, not an
  accident.

### What is core vs. plugin

The **envelope, the correlation ids, the 60-second timeout, the `preview-error`
channel, and the never-throw stub behavior are core** and specified here. The
individual connector **kinds** — `<ns>-query`, `<ns>-app`, `<ns>-mcp`, and the
`<ns>-task-*` / `<ns>-kv-*` families — are contributed by connector plugins, not
by protocol v1. A connector plugin supplies both halves: the parent-side
`handle(kind, payload, ctx)` (which the bridge forwards to
`POST {base}/connectors/{kind}`) and the in-frame `shim(...)` contribution that
becomes part of `window.<ns>`.

## The `namespace` constant

`window.<ns>` and the `<ns>-*` message types are governed by a single
`namespace` constant. **The default is `"app"`**, and it is configurable per
deployment.

### It is triple-bound

The namespace is bound in **three** places, and they must agree exactly:

1. **The system prompt** — what the agent is told to call
   (`window.app.query(...)`, etc.).
2. **The generated app code** — what the agent actually writes.
3. **The preview bridge** — what the parent listens for and replies to.

If these three disagree, the failure is quiet and nasty: the preview loads fine,
the app renders, and every data call silently returns nothing, because the
messages the app posts don't match the types the bridge answers. This is the #1
integration gotcha. The reference implementation consumes the namespace from one
config constant in the prompt builder, the shim generator, and the bridge router
so the three cannot drift, and a conformance test boots a generated app and
asserts a live round-trip under the configured namespace.

Because the namespace is baked into every already-generated app, a deployment
that changes it away from the value its historical apps were built with should
install a compatibility alias (`window.<oldNs> = window.<ns>`) so older apps keep
resolving. New deployments simply keep the default.

## Head and styling

The document head is a `headHtml` option, so a host can control how the preview
is styled and satisfy its own content-security policy.

- **Default: Tailwind via CDN.** The default head loads Tailwind from a CDN
  script, which is why generated apps can use utility classes with no build step.
  This external dependency is called out in [security.md](./security.md) — a host
  with a strict CSP or an offline requirement cannot load it.
- **Inline option for CSP hosts.** A host that cannot allow a CDN script supplies
  an inlined or precompiled stylesheet as `headHtml` instead. The rest of the
  bridge is unaffected; only the styling delivery changes.
