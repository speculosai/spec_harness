# Minimal web embed

The frontend half of the minimal example: `<HarnessProvider>` + `<Builder>` on
one page, branded for Northwind Property Group.

## Files

- `BuilderPage.tsx` - the embed: the provider (base URL, namespace, bearer auth,
  brand, strings) wrapping the `<Builder>` (layout, file panel, `?prompt=`
  deep-link seeding), plus the few `/projects` calls that open or create the
  project it edits.
- `NorthwindLogo.tsx` - a placeholder logo passed to `brand.Logo` (the logo is a
  slot; replace it with your own mark).
- `main.tsx` / `index.html` - the Vite entry point that mounts `BuilderPage`.
  Your own router does this job instead.
- `vite.config.ts` - proxies `/api/builder` to the agent, so the page and the
  API share an origin.
- `package.json` - `@speculosai/spec_harness`, `@speculosai/spec_harness/protocol`,
  `react`, `react-dom`, and the Vite/TypeScript toolchain.
- `tsconfig.json` / `vite-env.d.ts` - strict TypeScript and Vite's ambient types.
- `Dockerfile` / `.dockerignore` - the `web` service the compose files build.

## What to look at

Read `BuilderPage.tsx` top to bottom - it is the whole integration. Four things
worth noticing:

- **`baseUrl` + `namespace` must agree with the backend.** This page points at
  `/api/builder` (where `../backend/main.py` mounts the router) and uses
  `namespace="app"` (which matches `HarnessAgent(namespace="app")`). The
  namespace binds the prompt, the generated code, and the preview bridge, so the
  two sides use the same string.
- **Auth is a header factory.** `getHeaders` runs on every request the workspace
  makes - chat SSE, bundle, file reads, and the preview's data fetches - so
  identity is attached uniformly. This example uses bearer mode (the default for
  cross-origin embeds); `canEdit: false` renders a read-only viewer.
- **The project lifecycle is yours, not the workspace's.** `<Builder>` edits a
  project you name; it never creates one. Your product already knows which
  project it is opening, so this page stands in for that with three calls to the
  router - `GET /projects/{id}`, `GET /projects`, `POST /projects` - and writes
  the resolved id back into `?project=` so a reload lands in the same workspace.
- **`onFirstPrompt` seeds the first turn.** A link like `/?prompt=arrears`
  opens the workspace already holding that first request.

## Running it

The three-service stack - this web app, the backend, and the bundler - comes up
together from the example root:

```bash
cd ..            # examples/minimal
docker compose up
```

To run just the web app against a backend you are already running:

```bash
npm install
npm run dev      # http://localhost:5173
```

`npm run dev` reads two optional environment variables:

| Variable | Default | What it does |
|---|---|---|
| `HARNESS_BASE_URL` | `http://localhost:8000/api/builder` | Where the dev server proxies `/api/builder`. Compose sets it to the `agent` service. |
| `VITE_HARNESS_TOKEN` | unset | Sent as `Authorization: Bearer <token>` on every request. Leave it unset for the backend's single-user default. Only `VITE_`-prefixed variables reach the browser, and this one ends up in the built bundle - it is for local development, not a production secret. |

Working inside this repository, `vite.config.ts` and `tsconfig.json` resolve
`@speculosai/spec_harness` from `../../../packages/spec_harness/src`, so an edit to the React
package shows up on reload. Copy this directory into your own product and that
sibling tree is gone, the aliases go quiet, and the published packages resolve
from `node_modules` instead - which is also what happens inside the Docker image,
whose build context is this directory alone.
