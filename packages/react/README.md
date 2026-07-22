# @speculos-harness/react

The embeddable [Speculos Harness](https://speculos.ai) workspace for React: a chat panel beside a live, sandboxed preview, with a read-only file explorer and a version timeline. One provider and one component cover the common case; the panes and the headless hooks are exported for full control.

> **Pre-release — code lands with v0.1.** Every component and hook here is a typed stub that throws `not yet implemented`. The signatures are frozen to the decided public API so you can integrate against them now, but the workspace itself — carved from the production engine behind Speculos — arrives with the **v0.1 code drop**. Watch or star to follow.

## What it will contain

- `<HarnessProvider>` — supplies base URL, namespace, client auth, brand, strings, and connector client-halves to everything beneath it.
- `<Builder>` — the whole workspace: a resizable two-pane split with the file explorer and version timeline, owning the shared `fileSig` rebuild key and the once-per-build crash-to-auto-fix guard.
- `<ChatPane>`, `<PreviewPane>`, `<FileExplorer>`, `<VersionTimeline>` — the pieces `<Builder>` is made of, exported on their own so you can put the chat in a drawer and the preview in a modal and they keep talking to each other.
- `useHarnessChat`, `useHarnessPreview`, `useHarnessFiles` — headless hooks that own the protocol, state, and streaming, so you can bring your own layout and chrome.
- `@speculos-harness/react/styles.css` — a token-based default stylesheet; override the CSS custom properties to adopt your design system.

## The 90% case

```tsx
import { HarnessProvider, Builder } from '@speculos-harness/react'
import '@speculos-harness/react/styles.css'

export function BuilderPage({ projectId }: { projectId: string }) {
  return (
    <HarnessProvider
      baseUrl="/api/builder"        // where the agent router is mounted
      namespace="app"               // window.app.* + app-* messages; must match server + generated apps
      auth={{
        getHeaders: async () => ({ Authorization: `Bearer ${await getToken()}` }),
        canEdit: true,              // false => read-only viewer (preview full-width, no chat)
      }}
      brand={{ name: 'Northwind', Logo: <NorthwindLogo /> }}
    >
      <Builder
        projectId={projectId}
        layout="preview-left"       // "preview-left" | "chat-left" — pane order is a prop
        filePanel="explorer"        // "explorer" | "hidden"
      />
    </HarnessProvider>
  )
}
```

## The headless escape hatch

The hooks own the protocol, so a consumer can bring their own layout. The crash-to-auto-fix guard lives inside `useHarnessPreview`, so a custom layout cannot accidentally build a fix loop.

```tsx
import { useHarnessChat, useHarnessPreview, useHarnessFiles } from '@speculos-harness/react'

function CustomBuilder({ projectId }: { projectId: string }) {
  const chat = useHarnessChat({ baseUrl: '/api/builder', projectId })
  const preview = useHarnessPreview({
    projectId,
    rebuildKey: chat.filesChangedAt,          // bump a string -> full rebuild
    onError: (err) => chat.send(`the preview crashed: ${err.message} — read the files and fix it`),
  })
  const files = useHarnessFiles({ projectId })

  return (
    <div className="split">
      <iframe srcDoc={preview.srcDoc} sandbox={preview.sandbox} />
      <MyChatUI items={chat.items} onSend={chat.send} busy={chat.busy} />
    </div>
  )
}
```

## License

Apache-2.0.
