// The wire types the build service needs. Kept local so the service depends on
// nothing from the client library - it is distributed as the speculosai/harness-bundler
// container, not on npm.

export type FileMap = Record<string, string>;

export interface BundlerCaps {
  location: 'server' | 'browser';
  supportsInstall: boolean;
  jsxRuntime: 'automatic' | 'classic';
}

export type BundleResult = { code: string; css: string } | { error: string };
