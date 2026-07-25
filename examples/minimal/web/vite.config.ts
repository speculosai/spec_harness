import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BuilderPage points the workspace at a relative `/api/builder`, so the page and
// the API share an origin and the browser never needs a CORS preflight. The dev
// server forwards that prefix to the agent. HARNESS_BASE_URL is set by
// docker-compose to the agent service inside the compose network; running the
// web app on its own, it falls back to a local backend.
const baseUrl = new URL(process.env.HARNESS_BASE_URL ?? 'http://localhost:8000/api/builder');

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // reachable from outside the container
    port: 5173,
    proxy: {
      [baseUrl.pathname]: { target: baseUrl.origin, changeOrigin: true },
    },
  },
});
