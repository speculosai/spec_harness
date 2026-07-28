/// <reference types="vite/client" />

/**
 * Vite's ambient types: `import.meta.env`, and the module declarations that make
 * `import '@speculosai/spec_harness/styles.css'` a legal import.
 *
 * The one variable this example reads is optional. Set `VITE_HARNESS_TOKEN` to
 * have the workspace send `Authorization: Bearer <token>` on every request; leave
 * it unset and it sends nothing, which is what the backend's single-user default
 * expects. Only `VITE_`-prefixed variables reach the browser, and this one ends up
 * in the built bundle - so it is for local development, not a production secret.
 */
interface ImportMetaEnv {
  readonly VITE_HARNESS_TOKEN?: string;
}
