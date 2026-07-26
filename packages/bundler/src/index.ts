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

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

// Type-only, so the running container never has to resolve the protocol package -
// Bun erases `import type` at transpile time. The layering still holds: adapters
// depend on protocol and on nothing else.
import type { BundleResult, BundlerCaps, FileMap } from '@speculos-harness/protocol';

/* ------------------------------------------------------------------------- *
 * Constants
 * ------------------------------------------------------------------------- */

/** The port the sidecar listens on unless `PORT` or {@link ServeOptions.port} says otherwise. */
export const DEFAULT_PORT = 8081;

/**
 * The base dependency set baked into the image, so the common app builds with zero
 * install round-trips. This is the same list the agent's system prompt promises
 * (`speculos_harness.templates.LIBRARIES` renders the prompt's LIBRARIES block from
 * it, and the image's base manifest is generated from the copy here). The two lists
 * MUST agree: a prompt that promises a package the bundler cannot resolve produces a
 * broken app and a confused agent, which is why the startup self-check asserts every
 * entry actually resolves.
 */
export const BASE_DEPENDENCIES: Readonly<Record<string, string>> = Object.freeze({
  react: '^19.0.0',
  'react-dom': '^19.0.0',
  recharts: '^2.15.0',
  '@tanstack/react-table': '^8.20.0',
  'date-fns': '^4.1.0',
  'lucide-react': '^0.460.0',
});

/** What this bundler advertises through the agent's `/capabilities` response. */
export const BUNDLER_CAPS: BundlerCaps = Object.freeze({
  location: 'server',
  supportsInstall: true,
  jsxRuntime: 'automatic',
});

/** Entry files tried in order. The starter templates ship `/index.tsx`. */
const ENTRY_CANDIDATES = ['/index.tsx', '/index.ts', '/index.jsx', '/index.js'] as const;

/**
 * npm's own name rule, tightened: lowercase, optional single scope, no leading dot or
 * underscore, and none of the shell/path characters that would make a name interesting
 * to a package manager. Mirrors `_PACKAGE_NAME_RE` in the Python kit - both sides
 * validate, because either can be the one talking to `bun add`.
 */
const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/**
 * A semver-ish range (`1.2.3`, `^2.15.0`, `~1.0`) or a plain dist-tag (`latest`,
 * `next`, `beta`). Deliberately narrow: no spaces, no logical operators, no URLs, no
 * `file:` / `git+ssh:` specifiers.
 */
const PACKAGE_VERSION_RE =
  /^(?:[\^~]?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?|[a-z][a-z0-9.-]*)$/;

/** npm's hard cap on a package name. */
const MAX_PACKAGE_NAME = 214;

/**
 * The install flag that is never optional and never configurable away. Install
 * lifecycle scripts are arbitrary code, and the package being installed was chosen by
 * a model reading untrusted input - see spec/security.md, threat 2.
 */
const IGNORE_SCRIPTS = '--ignore-scripts';

/** Default request-body ceiling. A project file map is text; 8 MiB is generous. */
const DEFAULT_MAX_REQUEST_BYTES = 8 * 1024 * 1024;

/** Default wall-clock ceiling for one `Bun.build`. */
const DEFAULT_BUILD_TIMEOUT_MS = 30_000;

/** Default ceiling for one `bun add`. A cold package pulls a tarball and resolves a tree. */
const DEFAULT_INSTALL_TIMEOUT_MS = 180_000;

/** How many missing declared dependencies one bundle request may install for itself. */
const MAX_AUTO_INSTALLS = 8;

/** Cap on the number of files in one project, so a bad map cannot fill the disk with inodes. */
const MAX_FILES = 2_000;

/** Longest error body we hand back from a package manager. */
const MAX_ERROR_CHARS = 4_000;

/** The ephemeral builds directory, relative to cwd. Load-bearing: see the self-check. */
const BUILDS_DIRNAME = '.builds';

/* ------------------------------------------------------------------------- *
 * Public shape
 * ------------------------------------------------------------------------- */

