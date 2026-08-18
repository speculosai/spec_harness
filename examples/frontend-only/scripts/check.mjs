/**
 * Run the conformance check.
 *
 * `check-entry.ts` is TypeScript that imports TypeScript - the mock, the demo scripts,
 * the stage plugin, and the wire types straight out of `@speculosai/spec_harness` -
 * so it is bundled with esbuild and imported, rather than run through a loader. Node
 * needs no extra flags and the check needs no test framework.
 *
 * The bundle goes into a fresh temporary directory: two `npm run check`s running at
 * once (a workspace-wide `npm test`, say) must not overwrite each other's output, and
 * nothing should be written into the example itself.
 */

import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = mkdtempSync(join(tmpdir(), 'harness-check-'));

// The bundle runs from a temp directory, so it cannot find the example from its own
// path. This is how it locates the demos it has to scan.
process.env.HARNESS_EXAMPLE_ROOT = root;

/**
 * Leave esbuild out of the bundle, but leave behind an import Node can still follow.
 *
 * esbuild is a native binary with its own loader, so it must stay external - and a bare
 * `esbuild` specifier would be resolved from the temp directory, where there is no
 * `node_modules`. Rewriting it to an absolute `file:` URL keeps the one copy this
 * example already installed.
 */
const keepEsbuildExternal = {
  name: 'external-esbuild',
  setup(builder) {
    const from = createRequire(import.meta.url);
    builder.onResolve({ filter: /^esbuild$/ }, () => ({
      path: pathToFileURL(from.resolve('esbuild')).href,
      external: true,
    }));
  },
};

try {
  const bundle = join(out, 'check.mjs');
  await build({
    entryPoints: [join(here, 'check-entry.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    plugins: [keepEsbuildExternal],
    logLevel: 'silent',
  });
  await import(pathToFileURL(bundle).href);
} catch (err) {
  console.error(
    `\nthe conformance check could not run:\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exitCode = 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
