/**
 * Mount the mock backend in the browser by patching `window.fetch` once.
 *
 * A `fetch` patch rather than a service worker: it needs no registration step, no
 * HTTPS, no scope rules and no second build output - and the workspace goes through
 * `fetch` for every single thing it does, so one seam covers the chat stream, the
 * bundle call, the project and snapshot reads and the preview's bridge proxy.
 *
 * Requests under `/demo-api/` are answered from memory. Everything else - the page
 * itself, Vite's dev client, source modules - passes through untouched.
 */

import stages from 'virtual:demo-stages';

import { demos } from '../demos/registry';
import { createDemoBackend, DEMO_API_PREFIX } from './server';
import { DATA_SHIM } from './shim';

/**
 * Module-level, so React StrictMode's double-invoked effects (and a hot reload that
 * re-runs this module) cannot stack one patch on top of another - which would leave
 * every mocked request going through two handlers.
 */
let installed = false;

/** Everything `createDemoBackend` needs about one request, pulled off either call form. */
interface NormalizedRequest {
  pathname: string;
  init: RequestInit;
}

/** `fetch(url, init)` and `fetch(new Request(...))` are both legal; normalize both. */
async function normalize(input: RequestInfo | URL, init?: RequestInit): Promise<NormalizedRequest | null> {
  if (typeof Request !== 'undefined' && input instanceof Request) {
    const url = new URL(input.url, window.location.href);
    if (!url.pathname.startsWith(DEMO_API_PREFIX)) return null;
    const body = input.method === 'GET' || input.method === 'HEAD' ? undefined : await input.clone().text();
    return { pathname: url.pathname, init: { method: input.method, body, signal: input.signal } };
  }
  const url = new URL(String(input), window.location.href);
  if (!url.pathname.startsWith(DEMO_API_PREFIX)) return null;
  return { pathname: url.pathname, init: init ?? {} };
}

/**
 * Install the mock backend. Safe to call more than once; only the first call patches.
 *
 * Call it before anything renders - `<HarnessProvider>` asks for `/capabilities` on
 * mount, and a request that escapes to the network would come back as the dev server's
 * index.html and quietly fall the client back to protocol-1 defaults.
 */
export function installDemoBackend(): void {
  if (installed) return;
  installed = true;

  const backend = createDemoBackend({
    demos: demos.map((demo) => demo.definition),
    stages,
    shim: DATA_SHIM,
  });

  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = await normalize(input, init);
    if (!request) return original(input as RequestInfo, init);
    return backend.handle(request.pathname, request.init);
  };
}
