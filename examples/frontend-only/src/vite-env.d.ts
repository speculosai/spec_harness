/// <reference types="vite/client" />

/**
 * The stage registry, compiled by `stages-plugin.ts` and served as a virtual module.
 *
 * Every demo's stages, in play order, each with the file map a visitor reads in the
 * explorer and the bundle the preview runs. It is generated at build time from
 * `src/demos/<demo>/stages/`, so there is nothing to keep in step by hand.
 */
declare module 'virtual:demo-stages' {
  const stages: import('./mock/types').StageRegistry;
  export default stages;
}
