# Bundle service

The bundler turns a project's files and dependencies into browser-ready code and
CSS: `{files, deps}` in, `{code, css}` out. The workspace calls it on every file
change, which is what makes the preview feel live — the agent writes a file, the
service rebuilds, the sandbox refreshes, and there is no "run" button anywhere.

There are two contracts here: the **proxy endpoint** on the agent router, which a
client calls and which layers connector scoping on top, and the **raw sidecar**
contract that the bundler container itself speaks. They are separated so the
bundler can be a locked-down, stateless container that knows nothing about auth,
projects, or connectors.

## Proxy endpoint (client-facing)

- **Bundle a project:** `POST {base}/bundle/:id`
- **Success (200):**

  ```jsonc
  { "code": "…bundled JS…", "css": "…bundled CSS…",
    "connectors": { /* optional ConnectorSummary */ } }
  ```

- **Build failure (422):**

  ```jsonc
  { "error": "Build failed: Unexpected token in /App.tsx:42" }
  ```

The proxy loads the project's files from the store, calls the raw sidecar, and —
on success — attaches an optional `connectors` summary describing which data
sources the app uses and what the client's in-frame shim should expose. That
summary is computed from the mounted connectors scoped to the caller's principal
plus a static scan of the files; its exact shape (`ConnectorSummary`) is
extensible and contributed by connector plugins, never fixed by protocol v1.

The `:id`-form separates a build failure (`422 { error }`, an expected outcome the
UI shows as "patching…" and auto-repairs) from a transport error (a 5xx, a
genuine fault). A conforming client treats 422 as a normal, recoverable build
result.

## Raw sidecar contract (bundler container)

The bundler container exposes two endpoints and nothing else. It has no auth, no
database, and no knowledge of projects — it is handed files and returns bytes.

### Bundle

- `POST /bundle`

  ```jsonc
  // request
  { "files": { "/App.tsx": "export default function App() { … }",
               "/index.tsx": "…" },
    "deps":  { "recharts": "2.15.0" } }

  // success
  { "code": "…", "css": "…" }

  // failure
  { "error": "…" }
  ```

  `files` is the full file map (path to source). `deps` is the app's declared
  dependencies. The service transpiles and bundles for the browser and returns the
  combined `code` and `css`.

### Package install

- `POST /packages/install`

  ```jsonc
  // request
  { "name": "recharts", "version": "2.15.0" }   // version optional

  // reply
  { "ok": true }
  // or
  { "ok": false, "error": "package not found" }
  ```

  This backs the agent's `install_package` tool: when the bundler advertises
  `supportsInstall: true`, the agent's tool calls this endpoint through the
  configured `bundler_url`. The install **always** runs with `--ignore-scripts`
  (see [Security-load-bearing invariants](#security-load-bearing-invariants)), and
  both `name` and `version` are validated against a strict regex before anything
  is executed.

## The `caps` descriptor

Every bundler describes itself with a small capabilities object, surfaced to the
client through [`/capabilities`](./capabilities.md):

```jsonc
{ "location": "server",       // "server" | "browser"
  "supportsInstall": true,    // can it add new packages on demand?
  "jsxRuntime": "automatic" } // "automatic" | "classic"
```

- **`location`** — `server` for the container sidecar; `browser` for the optional
  in-browser bundler (a post-v0.1 fast-follow). A client uses this to decide, for
  example, whether the `install_package` tool is meaningful at all.
- **`supportsInstall`** — whether the bundler can install packages. A browser
  bundler that resolves imports from a CDN advertises `false`, and the client
  hides on-demand installs accordingly.
- **`jsxRuntime`** — which JSX transform the bundler uses, so a browser bundler
  can be wired to match the server bundler's output.

The reason this descriptor exists is that two bundlers can differ in ways that
would otherwise produce "works on the server, broken in the browser" surprises.
The `BundleResult` union (`{code, css}` vs `{error}`) plus this `caps` descriptor
plus a shared bundler conformance suite are how the client adapts instead of
guessing.

## The baked base dependency set

The bundler image ships with a base set of dependencies already installed, so the
most common apps build with **zero** install round-trips. The v0.1 baked set is:

| Package | Purpose |
|---|---|
| `react` (19) | the app runtime |
| `recharts` | charts |
| `@tanstack/react-table` | data tables |
| `date-fns` | date handling |
| `lucide-react` | icons |

This set is not arbitrary: it is exactly what the agent's system prompt promises
it may use without asking. The prompt's libraries block and the image's baked set
are generated from **one list**, and a startup self-check asserts every promised
package actually resolves — so the agent can never be told it has a library the
bundler can't find. Anything outside this set is added on demand via
`install_package` (when `supportsInstall` is true).

## Security-load-bearing invariants

The bundler runs a build against real npm packages, on a machine that may hold
secrets. Two invariants are not conveniences — they are the difference between a
build service and a remote-code-execution hole, and the reference container's
startup self-check refuses to run if either is violated. Both are stated again in
[security.md](./security.md).

- **`--ignore-scripts` is mandatory, always.** `npm`/`bun` install lifecycle
  scripts are arbitrary code that runs at install time. Installing a
  model-chosen (therefore untrusted — see the prompt-injection note in
  [security.md](./security.md)) package **without** `--ignore-scripts` hands that
  package code execution on the build host. The flag is never optional and never
  configurable away.
- **The temp build directory MUST live under the working directory.** The bundler
  resolves an app's imports against its own `node_modules`, which only works if
  the per-build temp directory sits under the current working directory where that
  `node_modules` lives. Moving the temp dir elsewhere either breaks import
  resolution outright or tempts a setup that resolves against an unexpected tree.
  "Temp dir under cwd" is a load-bearing invariant, not an implementation detail.

Two more container properties round out the posture: the bundler ships **only** as
a **non-root** container, and its build directories are **ephemeral** (created per
build, discarded after). It is never meant to run as loose code on a shared host.