/** Options for {@link serve}. */
export interface ServeOptions {
  /** Port to listen on. Defaults to `8081`. */
  port?: number;
  /**
   * The ephemeral builds directory. MUST live under the process cwd so that
   * `node_modules` resolves - this invariant is load-bearing and enforced at startup.
   * The service owns this directory outright: it is emptied on boot (a killed process
   * would otherwise leak one directory per in-flight build) and per build after that.
   * Defaults to `.builds`; do not point it at a directory holding anything else.
   */
  buildsDir?: string;
  /**
   * The base dependency set baked into the image (the libraries the system prompt
   * promises: react, recharts, @tanstack/react-table, date-fns, lucide-react, ...).
   * A startup self-check asserts every promised package resolves.
   */
  baseDeps?: Record<string, string>;
  /** Interface to bind. Defaults to `0.0.0.0` so the container is reachable. */
  hostname?: string;
  /** Request-body ceiling in bytes. Defaults to 8 MiB. */
  maxRequestBytes?: number;
  /** Wall-clock ceiling for one build, in milliseconds. Defaults to 30s. */
  buildTimeoutMs?: number;
  /** Wall-clock ceiling for one install, in milliseconds. Defaults to 180s. */
  installTimeoutMs?: number;
  /**
   * Whether a bundle request may install declared dependencies that are missing from
   * this box's `node_modules`. Defaults to `true`: build directories are ephemeral and
   * so are containers, so a project that was installed into a previous instance would
   * otherwise fail to build forever. It adds no attack surface that
   * `POST /packages/install` does not already have, and it uses the same regex and the
   * same mandatory `--ignore-scripts`.
   */
  autoInstall?: boolean;
  /**
   * Skip the "every promised base dependency resolves" check. For running the service
   * from a source checkout without the baked image; the container never sets it. This
   * is a correctness check, not one of the security invariants - those have no
   * escape hatch.
   */
  skipBaseDepCheck?: boolean;
}

/** A running bundler server. */
export interface BundlerServer {
  /** The port the server is listening on. */
  readonly port: number;
  /** Stop the server and release its port. */
  close(): Promise<void>;
}

/* ------------------------------------------------------------------------- *
 * Small helpers
 * ------------------------------------------------------------------------- */

/** An error carrying the HTTP status the handler should answer with. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** `{ error }` in the shape spec/bundle.md defines for a failed build. */
function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message.slice(0, MAX_ERROR_CHARS) }, status);
}

function truncate(text: string): string {
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS)}\n...` : text;
}

/**
 * Read and parse a JSON body, refusing anything over the ceiling. `Content-Length` is
 * checked first so an oversized upload is rejected before it is buffered; `Bun.serve`'s
 * own `maxRequestBodySize` is the backstop for a chunked body that lies about its size.
 */
async function readJson(req: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, `request body is larger than ${maxBytes} bytes`);
  }
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    // Bun aborts the read when the body exceeds `maxRequestBodySize`, which is the
    // usual way to land here for a request that never declared a length.
    throw new HttpError(413, `could not read the request body (limit ${maxBytes} bytes)`);
  }
  if (raw.length > maxBytes) {
    throw new HttpError(413, `request body is larger than ${maxBytes} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'body must be JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, 'body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Resolve a project path inside the build directory, or `null` if it would escape.
 * The file map arrives from a model, so `../../..` is an input we have to expect
 * rather than an input we can rule out.
 */
function resolveInside(dir: string, filePath: string): string | null {
  if (filePath.includes('\0')) return null;
  const cleaned = filePath.replace(/^\/+/, '');
  if (!cleaned) return null;
  const abs = resolve(dir, cleaned);
  const rel = relative(dir, abs);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return abs;
}

function pickEntry(files: FileMap): string | null {
  for (const candidate of ENTRY_CANDIDATES) {
    if (typeof files[candidate] === 'string') return candidate;
  }
  return null;
}

/** Validate a file map arriving on the wire. Returns the map or throws an {@link HttpError}. */
function readFileMap(value: unknown): FileMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'files must be an object of path -> source');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) throw new HttpError(422, 'project has no files');
  if (entries.length > MAX_FILES) {
    throw new HttpError(413, `project has more than ${MAX_FILES} files`);
  }
  // Null-prototype: a file map is model output, and a key of `__proto__` assigned onto
  // an ordinary object literal would set the prototype instead of adding a file.
  const files: FileMap = Object.create(null) as FileMap;
  for (const [path, source] of entries) {
    if (typeof source !== 'string') {
      throw new HttpError(400, `files[${JSON.stringify(path)}] must be a string`);
    }
    files[path] = source;
  }
  return files;
}

