/**
 * @speculos-harness/bundler
 *
 * The build-service sidecar: it takes a project's files and dependencies and returns
 * bundled, browser-ready code and CSS - `{files, deps}` in, `{code, css}` out. The
 * workspace calls it every time a file changes, which is what makes the preview live:
 * the agent writes, the service rebuilds, the sandbox refreshes. There is no "run"
 * button because a rebuild is fast enough not to need one.
 *
 * It ships as the locked-down container image `speculos/harness-bundler` (see
 * `Dockerfile`) and runs ONLY that way: `bun add` runs arbitrary npm on a box that
 * resolves the app's imports against its own `node_modules`, so it enforces non-root,
 * `--ignore-scripts`, a name/version regex, and an ephemeral build dir under cwd. A
 * startup self-check refuses to run if any of those invariants is misconfigured away.
 */

/** Placeholder message for the exports the implementation drops into. */
const NOT_IMPLEMENTED = '@speculos-harness/bundler: implementation pending';

/** Options for {@link serve}. */
export interface ServeOptions {
  /** Port to listen on. Defaults to `8081`. */
  port?: number;
  /**
   * The ephemeral builds directory. MUST live under the process cwd so that
   * `node_modules` resolves - this invariant is load-bearing and enforced at startup.
   */
  buildsDir?: string;
  /**
   * The base dependency set baked into the image (the libraries the system prompt
   * promises: react, recharts, @tanstack/react-table, date-fns, lucide-react, ...).
   * A startup self-check asserts every promised package resolves.
   */
  baseDeps?: Record<string, string>;
}

/** A running bundler server. */
export interface BundlerServer {
  /** The port the server is listening on. */
  readonly port: number;
  /** Stop the server and release its port. */
  close(): Promise<void>;
}

/**
 * Start the build service. It exposes the raw sidecar contract:
 *
 * - `POST /bundle {files, deps}` -> `{ code, css } | { error }`
 * - `POST /packages/install {name, version}` -> `{ ok, error? }` (always `--ignore-scripts`)
 *
 * On startup it self-checks the security invariants (non-root, `--ignore-scripts`
 * enforced, name/version regex present, builds dir under cwd) and that every baked base
 * dependency resolves, and refuses to run otherwise.
 *
 * TODO: the Bun.build bundler and the `bun add --ignore-scripts` installer - `target:
 * browser`, `format: iife`, the automatic JSX runtime, the temp-dir-under-cwd
 * invariant, and the name/version regex.
 */
export async function serve(_opts?: ServeOptions): Promise<BundlerServer> {
  throw new Error(NOT_IMPLEMENTED);
}
