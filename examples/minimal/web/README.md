# Minimal web embed

The frontend half of the minimal example: `<HarnessProvider>` + `<Builder>` on
one page, branded for Northwind Property Group.

## Files

- `BuilderPage.tsx` - the embed: the provider (base URL, namespace, bearer auth,
  brand, strings) wrapping the `<Builder>` (layout, file panel, `?prompt=`
  deep-link seeding).
- `NorthwindLogo.tsx` - a placeholder logo passed to `brand.Logo` (the logo is a
  slot; replace it with your own mark).
- `main.tsx` / `index.html` - the Vite entry point that mounts `BuilderPage`.
  Your own router does this job instead.
- `vite.config.ts` - proxies `/api/builder` to the agent, so the page and the
  API share an origin.
- `package.json` - `@speculos-harness/react`, `react`, `react-dom`.

## What to look at

Read `BuilderPage.tsx` top to bottom - it is the whole integration. Three things
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
- **`onFirstPrompt` seeds the first turn.** A link like `/build?prompt=arrears`
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