/** Validate the declared dependency map. Unknown/invalid names are a client bug, not a build failure. */
function readDeps(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'deps must be an object of name -> version');
  }
  const deps: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [name, version] of Object.entries(value as Record<string, unknown>)) {
    if (typeof version !== 'string') {
      throw new HttpError(400, `deps[${JSON.stringify(name)}] must be a version string`);
    }
    deps[name] = version;
  }
  return deps;
}

/** `null` when the coordinates are safe to hand to a package manager, otherwise why not. */
function validatePackage(name: unknown, version: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0) return 'name is required';
  if (name.length > MAX_PACKAGE_NAME) {
    return `package name is longer than ${MAX_PACKAGE_NAME} characters`;
  }
  if (!PACKAGE_NAME_RE.test(name)) {
    return `invalid package name ${JSON.stringify(name)}: expected a plain npm name like recharts or @tanstack/react-table`;
  }
  if (version === undefined || version === null || version === '') return null;
  if (typeof version !== 'string' || !PACKAGE_VERSION_RE.test(version)) {
    return `invalid version ${JSON.stringify(version)}: expected a semver range like 2.15.0 or ^2.15.0, or a dist-tag like latest`;
  }
  return null;
}

/** Does `name` resolve against this box's `node_modules`? */
function dependencyResolves(name: string, cwd: string): boolean {
  try {
    Bun.resolveSync(name, cwd);
    return true;
  } catch {
    // A package whose `exports` map has no bare entry (types-only, or CSS-only) still
    // counts as installed if its manifest is on disk.
    return existsSync(join(cwd, 'node_modules', name, 'package.json'));
  }
}

/* ------------------------------------------------------------------------- *
 * Package installs
 * ------------------------------------------------------------------------- */

/**
 * `bun add` mutates the shared `package.json`, lockfile and `node_modules`, so two
 * concurrent installs can leave the resolution root in a state neither of them
 * intended. Every install - from either endpoint - queues behind this chain. Builds
 * stay fully concurrent; only installs serialize.
 */
let installQueue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = installQueue.then(task, task);
  // Keep the chain alive even when a task rejects.
  installQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

interface InstallOutcome {
  ok: boolean;
  error?: string;
}

/**
 * Run one `bun add --ignore-scripts <spec>` in the resolution root.
 *
 * `--ignore-scripts` is passed unconditionally and is not derived from any argument
 * or environment variable: it must not be possible to reach this spawn without it.
 */
async function runInstall(
  name: string,
  version: string | undefined,
  cwd: string,
  timeoutMs: number,
): Promise<InstallOutcome> {
  const spec = version && version !== 'latest' ? `${name}@${version}` : name;
  return serialize(async () => {
    const proc = Bun.spawn({
      cmd: [process.execPath, 'add', IGNORE_SCRIPTS, spec],
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NO_COLOR: '1' },
    });
    const timer = setTimeout(() => {
      proc.kill();
    }, timeoutMs);
    let exit: number;
    let stdout = '';
    let stderr = '';
    try {
      [exit, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (exit !== 0) {
      const detail = (stderr || stdout || '').trim();
      return {
        ok: false,
        error: truncate(detail || `install of ${spec} failed (exit ${exit})`),
      };
    }
    return { ok: true };
  });
}

/**
 * Make sure every declared dependency resolves before the build runs, installing the
 * ones that do not. Returns an error string when a dependency is missing and cannot
 * be installed - the caller turns that into a 422 the agent can read and act on.
 */
async function ensureDeps(
  deps: Record<string, string>,
  cwd: string,
  opts: { autoInstall: boolean; installTimeoutMs: number },
): Promise<string | null> {
  const missing = Object.keys(deps).filter((name) => !dependencyResolves(name, cwd));
  if (missing.length === 0) return null;
  if (!opts.autoInstall) {
    return `missing dependencies: ${missing.join(', ')} - install them first`;
  }
  if (missing.length > MAX_AUTO_INSTALLS) {
    return `project declares ${missing.length} uninstalled dependencies (limit ${MAX_AUTO_INSTALLS})`;
  }
  for (const name of missing) {
    const invalid = validatePackage(name, deps[name]);
    if (invalid) return invalid;
    const result = await runInstall(name, deps[name], cwd, opts.installTimeoutMs);
    if (!result.ok) {
      return `could not install declared dependency ${name}: ${result.error ?? 'unknown error'}`;
    }
  }
  return null;
}

/* ------------------------------------------------------------------------- *
 * Build
 * ------------------------------------------------------------------------- */

/**
 * Pinned in every build directory so the JSX transform is what `/capabilities`
 * advertises (`jsxRuntime: 'automatic'`) regardless of any tsconfig that happens to
 * sit above the working directory. A browser bundler claiming parity has to match it.
 */
const BUILD_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      jsx: 'react-jsx',
      jsxImportSource: 'react',
      target: 'esnext',
      module: 'esnext',
      moduleResolution: 'bundler',
      allowJs: true,
      strict: false,
    },
  },
  null,
  2,
);

