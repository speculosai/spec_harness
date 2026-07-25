# @speculos-harness/sandbox-browser

The optional in-browser build path for [Speculos Harness](https://speculos.ai): a `Bundler` built on esbuild-wasm that resolves imports from a CDN against a pinned dependency set. No Bun sidecar, no server round-trip, so a frontend-only app can preview without the build service running.

It is a core roadmap item, and it turns on once it matches the server bundler. The Bun sidecar (`@speculos-harness/bundler`) is the reference bundler; until a shared bundler conformance suite proves parity, `/capabilities` advertises server bundling, so nothing claims a parity that does not exist.

## What parity means here

esbuild-wasm has no `node_modules`, so matching the Bun bundler means all of:

- a **CDN import-resolution plugin** (esm.sh) so bare imports resolve in the browser;
- a **pinned, supported dependency set** - only what resolves from the CDN is available, which is why this bundler reports `supportsInstall: false`;
- the **automatic JSX runtime** wired to match the server bundler's transpile exactly;
- a **shared bundler conformance suite** - the same files must produce runnable output on both bundlers - green before this is called equivalent.

## What it gives you

- `createBrowserBundler(opts)` - a `Bundler` (from `@speculos-harness/protocol`) with `caps: { location: 'browser', supportsInstall: false, jsxRuntime: 'automatic' }`.
- `BROWSER_BUNDLER_CAPS` - the fixed capability descriptor.

## Usage

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

Because `supportsInstall` is `false`, the workspace hides `install_package` when this bundler is active - the client adapts from the server's `/capabilities`.

## License

Apache-2.0.
