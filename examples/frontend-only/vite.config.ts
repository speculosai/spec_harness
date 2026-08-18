import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import { demoStages } from './stages-plugin';

const here = dirname(fileURLToPath(import.meta.url));

// @speculosai/spec_harness resolves from node_modules like any dependency. In this
// repository that is a workspace symlink to the package source, so an edit to the
// package shows up on reload; copied into your own product it is the published
// package. The one repo-only concession is letting Vite read files above the example
// directory (the symlink points there).
const repoRoot = resolve(here, '../..');
const inRepo = existsSync(resolve(repoRoot, 'packages/spec_harness'));

export default defineConfig({
  // `react()` compiles the app and the workspace package; `demoStages()` compiles the
  // stage apps the mock backend hands to the preview. There is no proxy here on
  // purpose - this example has no backend to proxy to.
  plugins: [react(), demoStages()],
  build: {
    // The six prebuilt stage apps ride along inside the bundle as string data - that is
    // what stands in for the build service here. The chunk-size warning is measuring
    // payload, not code, so it is raised rather than worked around.
    chunkSizeWarningLimit: 2000,
  },
  server: {
    host: '0.0.0.0',
    port: 5174, // 5173 belongs to examples/minimal
    strictPort: true, // fail loudly rather than quietly moving to another port
    fs: inRepo ? { allow: [here, repoRoot] } : undefined,
  },
});