/**
 * Rewrite the ephemeral build directory out of a string, in both the absolute form
 * diagnostics use and the cwd-relative form Bun's output comments use, so everything
 * that leaves this service talks in project paths (`/App.tsx`).
 */
function stripBuildDir(dir: string, cwd: string): (text: string) => string {
  const rel = relative(cwd, dir);
  return (text: string) => {
    let out = text.split(dir).join('');
    if (rel && !rel.startsWith('..')) out = out.split(rel).join('');
    return out;
  };
}

/** Flatten Bun's build diagnostics into one readable message, with temp paths stripped. */
function formatLogs(logs: readonly unknown[], strip: (text: string) => string): string {
  const lines: string[] = [];
  for (const log of logs) {
    if (typeof log === 'string') {
      lines.push(log);
      continue;
    }
    if (log instanceof Error) {
      lines.push(log.message);
      continue;
    }
    const entry = log as {
      message?: string;
      name?: string;
      position?: { file?: string; line?: number; column?: number };
    };
    const pos = entry.position;
    const where = pos?.file ? `${pos.file}:${pos.line ?? '?'}:${pos.column ?? 0} ` : '';
    lines.push(where + (entry.message ?? entry.name ?? JSON.stringify(log)));
  }
  // The build directory is an implementation detail; the agent reasons in project
  // paths (`/App.tsx:42`), so rewrite them back.
  return strip(lines.filter(Boolean).join('\n'));
}

/**
 * The build driver, run by a short-lived `bun -e` child. Two reasons it is a child
 * process rather than an in-process `Bun.build` call, and both are load-bearing:
 *
 *  1. Bun caches module resolution for the life of a process, so a package installed
 *     after boot stays invisible to an in-process build. The agent's flow is
 *     install-then-rebuild, so an in-process bundler answers "Could not resolve" to
 *     every package it just installed, until the container restarts.
 *  2. Bun executes build-time macros (`import ... with { type: 'macro' }`) while
 *     bundling. The source is model-written, so that is arbitrary code the build has
 *     to be able to contain. Macro imports are rejected before we get here; the child
 *     process, with a minimal environment and a hard kill on timeout, is the backstop.
 *
 * It reads the entry path from the environment and prints one JSON line.
 */
const BUILD_DRIVER = `
const entry = process.env.HARNESS_BUILD_ENTRY;
const result = await Bun.build({
  entrypoints: [entry],
  target: 'browser',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  throw: false,
});
if (!result.success) {
  const logs = (result.logs ?? []).map((l) => ({ message: l.message ?? String(l), position: l.position }));
  process.stdout.write(JSON.stringify({ ok: false, logs }));
} else {
  let code = '';
  let css = '';
  for (const artifact of result.outputs) {
    const text = await artifact.text();
    if (artifact.path && artifact.path.endsWith('.css')) css += text;
    else code += text;
  }
  process.stdout.write(JSON.stringify({ ok: true, code, css }));
}
`;

/**
 * The build-time macro attribute, in both the static (`with { type: 'macro' }`) and the
 * dynamic-import (`{ with: { type: 'macro' } }`) spellings. Bun runs a macro's code
 * during the bundle, so a project that uses one gets code execution on the build host
 * at build time - which `--ignore-scripts` does nothing about. Model-written source
 * has no legitimate need for it, so it is refused outright.
 */
