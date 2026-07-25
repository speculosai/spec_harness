# @speculos-harness/bundler

The build-service sidecar for [Speculos Harness](https://speculos.ai). It takes a project's files and dependencies and returns bundled, browser-ready code and CSS - `{files, deps}` in, `{code, css}` out. The workspace calls it every time a file changes, which is what makes the preview live: the agent writes, the service rebuilds, the sandbox refreshes. A rebuild is fast enough that there is no "run" button anywhere.

## Run it, don't write it

You don't write bundler code, you run the container. It is the reference implementation of the `Bundler` interface from `@speculos-harness/protocol`, with `caps: { location: 'server', supportsInstall: true, jsxRuntime: 'automatic' }`.

```yaml
# docker-compose.yml
services:
  bundler:
    image: speculos/harness-bundler
    ports:
      - "8081:8081"
```

Point the agent at it with `bundler_url="http://bundler:8081"`.

## The sidecar contract

`serve(opts)` starts the service and exposes two endpoints:

- `POST /bundle {files, deps}` -> `{ code, css } | { error }`
- `POST /packages/install {name, version}` -> `{ ok, error? }` (always `--ignore-scripts`)

A build error comes back as a `422` with a readable message, which is what the workspace shows in the preview fallback and hands to the agent to repair.

## Why it is a locked-down container (and only that)

`bun add` runs arbitrary npm, and `Bun.build` resolves the app's imports against this box's own `node_modules` - so the build service is the one component that executes untrusted dependency code. It ships **only** as a hardened image, so a naive setup cannot turn a bundle request into remote code execution. The invariants, enforced by a startup self-check that refuses to boot otherwise:

- runs **non-root**;
- installs always use **`--ignore-scripts`** (not configurable off);
- package **name/version are regex-validated** before reaching `bun add`;
- builds happen in an **ephemeral directory under the process cwd** (load-bearing: it is what lets `node_modules` resolve) and are wiped per request;
- the **base dependency set** the system prompt promises is baked at image-build time from one shared list, and every promised package is asserted to resolve.

See [`Dockerfile`](./Dockerfile), [`spec/bundle.md`](../../spec/bundle.md), and [`spec/security.md`](../../spec/security.md).

## License

Apache-2.0.
