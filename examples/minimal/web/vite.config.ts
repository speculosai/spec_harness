import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BuilderPage points the workspace at a relative `/api/builder`, so the page and
// the API share an origin and the browser never needs a CORS preflight. The dev
// server forwards that prefix to the agent. HARNESS_BASE_URL is set by
// docker-compose to the agent service inside the compose network; running the
// web app on its own, it falls back to a local backend.
const baseUrl = new URL(process.env.HARNESS_BASE_URL ?? 'http://localhost:8000/api/builder');

const here = dirname(fileURLToPath(import.meta.url));

// @speculosai/spec_harness resolves from node_modules like any dependency. In this
// repository that is a workspace symlink to the package source, so an edit to the
// package shows up on reload; copied into your own product it is the published
// package. Either way there is nothing special to configure here - it is a normal
// dependency. The one repo-only concession is letting Vite read files above the
// example directory (the symlink points there).
const repoRoot = resolve(here, '../../..');
const inRepo = existsSync(resolve(repoRoot, 'packages/spec_harness'));

export default defineConfig({
  plugins: [react()],
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
    fs: inRepo ? { allow: [here, repoRoot] } : undefined,
  },
});
