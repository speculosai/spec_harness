# Embedding

The frontend integration guide: how to put the workspace inside your product,
control its layout, wire identity through it, style it to your design system,
white-label it, embed it across origins, and offer read-only views. The backend
side - models, the instructions brief, connectors, metering - is in
[Configuration](./configuration.md); this page is the browser half.

Everything here is `@speculosai/spec_harness`, the one npm package the frontend
ships as. Its exact types live in that package and at its
[`/protocol`](../packages/spec_harness/src/protocol.ts) entry point; when this
guide and those types disagree, the types win.

| Import | What it is |
|---|---|
| `@speculosai/spec_harness` | The workspace: `HarnessProvider`, `Builder`, the standalone panes, and the headless hooks. Everything on this page unless noted. |
| `@speculosai/spec_harness/protocol` | The wire-protocol types, constants, and adapter interfaces. No runtime dependencies. |
| `@speculosai/spec_harness/preview` | The framework-agnostic sandboxed iframe host, if you are not on React. |
| `@speculosai/spec_harness/connectors-mcp` | The browser half of the MCP connector - see [Connectors](./connectors.md). |
| `@speculosai/spec_harness/styles.css` | The default stylesheet - see [Styling](#styling-with-css-custom-properties). |

## The 90% case: one provider, one component

Whole-UI adoption is the common path. `<HarnessProvider>` supplies configuration
to everything beneath it; `<Builder>` is the workspace.

```tsx
import { HarnessProvider, Builder } from '@speculosai/spec_harness'
import '@speculosai/spec_harness/styles.css'

<HarnessProvider baseUrl="/api/builder" namespace="app" auth={{ getHeaders }}>
  <Builder projectId={project.id} layout="preview-left" filePanel="explorer" />
</HarnessProvider>
```

## `<HarnessProvider>` props

| Prop | Type | What it does |
|---|---|---|
| `baseUrl` | `string` | Where the agent router is mounted, e.g. `"/api/builder"`. Every request the workspace makes is relative to this. |
| `namespace` | `string` | The runtime namespace: `window.<ns>.*` and `<ns>-*` bridge messages. **Must match the server's `namespace`.** Defaults to `"app"`. |
| `auth` | `HarnessAuth` | How the workspace proves who is asking, on every request. See [Identity](#identity-the-auth-prop). |
| `brand` | `{ name, Logo? }` | Product name and a logo slot. See [White-labeling](#white-labeling-brand-and-strings). |
| `strings` | `Record<string,string>` or a `t()` function | Overrides every UI label. Defaults to built-in English. |
| `connectors` | `ConnectorProvider[]` | The client halves (bridge/shim) of your connectors. Omit for file/package tools only. See [Connectors](./connectors.md). |
| `previewHead` | `string` | The preview document's `<head>`. Defaults to the preview package's head, which loads Tailwind from a CDN; a host under a strict CSP passes a precompiled, inlined stylesheet here instead. |

### Identity: the `auth` prop

`auth.getHeaders` is a factory the workspace calls before **every** request it
makes: the chat SSE stream, the bundle call, project and snapshot reads, and the
preview's bridge-proxy data fetches. It returns the headers that identify the
caller, so identity is attached uniformly rather than on the first request only.

```tsx
auth={{
  getHeaders: async () => ({ Authorization: `Bearer ${await getToken()}` }),
  canEdit: user.role !== 'viewer',   // false renders a read-only workspace
  // shareToken: '...'               // optional; threaded through every runtime RPC as ?token=
}}
```

| Field | Type | Meaning |
|---|---|---|
| `getHeaders` | `() => Promise<Record<string,string>> \| Record<string,string>` | Headers to attach to every request. Usually an `Authorization` bearer. |
| `canEdit` | `boolean` | `false` yields a [read-only viewer](#read-only-viewers-canedit). |
| `shareToken` | `string` | When set, threaded through every runtime RPC as `?token=`, for a shared, running app that fetches its own live data under a viewer's granted scope. The wire seam is part of protocol v1; the share-link UI and the token-minting endpoint are [on the core roadmap](../ROADMAP.md), so today you mint the token yourself. |

`getHeaders` is the only place your token lives on the client. The backend turns
that header back into a `Principal` (see [Adapters](./adapters.md)); the two
halves are how identity flows from your session into the agent, the store, and
the connectors.

## `<Builder>` props

`<Builder>` is a resizable two-pane split of the chat and the preview, with an
optional read-only file explorer and version timeline. It owns the shared state
that keeps the panes in sync - the rebuild key and the once-per-build
crash-to-fix guard - so you never wire those up yourself.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `projectId` | `string` | - | The project to open. |
| `layout` | `"preview-left" \| "chat-left"` | `"preview-left"` | Which side the preview sits on. Pane order is a prop, not a fork. |
| `filePanel` | `"explorer" \| "hidden"` | `"explorer"` | Whether the read-only file tree, per-turn diffs, and version timeline show. |
| `onFirstPrompt` | `() => string \| undefined` | - | Seeds the first turn. The `?prompt=` deep-link convention: return a value to open the workspace mid-thought. |

The `?prompt=` deep link is worth calling out - a URL like
`/build?prompt=arrears+dashboard` launches a user straight into a build:

```tsx
<Builder
  projectId={projectId}
  onFirstPrompt={() => new URLSearchParams(window.location.search).get('prompt') ?? undefined}
/>
```

## The standalone panes

The pieces `<Builder>` is made of are exported on their own, so you can put the
chat in a drawer, the preview in a modal, and the versions in your own sidebar,
and they keep talking to each other through the provider.

| Component | What it is |
|---|---|
| `<ChatPane>` | The chat side: the message log with legible tool cards, plan-mode choice chips, the model picker, and the composer with image/CSV attachments. |
| `<PreviewPane>` | The preview side: the null-origin sandboxed iframe, the postMessage bridge, the readable fallback, and the once-per-build auto-fix. |
| `<FileExplorer>` | The read-only file tree with per-turn diffs. The trust view - "what did the agent actually change?" - not an editor. |
| `<VersionTimeline>` | Every turn as a restorable version (the last ~30), with undo. |

```tsx
<HarnessProvider baseUrl="/api/builder" auth={{ getHeaders }}>
  <MyLeftDrawer>
    <ChatPane projectId={id} />
  </MyLeftDrawer>
  <MyMainStage>
    <PreviewPane projectId={id} />
  </MyMainStage>
  <MyRightRail>
    <VersionTimeline projectId={id} />
  </MyRightRail>
</HarnessProvider>
```

## Headless hooks

For total control - your own layout, your own chrome - the hooks own the
protocol, the state, and the streaming. This is also the proof the core is
genuinely headless: `<Builder>` is built on exactly these.

```tsx
import { useHarnessChat, useHarnessPreview, useHarnessFiles } from '@speculosai/spec_harness'

function CustomBuilder({ projectId }: { projectId: string }) {
  const chat = useHarnessChat({ projectId })
  // chat.items, chat.send(text, { planMode, model, attachments }), chat.stop(), chat.busy, chat.filesChangedAt

  const preview = useHarnessPreview({
    projectId,
    rebuildKey: chat.filesChangedAt,          // the fileSig contract: a changed string forces a full rebuild
    onError: (err) => chat.send(fixPrompt(err)),  // crash -> auto-fix; the hook fires this at most ONCE per rebuildKey
  })

  const files = useHarnessFiles({ projectId })
  // files.tree, files.read(path), files.versions, files.restore(id)

  return (
    <div className="split">
      {/* ref binds the data bridge; sandbox attrs come from the package - never hand-write them */}
      <iframe ref={preview.ref} srcDoc={preview.srcDoc} sandbox={preview.sandbox} />
      <MyChatUI items={chat.items} onSend={chat.send} busy={chat.busy} />
    </div>
  )
}
```

Two contracts the hooks encode so you cannot get them wrong:

- **The rebuild key.** `chat.filesChangedAt` is a string that changes whenever
  the agent mutated files. Feed it to `useHarnessPreview` as `rebuildKey`; a
  changed value triggers one full rebuild. There is no HMR - a rebuild is a fast
  build-from-scratch keyed on that string.
- **The once-per-rebuild auto-fix.** `useHarnessPreview` calls `onError` at most
  once per `rebuildKey`. The guard lives inside the hook, so a custom layout
  cannot accidentally build an infinite fix loop.

And one wiring step the hooks cannot do for you: **attach `preview.ref` to the
iframe.** The parent half of the data bridge binds to that element, so without it
the frame renders but every `window.<ns>` call times out with no one listening -
and the runtime-error channel that feeds `onError` (the runtime half of auto-fix)
never installs, so only build failures reach it.

And one you must not override: the `sandbox` attribute comes from the package
(`preview.sandbox`). It is security-load-bearing and non-configurable - see
[the sandbox rules](../spec/security.md).

## White-labeling: `brand` and `strings`

The workspace speaks entirely in your product's language, without a fork.

```tsx
<HarnessProvider
  baseUrl="/api/builder"
  auth={{ getHeaders }}
  brand={{ name: 'Northwind', Logo: <NorthwindLogo /> }}
  strings={{
    'composer.placeholder': 'Describe the view you need - e.g. "arrears by building, worst first"',
    'empty.title': 'Build a tool for Northwind',
  }}
>
```

- **`brand`** - `name` is the product name shown in the chrome; `Logo` is a slot
  that renders in place of the default mark. The logo is never hardcoded.
- **`strings`** - a flat map of label keys to your copy, or a `t()`-style
  function `(key, vars?) => string` if you already run an i18n library. Anything
  you do not override falls back to the built-in English default, so you can
  translate one label or all of them.

## Styling with CSS custom properties

The default stylesheet (`@speculosai/spec_harness/styles.css`) is built on CSS
custom properties. Override the tokens and the whole workspace adopts your
design system - no forking, no `!important`, no shadow-DOM surgery.

```css
:root {
  --harness-color-accent: #0b7285;   /* your brand accent */
  --harness-color-bg: #ffffff;
  --harness-radius-md: 8px;
  --harness-font-sans: "Inter", system-ui, sans-serif;
}
```

The tokens are grouped by color, radius, type, and spacing:

| Group | Tokens |
|---|---|
| Color | `--harness-color-bg`, `--harness-color-surface`, `--harness-color-border`, `--harness-color-text`, `--harness-color-text-muted`, `--harness-color-accent`, `--harness-color-accent-text`, `--harness-color-danger` |
| Radius | `--harness-radius-sm`, `--harness-radius-md`, `--harness-radius-lg` |
| Type | `--harness-font-sans`, `--harness-font-mono`, `--harness-font-size-base` |
| Spacing | `--harness-space-1` … `--harness-space-4` |

The stylesheet ships a light and a dark set out of the box; override either by
scoping your tokens under the matching selector. The tokens style the
**workspace chrome** - the chat, the panes, the explorer. The generated app
inside the preview is styled by its own code (Tailwind by default); that is a
separate surface, covered in
[Configuration](./configuration.md#the-instructions-brief) where you point the
agent at your design system.

## Read-only viewers: `canEdit`

Set `auth.canEdit: false` and the workspace renders as a viewer: the preview
goes full-width and the chat composer is gone. The reader sees the running app
and can browse the file explorer and version history, but cannot start a turn.

```tsx
auth={{ getHeaders, canEdit: user.role !== 'viewer' }}
```

This is a client-side affordance, not the security boundary. The boundary is the
backend `Principal.can_edit`, which the router enforces: a viewer whose token
resolves to `can_edit: False` cannot mutate the project even if they call the
API directly. Set both - the client one hides the composer, the server one
refuses the write. See [Adapters](./adapters.md#authprovider) for the server
half.

For a shared, running app that still needs to fetch its own live data, pair a
read-only viewer with `auth.shareToken`; the token is threaded through every
runtime RPC so the app renders real data under the viewer's granted scope, while
the sandbox still never holds a credential. The threading is protocol v1 and the
client honours it today - what is [on the core roadmap](../ROADMAP.md) is the
share-link UI and the endpoint that mints the token, so for now your host mints
it and hands it in. Share-token semantics - including
the plain truth that the token *is* the credential - are in
[`spec/security.md`](../spec/security.md).

## Cross-origin embedding

Dropping `<Builder>` into a product served from a different origin than the
agent is a first-class, supported path. There are two auth modes; the difference
is entirely about how credentials cross the origin boundary.

### Bearer mode (recommended for cross-origin)

`auth.getHeaders` attaches an `Authorization` header and the client sends
`credentials: 'omit'`. No cookies cross the boundary, so third-party-cookie
problems never arise. This is the default for cross-origin embeds, and the one
to reach for.

```tsx
auth={{
  getHeaders: async () => ({ Authorization: `Bearer ${await getShortLivedToken()}` }),
}}
```

Prefer short-lived tokens: `getHeaders` runs per request, so minting a fresh one
each time is cheap and limits exposure.

### Cookie mode

The client sends `credentials: 'include'`. Cross-origin, this additionally
requires:

- cookies set `SameSite=None; Secure`, and
- a **per-origin CORS allowlist** on the server that echoes the specific
  embedding origin with `Access-Control-Allow-Credentials: true`.

The load-bearing rule: **`Access-Control-Allow-Origin: *` is incompatible with
credentialed requests.** A server configured for cookie mode with a wildcard
origin refuses to start rather than shipping an embed that fails silently in the
browser. If your cross-origin cookie embed does not work, this is almost always
why.

### The cross-origin checklist

1. **Prefer bearer mode.** It sidesteps the cookie machinery entirely.
2. **If you must use cookies**, set `SameSite=None; Secure` and an explicit
   per-origin CORS allowlist - never `*` with credentials.
3. **Thread auth through everything.** The client attaches your configured
   credentials to the chat SSE, the bundle call, project and snapshot reads, and
   every preview bridge-proxy fetch, not just the first request. You get this by
   configuring `auth` once.
4. **Keep the namespace consistent** across the provider, the server, and the
   generated apps. A mismatch is a silent-no-data bug, not a security hole, but
   it is the most common integration failure.
5. **Serve the preview head under your CSP.** The default styling loads Tailwind
   from a CDN; a strict-CSP host supplies an inlined stylesheet instead, by
   passing it as the `<HarnessProvider previewHead>` prop above (see
   [`spec/bundle.md`](../spec/bundle.md) and
   [Configuration](./configuration.md)).

The end-to-end recipe, with the reasoning, is in
[`spec/security.md`](../spec/security.md).

## What the client adapts to on its own

You do not hand the client a list of what your backend supports. On mount it
calls `GET {baseUrl}/capabilities` once and adapts: it hides the model picker
when the server advertises no models, hides on-demand installs against a browser
bundler, hides plan mode when the server does not offer it, and degrades any
unlisted connector to a never-throw stub. If that endpoint 404s, the client
assumes protocol-1 defaults and carries on. You get correct UI against any
conforming backend without per-server client code. The full field list is in
[`spec/capabilities.md`](../spec/capabilities.md).
