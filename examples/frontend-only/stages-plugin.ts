/**
 * Stage compilation: the "files the agent wrote", turned into a file map and a
 * browser-ready bundle at build time.
 *
 * A demo's stages live at `src/demos/<demo>/stages/<NN-name>/`. Each stage is a whole
 * small React app; stage N is stage N-1 plus one coherent change, because the *diff*
 * between two stages is exactly what the scripted turn streams as `write_file` /
 * `delete_file` tool calls. Nothing here knows about the chat script - it only turns
 * directories into `{ files, code }`.
 *
 * The three helpers below are plain Node functions on purpose: `scripts/check-entry.ts`
 * reuses them to build the same registry the Vite plugin serves, so `npm run check`
 * proves every stage compiles without a `vite build` and without writing to `dist/`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { build } from 'esbuild';
import type { Plugin } from 'vite';

/** The virtual module the app imports its stage registry from. */
export const STAGES_MODULE_ID = 'virtual:demo-stages';

/** Rollup convention: a resolved virtual id is prefixed with a NUL byte. */
const RESOLVED_STAGES_ID = `\0${STAGES_MODULE_ID}`;

/** One compiled stage: the file map a visitor reads, and the bundle the preview runs. */
export interface CompiledStage {
  /** The stage directory name, e.g. `"1-attention-board"`. */
  name: string;
  /** In-project path (`"/App.tsx"`) to source. This is the project's `FileMap`. */
  files: Record<string, string>;
  /** The stage's `index.tsx`, bundled to an IIFE the preview can inline. */
  code: string;
  /** Always empty: stage apps style with Tailwind classes from the preview head. */
  css: string;
}

/** Every demo's stages, in order. Keyed by demo id (`"property"`, ...). */
export type StageRegistry = Record<string, CompiledStage[]>;

/* ------------------------------------------------------------------------- *
 * Pure helpers (shared with the conformance check)
 * ------------------------------------------------------------------------- */

/**
 * Find every demo's stage directories under `demosDir`, in play order.
 *
 * Order is the lexicographic directory name (`0-start`, `1-...`, `2-...`), which is why
 * stages are named with a leading index rather than a bare word.
 */
export function scanStageDirs(demosDir: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!existsSync(demosDir)) return out;

  for (const demoId of readdirSync(demosDir).sort()) {
    const stagesDir = join(demosDir, demoId, 'stages');
    if (!existsSync(stagesDir) || !statSync(stagesDir).isDirectory()) continue;
    const stages = readdirSync(stagesDir)
      .filter((name) => statSync(join(stagesDir, name)).isDirectory())
      .sort()
      .map((name) => join(stagesDir, name));
    if (stages.length) out[demoId] = stages;
  }
  return out;
}

/**
 * Read one stage directory into a `FileMap`.
 *
 * Every file joins the map under its path relative to the stage root, with a leading
 * slash - the same shape the wire protocol uses for a project's files, so what the
 * explorer shows and what a `write_file` call carries are the same strings.
 */
export function readStageFiles(stageDir: string): Record<string, string> {
  const files: Record<string, string> = {};

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      files[`/${relative(stageDir, full).split(sep).join('/')}`] = readFileSync(full, 'utf8');
    }
  };

  walk(stageDir);
  return files;
}

/**
 * Bundle a stage's `index.tsx` into a single IIFE the preview can inline.
 *
 * This is the mock's stand-in for the build service: the real deployment posts the file
 * map to the bundler sidecar, this example ships the same output precompiled. React
 * resolves from the example's own `node_modules`, and a stage that does not compile
 * fails the build with its own path in the message rather than a bare esbuild error.
 */
export async function compileStage(stageDir: string): Promise<string> {
  const entry = join(stageDir, 'index.tsx');
  if (!existsSync(entry)) {
    throw new Error(`stage ${stageDir} has no index.tsx - every stage needs one entry point`);
  }
  try {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      minify: true,
      sourcemap: false,
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    });
    const code = result.outputFiles?.[0]?.text ?? '';
    if (!code.trim()) throw new Error('esbuild produced an empty bundle');
    return code;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`stage ${stageDir} failed to compile:\n${detail}`);
  }
}

/** Build the whole registry: every demo, every stage, files + compiled bundle. */
export async function buildStageRegistry(demosDir: string): Promise<StageRegistry> {
  const registry: StageRegistry = {};
  for (const [demoId, stageDirs] of Object.entries(scanStageDirs(demosDir))) {
    registry[demoId] = [];
    for (const stageDir of stageDirs) {
      registry[demoId].push({
        name: stageDir.split(sep).pop() ?? '',
        files: readStageFiles(stageDir),
        code: await compileStage(stageDir),
        css: '',
      });
    }
  }
  return registry;
}

/* ------------------------------------------------------------------------- *
 * The Vite plugin
 * ------------------------------------------------------------------------- */

/** Options for {@link demoStages}. */
export interface DemoStagesOptions {
  /** Where the demo directories live. Defaults to `<root>/src/demos`. */
  demosDir?: string;
}

/**
 * Serve `virtual:demo-stages`: `Record<demoId, CompiledStage[]>`, compiled at
 * plugin-load time. In dev every stage file is watched, so editing a stage app
 * invalidates the module and reloads the page.
 */
export function demoStages(options: DemoStagesOptions = {}): Plugin {
  let demosDir = options.demosDir ?? '';

  return {
    name: 'harness-demo-stages',

    configResolved(config) {
      if (!demosDir) demosDir = join(config.root, 'src', 'demos');
    },

    resolveId(id) {
      return id === STAGES_MODULE_ID ? RESOLVED_STAGES_ID : null;
    },

    async load(id) {
      if (id !== RESOLVED_STAGES_ID) return null;
      const registry = await buildStageRegistry(demosDir);
      // Watching each source file is what makes a stage edit behave like any other
      // source edit in dev; the handler below turns the invalidation into a reload.
      for (const stageDirs of Object.values(scanStageDirs(demosDir))) {
        for (const stageDir of stageDirs) {
          for (const path of Object.keys(readStageFiles(stageDir))) {
            this.addWatchFile(join(stageDir, path.slice(1)));
          }
        }
      }
      return `export default ${JSON.stringify(registry)};`;
    },

    handleHotUpdate(ctx) {
      if (!ctx.file.includes(`${sep}stages${sep}`)) return;
      const module = ctx.server.moduleGraph.getModuleById(RESOLVED_STAGES_ID);
      if (module) ctx.server.moduleGraph.invalidateModule(module);
      // The registry is a data module every demo reads at startup; a full reload is
      // both simpler and more honest than trying to hot-patch a compiled bundle.
      ctx.server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}
