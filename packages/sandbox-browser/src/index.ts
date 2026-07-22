/**
 * @speculos-harness/sandbox-browser
 *
 * An optional, in-browser {@link Bundler} built on esbuild-wasm — no Bun sidecar, no
 * server round-trip. It resolves imports from a CDN (esm.sh) against a pinned
 * dependency set and advertises `supportsInstall: false`, so a frontend-only app can
 * preview without the build service running.
 *
 * POST-v0.1 FAST-FOLLOW — NOT a launch item. Real parity with the Bun bundler is a
 * project of its own: esbuild-wasm has no `node_modules`, so it needs a CDN
 * import-resolution plugin, a pinned supported-dependency set, the automatic JSX runtime
 * wired to match the server bundler's transpile, and a shared bundler conformance suite
 * (same files → both produce runnable output) that must be green before this is claimed
 * equivalent. Until then, `/capabilities` advertises server bundling only. The Bun
 * sidecar (`@speculos-harness/bundler`) is the ONLY reference bundler in v0.1.
 *
 * PRE-RELEASE: the factory signature is frozen; the body is a stub that throws.
 */

import type { Bundler, BundlerCaps, BundleResult, FileMap } from '@speculos-harness/protocol';

/** Thrown by every stub in this package until this fast-follow lands (post-v0.1). */
const NOT_IMPLEMENTED = 'speculos-harness: not yet implemented — planned as a post-v0.1 fast-follow';

/** Options for {@link createBrowserBundler}. */
export interface BrowserBundlerOptions {
  /**
   * The CDN base used to resolve bare imports. Defaults to esm.sh. Because there is no
   * install step, only dependencies resolvable from the CDN and inside the pinned set
   * are available — this is why {@link BundlerCaps.supportsInstall} is `false`.
   */
  cdnBase?: string;
  /** The pinned, supported dependency set (name → version) resolvable in-browser. */
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
 * TODO(post-v0.1): implement esbuild-wasm bundling with the CDN import-resolution
 * plugin, the pinned dependency set, and the automatic JSX runtime — behind a green
 * shared bundler conformance suite before it is advertised as equivalent.
 */
export function createBrowserBundler(_opts?: BrowserBundlerOptions): Bundler {
  return {
    caps: BROWSER_BUNDLER_CAPS,
    bundle(_files: FileMap, _deps: Record<string, string>, _signal?: AbortSignal): Promise<BundleResult> {
      throw new Error(NOT_IMPLEMENTED);
    },
  };
}
