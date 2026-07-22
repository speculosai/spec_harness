# @speculos-harness/sandbox-browser

An optional, in-browser `Bundler` for [Speculos Harness](https://speculos.ai), built on esbuild-wasm. It resolves imports from a CDN against a pinned dependency set — no Bun sidecar, no server round-trip — so a frontend-only app can preview without the build service running.

> **Post-v0.1 fast-follow — not a launch item.** This package is deliberately *not* part of the v0.1 code drop. The Bun sidecar (`@speculos-harness/bundler`) is the only reference bundler in v0.1. Real parity with it is a project of its own, and until a shared bundler conformance suite is green, `/capabilities` advertises server bundling only, so nothing claims a parity that does not exist. The factory here is a typed stub that throws. Watch or star to follow.

## Why it is a fast-follow, not a launch item

esbuild-wasm has no `node_modules`, so reaching Bun-bundler parity means building all of:

- a **CDN import-resolution plugin** (esm.sh) so bare imports resolve in the browser;
- a **pinned, supported dependency set** — only what resolves from the CDN is available, which is why this bundler reports `supportsInstall: false`;
- the **automatic JSX runtime** wired to match the server bundler's transpile exactly;
- a **shared bundler conformance suite** — the same files must produce runnable output on both bundlers — that must be green before this is called equivalent.

## What it will contain

- `createBrowserBundler(opts)` — returns a `Bundler` (from `@speculos-harness/protocol`) with `caps: { location: 'browser', supportsInstall: false, jsxRuntime: 'automatic' }`.
- `BROWSER_BUNDLER_CAPS` — the fixed capability descriptor.

## Intended usage (once it lands)

```ts
import { createBrowserBundler } from '@speculos-harness/sandbox-browser'
import { useHarnessPreview } from '@speculos-harness/react'

const bundler = createBrowserBundler()

// Drop the Bun sidecar for frontend-only apps.
const preview = useHarnessPreview({
  projectId,
  rebuildKey: chat.filesChangedAt,
  bundle: (files, deps, signal) => bundler.bundle(files, deps, signal),
})
```

Because `supportsInstall` is `false`, the workspace hides `install_package` when this bundler is active — the client adapts from the server's `/capabilities`.

## License

Apache-2.0.
