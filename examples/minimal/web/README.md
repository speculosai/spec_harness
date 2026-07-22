# Minimal web embed

The frontend half of the minimal example: `<HarnessProvider>` + `<Builder>` on
one page, branded for Northwind Property Group.

> [!IMPORTANT]
> **Pre-release — code lands with v0.1.** `@speculos-harness/react` is published
> spec-first. The imports and props here are the decided public API, but the
> components throw `not yet implemented` today. This page renders a working
> workspace with the v0.1 code drop. Watch or star the repo to follow.

## Files

- `BuilderPage.tsx` — the embed: the provider (base URL, namespace, bearer auth,
  brand, strings) wrapping the `<Builder>` (layout, file panel, `?prompt=`
  deep-link seeding).
- `NorthwindLogo.tsx` — a placeholder logo passed to `brand.Logo` (the logo is a
  slot; replace it with your own).
- `package.json` — depends on `@speculos-harness/react`, `react`, `react-dom`.

## What to look at

Read `BuilderPage.tsx` top to bottom — it is the whole integration. Three things
worth noticing:

- **`baseUrl` + `namespace` must agree with the backend.** This page points at
  `/api/builder` (where `../backend/main.py` mounts the router) and uses
  `namespace="app"` (which matches `HarnessAgent(namespace="app")`). The
  namespace binds the prompt, the generated code, and the preview bridge, so the
  two sides must use the same string.
- **Auth is a header factory.** `getHeaders` runs on every request the workspace
  makes — chat SSE, bundle, file reads, and the preview's data fetches — so
  identity is attached uniformly. This example uses bearer mode (the default for
  cross-origin embeds); `canEdit: false` would render a read-only viewer.
- **`onFirstPrompt` seeds the first turn.** A link like `/build?prompt=arrears`
  opens the workspace already holding that first request.

## Running it (at v0.1)

This is a standard Vite React app. The three-service stack — this web app, the
backend, and the bundler — comes up together from `../docker-compose.yml`:

```bash
docker compose -f ../docker-compose.yml up   # then open http://localhost:5173
```

To run just the web app against a backend you are already running:

```bash
npm install
npm run dev
```