const MACRO_IMPORT_RE = /\b(?:with|assert)\s*:?\s*\{[^{}]*\btype\s*:\s*['"]macro['"]/;

/** The only environment the build child gets. Nothing the host holds leaks into a build. */
function buildEnv(entryAbs: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    NODE_ENV: 'production',
    NO_COLOR: '1',
    HARNESS_BUILD_ENTRY: entryAbs,
  };
}

interface BuildConfig {
  buildsDir: string;
  cwd: string;
  buildTimeoutMs: number;
  installTimeoutMs: number;
  autoInstall: boolean;
}

/**
 * Write the file map into a fresh directory under cwd, bundle it for the browser, and
 * delete the directory again. The directory name is unique per request, so concurrent
 * builds never share state; the `finally` is what keeps builds ephemeral.
 */
async function buildProject(
  files: FileMap,
  deps: Record<string, string>,
  cfg: BuildConfig,
): Promise<BundleResult> {
  const entry = pickEntry(files);
  if (!entry) {
    return {
      error: 'no entry file (need /index.tsx, /index.ts, /index.jsx, or /index.js)',
    };
  }

  for (const [path, source] of Object.entries(files)) {
    if (MACRO_IMPORT_RE.test(source)) {
      return {
        error: `${path}: build-time macros (import ... with { type: "macro" }) are not allowed - a macro runs on the build host while bundling. Import the module normally instead.`,
      };
    }
  }

  const depError = await ensureDeps(deps, cfg.cwd, {
    autoInstall: cfg.autoInstall,
    installTimeoutMs: cfg.installTimeoutMs,
  });
  if (depError) return { error: depError };

  // Under cwd, always: Bun resolves the app's bare imports against the node_modules
  // that lives beside the working directory, and that only works from inside it. The
  // unique outer directory is what makes concurrent builds safe; the fixed `app`
  // directory inside it keeps the output deterministic, because Bun derives module
  // symbol names from the directory an entry sits in and a UUID there would leak into
  // the generated identifiers.
  const dir = join(cfg.buildsDir, randomUUID());
  const projectDir = join(dir, 'app');
  const strip = stripBuildDir(projectDir, cfg.cwd);
  try {
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'tsconfig.json'), BUILD_TSCONFIG, 'utf-8');

    for (const [path, source] of Object.entries(files)) {
      const abs = resolveInside(projectDir, path);
      if (!abs) return { error: `illegal file path: ${path}` };
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, source, 'utf-8');
    }

    const entryAbs = resolveInside(projectDir, entry);
    if (!entryAbs) return { error: `illegal file path: ${entry}` };

    const proc = Bun.spawn({
      cmd: [process.execPath, '-e', BUILD_DRIVER],
      // cwd, not the build dir: the child resolves bare imports against the
      // node_modules beside the working directory, exactly as the invariant requires.
      cwd: cfg.cwd,
      env: buildEnv(entryAbs),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, cfg.buildTimeoutMs);

    let exit: number;
    let stdout: string;
    let stderr: string;
    try {
      [exit, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
    } finally {
      clearTimeout(timer);
    }

    if (timedOut) return { error: `build timed out after ${cfg.buildTimeoutMs}ms` };
    if (exit !== 0 || !stdout) {
      return { error: strip(truncate((stderr || stdout).trim())) || `build failed (exit ${exit})` };
    }

    let parsed: { ok: boolean; code?: string; css?: string; logs?: unknown[] };
    try {
      parsed = JSON.parse(stdout) as typeof parsed;
    } catch {
      return { error: strip(truncate(stdout.trim())) || 'build produced unreadable output' };
    }

    if (!parsed.ok) {
      const message = formatLogs(parsed.logs ?? [], strip);
      return { error: message || 'build failed (no diagnostics)' };
    }

    // Bun annotates its output with the source path of each module. Left alone those
    // comments would carry the ephemeral directory name into the browser; stripped,
    // they read as the project paths the agent and the user already think in.
    return { code: strip(parsed.code ?? ''), css: strip(parsed.css ?? '') };
  } catch (err) {
    if (err instanceof HttpError) return { error: err.message };
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    // Ephemeral by construction. A failure to clean up must not fail the request, but
    // it must not be silent either.
    void rm(dir, { recursive: true, force: true }).catch((err: unknown) => {
      console.error('[bundler] could not remove build dir', dir, err);
    });
  }
}

/* ------------------------------------------------------------------------- *
 * Startup self-check
 * ------------------------------------------------------------------------- */

/**
 * Refuse to start when a security invariant has been misconfigured away. These are
 * not warnings: a bundler that runs as root, or that builds outside its resolution
 * root, is the difference between a build service and a remote-code-execution hole
 * (spec/security.md).
 */
