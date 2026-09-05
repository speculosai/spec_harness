/**
 * @speculosai/spec_harness/sandbox-browser
 *
 * The optional in-browser build path: a {@link Bundler} built on esbuild-wasm, with no
 * Bun sidecar and no server round-trip. It resolves imports from a CDN (esm.sh) against
 * a pinned dependency set and advertises `supportsInstall: false`, so a frontend-only
 * app can preview without the build service running.
 *
 * It is enabled once it matches the Bun bundler, and not before. esbuild-wasm has no
 * `node_modules`, so parity means a CDN import-resolution plugin, a pinned
 * supported-dependency set, the automatic JSX runtime wired to match the server
 * bundler's transpile, and a shared bundler conformance suite (same files, both produce
 * runnable output) that is green. Until it is, `/capabilities` advertises server
 * bundling, so nothing claims a parity that does not exist.
 */

import type { Bundler, BundlerCaps, BundleResult, FileMap } from './protocol';

/**
 * The message a caller gets if they wire this bundler in today. It names the gate
 * (bundler parity, proven by the shared conformance suite) and the thing to use
 * instead, because "not implemented" on its own tells nobody what to do next.
 */
const NOT_IMPLEMENTED =
  '@speculosai/spec_harness/sandbox-browser: the in-browser build path is a roadmap item and is not ' +
  'implemented yet. It ships once a shared bundler conformance suite proves parity with the ' +
  'server bundler, so until then `/capabilities` advertises `sandbox.location: "server"` only. ' +
  'Use the build service (the `speculosai/harness-bundler` container) ' +
  'and leave `useHarnessPreview({ bundle })` unset to get its default.';

/** Options for {@link createBrowserBundler}. */
export interface BrowserBundlerOptions {
  /**
   * The CDN base used to resolve bare imports. Defaults to esm.sh. Because there is no
   * install step, only dependencies resolvable from the CDN and inside the pinned set
   * are available - this is why {@link BundlerCaps.supportsInstall} is `false`.
   */
  cdnBase?: string;
  /** The pinned, supported dependency set (name -> version) resolvable in-browser. */
  pinnedDeps?: Record<string, string>;
}

/**
 * The fixed capabilities of the browser bundler: it runs in the browser, cannot install
 * packages (it resolves from a CDN instead), and emits the automatic JSX runtime to
 * match the server bundler's transpile.
 */
export const BROWSER_BUNDLER_CAPS: BundlerCaps = {
  location: 'browser',
  supportsInstall: false,
  jsxRuntime: 'automatic',
};

/**
 * Create an in-browser {@link Bundler}. Wire the result into
 * `useHarnessPreview({ bundle })` to drop the Bun sidecar for frontend-only apps.
 *
 * Not implemented yet, on purpose - see the module note above and
 * [ROADMAP.md](../../../ROADMAP.md). The constructor returns a real object so a host can
 * still read {@link BROWSER_BUNDLER_CAPS} off it, and {@link Bundler.bundle} rejects with
 * an explanation naming the server bundler to use instead. What is missing is the
 * esbuild-wasm build with a CDN import-resolution plugin, the pinned dependency set, and
 * the automatic JSX runtime - none of it turned on until the shared bundler conformance
 * suite (the same files, runnable output from both bundlers) is green.
 */
export function createBrowserBundler(_opts?: BrowserBundlerOptions): Bundler {
  return {
    caps: BROWSER_BUNDLER_CAPS,
    // `async` so the failure arrives as a rejected promise rather than a synchronous
    // throw: a caller who wrote `bundle(...).catch(...)` should not need a try/catch
    // around the call as well.
    async bundle(
      _files: FileMap,
      _deps: Record<string, string>,
      _signal?: AbortSignal,
    ): Promise<BundleResult> {
      throw new Error(NOT_IMPLEMENTED);
    },
  };
}
