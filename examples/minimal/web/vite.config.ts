import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BuilderPage points the workspace at a relative `/api/builder`, so the page and
// the API share an origin and the browser never needs a CORS preflight. The dev
// server forwards that prefix to the agent. HARNESS_BASE_URL is set by
// docker-compose to the agent service inside the compose network; running the
// web app on its own, it falls back to a local backend.
const baseUrl = new URL(process.env.HARNESS_BASE_URL ?? 'http://localhost:8000/api/builder');

const here = dirname(fileURLToPath(import.meta.url));

// Running inside the Speculos Harness repository, resolve the workspace packages
// from their sources so a change to @speculos-harness/react shows up on reload.
// Copied into your own product - and inside the Docker image, which only carries
// this directory - the sibling tree is absent, the aliases are empty, and the
// published packages resolve from node_modules as usual.
const packagesDir = resolve(here, '../../../packages');
const fromSource = existsSync(packagesDir);
const workspaceAliases = fromSource
  ? [
      // Directory targets, so `@speculos-harness/react/styles.css` maps to the file
      // beside the entry point rather than through it.
      { find: '@speculos-harness/react', replacement: resolve(packagesDir, 'react/src') },
      { find: '@speculos-harness/preview', replacement: resolve(packagesDir, 'preview/src') },
      { find: '@speculos-harness/protocol', replacement: resolve(packagesDir, 'protocol/src') },
    ]
  : [];

export default defineConfig({
  plugins: [react()],
  resolve: { alias: workspaceAliases },
  server: {
    host: '0.0.0.0', // reachable from outside the container
    port: 5173,
    strictPort: true, // fail loudly rather than quietly moving to 5174
    proxy: {
      // The chat endpoint is a server-sent-event stream. The dev proxy pipes the
      // response through untouched, which is what keeps tokens arriving as they
      // are generated instead of in one delivery at the end of the turn.
      [baseUrl.pathname]: { target: baseUrl.origin, changeOrigin: true },
    },
    // Serving files from outside the project root is refused by default; the
    // aliases above point there.
    fs: fromSource ? { allow: [here, resolve(here, '../../..')] } : undefined,
  },
});