function selfCheck(cwd: string, buildsDir: string, baseDeps: Record<string, string>, skipBaseDepCheck: boolean): void {
  const failures: string[] = [];

  // 1. Non-root. The image ships an unprivileged account and runs as it.
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if (uid === 0) {
    failures.push(
      'running as root. The bundler executes untrusted npm code and must run as an unprivileged user (the image ships one; pass --user to docker run if you overrode it).',
    );
  }

  // 2. The builds directory lives under cwd, which is what lets node_modules resolve.
  const rel = relative(cwd, buildsDir);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    failures.push(
      `builds directory ${buildsDir} is not under the working directory ${cwd}. Imports resolve against the node_modules beside cwd, so the build dir has to sit inside it.`,
    );
  }

  // 3. `--ignore-scripts` is compiled in, not configured. This asserts nobody edited
  //    it out of the constant that the spawn actually uses.
  if (IGNORE_SCRIPTS !== '--ignore-scripts') {
    failures.push('installs are not pinned to --ignore-scripts');
  }

  // 4. The name/version regexes exist and reject the obvious shell-injection shapes.
  const hostile = ['react; rm -rf /', '../../etc/passwd', 'https://example.invalid/x.tgz'];
  for (const candidate of hostile) {
    if (PACKAGE_NAME_RE.test(candidate)) {
      failures.push(`package name regex accepts ${JSON.stringify(candidate)}`);
    }
  }
  if (PACKAGE_VERSION_RE.test('1.0.0 && curl x')) {
    failures.push('package version regex accepts a shell fragment');
  }

  if (failures.length > 0) {
    throw new Error(
      `bundler startup self-check failed:\n  - ${failures.join('\n  - ')}\nSee spec/security.md.`,
    );
  }

  // 5. Every promised base dependency resolves. Not a security invariant - a promise
  //    the build service cannot honor - so it has an explicit escape hatch for
  //    running from a source checkout.
  const missing = Object.keys(baseDeps).filter((name) => !dependencyResolves(name, cwd));
  if (missing.length > 0) {
    const detail = `the system prompt promises packages this box cannot resolve: ${missing.join(', ')} (cwd ${cwd})`;
    if (skipBaseDepCheck) console.warn(`[bundler] ${detail} - continuing, base check skipped`);
    else {
      throw new Error(
        `bundler startup self-check failed:\n  - ${detail}\nInstall the base set, or start with skipBaseDepCheck / HARNESS_BUNDLER_SKIP_BASE_CHECK=1.`,
      );
    }
  }
}

/* ------------------------------------------------------------------------- *
 * Server
 * ------------------------------------------------------------------------- */

function envFlag(name: string): boolean {
  const value = process.env[name];
  return value === '1' || value === 'true' || value === 'yes';
}

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Start the build service. It exposes the raw sidecar contract:
 *
 * - `POST /bundle {files, deps}` -> `{ code, css } | { error }`
 * - `POST /packages/install {name, version}` -> `{ ok, error? }` (always `--ignore-scripts`)
 * - `GET /health` -> `{ ok: true, caps }`
 *
 * On startup it self-checks the security invariants (non-root, `--ignore-scripts`
 * enforced, name/version regex present, builds dir under cwd) and that every baked base
 * dependency resolves, and refuses to run otherwise.
 */
