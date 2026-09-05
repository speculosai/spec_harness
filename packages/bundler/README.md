# speculosai/harness-bundler

The build-service sidecar for [Speculos Harness](https://speculos.ai). It takes a project's files and dependencies and returns bundled, browser-ready code and CSS - `{files, deps}` in, `{code, css}` out. The workspace calls it every time a file changes, which is what makes the preview live: the agent writes, the service rebuilds, the sandbox refreshes. A rebuild is fast enough that there is no "run" button anywhere.

## Run it, don't write it

You don't write bundler code, you run the container. It is the reference implementation of the `Bundler` interface from `@speculosai/spec_harness/protocol`, with `caps: { location: 'server', supportsInstall: true, jsxRuntime: 'automatic' }`.

```yaml
# docker-compose.yml
services:
  bundler:
    image: speculosai/harness-bundler
    ports:
      - "8081:8081"
```

Point the agent at it with `bundler_url="http://bundler:8081"`.

Build the image yourself from this directory:

```bash
docker build -t speculosai/harness-bundler .
docker run --rm -p 8081:8081 speculosai/harness-bundler
```

From a source checkout - for hacking on the service, not for production, since a checkout is none of the things the container guarantees:

```bash
bun run src/index.ts          # or: bun run start
```

`serve()` is also importable if you would rather own the process:

```ts
import { serve } from './src/index.ts';

const server = await serve({ port: 8081 });
// ... later
await server.close();
```

Run it from a directory whose `node_modules` holds the base dependency set - that directory is the resolution root every build resolves against. Starting from a directory that does not have them fails the startup self-check; `HARNESS_BUNDLER_SKIP_BASE_CHECK=1` downgrades that one check to a warning for local work.

## The sidecar contract

Three endpoints, no auth, no database, no knowledge of projects. Full contract in [`spec/bundle.md`](../../spec/bundle.md).

### `POST /bundle`

```jsonc
// request
{ "files": { "/index.tsx": "import { createRoot } from 'react-dom/client'\nimport App from './App'\ncreateRoot(document.getElementById('root')!).render(<App />)",
             "/App.tsx":   "export default function App() { return <h1>Northwind Property Group</h1> }" },
  "deps":  { "recharts": "^2.15.0" } }

// 200
{ "code": "(() => { ... })();", "css": "/* /styles.css */ ..." }

// 422
{ "error": "/App.tsx:12:8 Unexpected }" }
```

The entry file is the first of `/index.tsx`, `/index.ts`, `/index.jsx`, `/index.js` present in the map. Output is a browser-targeted IIFE using the automatic JSX runtime; any CSS a module imports comes back in `css`. Build-directory paths are rewritten out of both the diagnostics and the output, so everything talks in project paths (`/App.tsx`).

A build error is a `422`, not a `5xx`: code that does not compile is an expected outcome the workspace shows in the preview fallback and hands back to the agent to repair. A `5xx` means the service itself is broken.

Declared `deps` that are not present in the resolution root are installed before the build (same regex, same mandatory `--ignore-scripts`). That is what keeps a project building after a container restart, since containers and build directories are both ephemeral. Set `HARNESS_BUNDLER_NO_AUTO_INSTALL=1` to turn it off and get an explicit error instead.

### `POST /packages/install`

```jsonc
// request
{ "name": "recharts", "version": "2.15.0" }   // version optional

// 200
{ "ok": true, "name": "recharts", "version": "2.15.0" }
// 200 - the install ran and failed; the agent can recover from this
{ "ok": false, "error": "error: GET https://registry.npmjs.org/... - 404" }
// 400 - the coordinates never reached a package manager
{ "ok": false, "error": "invalid package name \"react; rm -rf /\": expected a plain npm name ..." }
```

This backs the agent's `install_package` tool.

### `GET /health`

```jsonc
{ "ok": true, "caps": { "location": "server", "supportsInstall": true, "jsxRuntime": "automatic" } }
```

## Why it is a locked-down container (and only that)

`bun add` runs arbitrary npm, and `Bun.build` resolves the app's imports against this box's own `node_modules` - so the build service is the one component that executes untrusted dependency code. It ships **only** as a hardened image, so a naive setup cannot turn a bundle request into remote code execution. The invariants, enforced by a startup self-check that refuses to boot otherwise:

- runs **non-root**;
- installs always use **`--ignore-scripts`** (not configurable off);
- package **name/version are regex-validated** before reaching `bun add`;
- builds happen in an **ephemeral directory under the process cwd** (load-bearing: it is what lets `node_modules` resolve) and are wiped per request;
- the **base dependency set** the system prompt promises is baked at image-build time from one shared list, and every promised package is asserted to resolve.

Three more properties are not in the spec's list but fall out of the same threat model, and they are worth knowing about because they shape what the service will refuse:

- **Every build runs in a short-lived child process.** Bun executes build-time macros (`import ... with { type: 'macro' }`) while bundling, and the source being bundled was written by a model reading untrusted input - so bundling is code execution and has to be containable. The child gets a minimal environment (no host secrets), a hard kill on timeout, and, because it is fresh, a resolver that can see packages installed since the server booted. That last point is not a nicety: Bun caches module resolution for the life of a process, so an in-process bundler answers "Could not resolve" for every package the agent just installed.
- **Macro imports are rejected outright**, before a build starts. Generated app code has no legitimate need for one.
- **File paths are confined to the build directory.** A file map is model output, so `../../etc/whatever` is an input to expect rather than one to rule out.

Requests are size-capped (8 MiB), builds are time-capped (30s), installs are time-capped (180s) and serialized against each other, since `bun add` mutates a shared lockfile and `node_modules`. Builds run concurrently up to a cap (`HARNESS_BUNDLER_MAX_BUILDS`, default 4), since each one spawns its own Bun runtime and an unbounded number of them would exhaust the container; each build still gets its own directory, and surplus requests queue rather than fail.

## The baked base dependency set

The image ships with these already installed, so the common app builds with zero install round-trips. It is exactly the set the agent's system prompt promises it may import without asking - the prompt's LIBRARIES block and this list are the same list, which is why the prompt can never promise a package the bundler cannot resolve.

| Package | Version | Purpose |
|---|---|---|
| `react` | `^19.0.0` | the app runtime |
| `react-dom` | `^19.0.0` | mounts the app |
| `recharts` | `^2.15.0` | charts |
| `@tanstack/react-table` | `^8.20.0` | tables |
| `date-fns` | `^4.1.0` | dates |
| `lucide-react` | `^0.460.0` | icons |

Anything outside the set is added on demand through `install_package`. Change the set by editing `BASE_DEPENDENCIES` in `src/index.ts` and the matching `LIBRARIES` in the Python kit, then rebuilding the image - the Dockerfile renders the image's base manifest from `BASE_DEPENDENCIES`, so there is no third copy to forget.

## Configuration

| Option (`serve()`) | Env | Default |
|---|---|---|
| `port` | `PORT` | `8081` |
| `hostname` | - | `0.0.0.0` |
| `buildsDir` | - | `.builds` (must be under cwd) |
| `baseDeps` | - | the table above |
| `maxRequestBytes` | `HARNESS_BUNDLER_MAX_BYTES` | `8388608` |
| `buildTimeoutMs` | `HARNESS_BUNDLER_BUILD_TIMEOUT_MS` | `30000` |
| `installTimeoutMs` | `HARNESS_BUNDLER_INSTALL_TIMEOUT_MS` | `180000` |
| `maxConcurrentBuilds` | `HARNESS_BUNDLER_MAX_BUILDS` | `4` |
| `autoInstall` | `HARNESS_BUNDLER_NO_AUTO_INSTALL=1` disables | on |
| `skipBaseDepCheck` | `HARNESS_BUNDLER_SKIP_BASE_CHECK=1` | off |

There is deliberately no setting for `--ignore-scripts`, for the sandbox posture, or for building outside the working directory. Those are the invariants; see [`Dockerfile`](./Dockerfile), [`spec/bundle.md`](../../spec/bundle.md), and [`spec/security.md`](../../spec/security.md).

## License

Apache-2.0.