export async function serve(opts: ServeOptions = {}): Promise<BundlerServer> {
  const cwd = process.cwd();
  const buildsDir = resolve(cwd, opts.buildsDir ?? BUILDS_DIRNAME);
  const baseDeps = opts.baseDeps ?? { ...BASE_DEPENDENCIES };
  const skipBaseDepCheck = opts.skipBaseDepCheck ?? envFlag('HARNESS_BUNDLER_SKIP_BASE_CHECK');
  const maxRequestBytes =
    opts.maxRequestBytes ?? envInt('HARNESS_BUNDLER_MAX_BYTES', DEFAULT_MAX_REQUEST_BYTES);
  const buildTimeoutMs =
    opts.buildTimeoutMs ?? envInt('HARNESS_BUNDLER_BUILD_TIMEOUT_MS', DEFAULT_BUILD_TIMEOUT_MS);
  const installTimeoutMs =
    opts.installTimeoutMs ?? envInt('HARNESS_BUNDLER_INSTALL_TIMEOUT_MS', DEFAULT_INSTALL_TIMEOUT_MS);
  const autoInstall = opts.autoInstall ?? !envFlag('HARNESS_BUNDLER_NO_AUTO_INSTALL');

  selfCheck(cwd, buildsDir, baseDeps, skipBaseDepCheck);

  // A stale directory from a killed process would otherwise leak disk forever.
  await rm(buildsDir, { recursive: true, force: true }).catch(() => {});
  await mkdir(buildsDir, { recursive: true });

  const cfg: BuildConfig = { buildsDir, cwd, buildTimeoutMs, installTimeoutMs, autoInstall };
  const port = opts.port ?? envInt('PORT', DEFAULT_PORT);

  async function handleBundle(req: Request): Promise<Response> {
    const body = await readJson(req, maxRequestBytes);
    const files = readFileMap(body.files);
    const deps = readDeps(body.deps);
    const started = Date.now();
    const result = await buildProject(files, deps, cfg);
    if ('error' in result) {
      console.warn(`[bundler] build failed in ${Date.now() - started}ms: ${result.error}`);
      // 422, not 500: a build that does not compile is an expected outcome the
      // workspace shows in the preview fallback and hands back to the agent.
      return errorResponse(result.error, 422);
    }
    const count = Object.keys(files).length;
    console.log(
      `[bundler] built ${count} file${count === 1 ? '' : 's'} in ${Date.now() - started}ms (${result.code.length}B js, ${result.css.length}B css)`,
    );
    return jsonResponse(result);
  }

  async function handleInstall(req: Request): Promise<Response> {
    const body = await readJson(req, maxRequestBytes);
    const invalid = validatePackage(body.name, body.version);
    if (invalid) return jsonResponse({ ok: false, error: invalid }, 400);
    const name = body.name as string;
    const version = typeof body.version === 'string' && body.version ? body.version : undefined;
    const started = Date.now();
    const result = await runInstall(name, version, cwd, installTimeoutMs);
    if (!result.ok) {
      console.warn(`[bundler] install ${name} failed: ${result.error}`);
      // A failed install is a normal outcome the agent recovers from, so it comes
      // back 200 with `ok: false` rather than as a transport error.
      return jsonResponse({ ok: false, error: result.error }, 200);
    }
    console.log(`[bundler] installed ${name}@${version ?? 'latest'} in ${Date.now() - started}ms`);
    return jsonResponse({ ok: true, name, version: version ?? 'latest' });
  }

  const server = Bun.serve({
    port,
    hostname: opts.hostname ?? '0.0.0.0',
    // Backstop for a chunked body that never declares its length.
    maxRequestBodySize: maxRequestBytes,
    async fetch(req: Request): Promise<Response> {
      const { pathname } = new URL(req.url);
      try {
        if (pathname === '/health') {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            return errorResponse('method not allowed', 405);
          }
          return jsonResponse({ ok: true, caps: BUNDLER_CAPS });
        }
        if (pathname === '/bundle') {
          if (req.method !== 'POST') return errorResponse('method not allowed', 405);
          return await handleBundle(req);
        }
        if (pathname === '/packages/install') {
          if (req.method !== 'POST') return errorResponse('method not allowed', 405);
          return await handleInstall(req);
        }
        return errorResponse('not found', 404);
      } catch (err) {
        if (err instanceof HttpError) {
          const payload =
            pathname === '/packages/install'
              ? { ok: false, error: err.message }
              : { error: err.message };
          return jsonResponse(payload, err.status);
        }
        const message = err instanceof Error ? err.message : String(err);
        console.error('[bundler] unhandled error', err);
        return errorResponse(message, 500);
      }
    },
  });

  console.log(
    `[bundler] listening on ${server.hostname}:${server.port} - cwd ${cwd}, builds ${buildsDir}, uid ${process.getuid?.() ?? 'n/a'}`,
  );

  return {
    // `server.port` is only absent for a unix-socket listener, which this never is.
    port: server.port ?? port,
    async close(): Promise<void> {
      await server.stop(true);
      await rm(buildsDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/* ------------------------------------------------------------------------- *
 * Entrypoint
 * ------------------------------------------------------------------------- */

if (import.meta.main) {
  const server = await serve();
  const shutdown = (signal: string) => {
    console.log(`[bundler] ${signal} - shutting down`);
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
