/**
 * Preview self-check.
 *
 * A small, dependency-free proof that the security-load-bearing parts of this package
 * do what `spec/preview-bridge.md` and `spec/security.md` say they do: the sandbox
 * string is intact, the assembled document contains every required piece in the
 * required order, and the escaper defeats a `</script>` breakout.
 *
 *     bun run src/self-check.ts      # or: node src/self-check.ts (Node 22.18+)
 *
 * Exits non-zero on the first failing assertion, so it is usable as a CI gate.
 */

import {
  SANDBOX_ATTRIBUTES,
  buildSrcDoc,
  buildErrorDoc,
  makeShim,
  escapeForScript,
  escapeForStyle,
  escapeHtml,
  assertSandboxSafe,
} from './preview.ts';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}`);
  }
}

function throws(name: string, fn: () => unknown): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  check(name, threw);
}

/* -- the sandbox invariant ------------------------------------------------- */

console.log('sandbox');
check(
  'the normative string is exactly the spec string',
  SANDBOX_ATTRIBUTES ===
    'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-top-navigation-by-user-activation',
);
check('allow-same-origin is absent', !SANDBOX_ATTRIBUTES.includes('allow-same-origin'));
check(
  'top navigation is gated on user activation',
  !SANDBOX_ATTRIBUTES.split(/\s+/).includes('allow-top-navigation'),
);
throws('a weakened sandbox is rejected', () =>
  assertSandboxSafe(`${SANDBOX_ATTRIBUTES} allow-same-origin`),
);
throws('a weakened sandbox is rejected case-insensitively', () =>
  assertSandboxSafe(`${SANDBOX_ATTRIBUTES} ALLOW-SAME-ORIGIN`),
);
throws('ungated top navigation is rejected', () =>
  assertSandboxSafe('allow-scripts allow-top-navigation'),
);

/* -- escaping -------------------------------------------------------------- */

console.log('escaping');
const breakout = `const payload = "</script><script>window.__pwned = 1;</script>";`;
const escaped = escapeForScript(breakout);
check('</script> no longer appears literally', !/<\/script/i.test(escaped));
check('the escape is the standard <\\/script form', escaped.includes('<\\/script'));
check('case-insensitive: </ScRiPt is escaped too', !/<\/script/i.test(escapeForScript('</ScRiPt>')));
check('HTML comment openers are neutralised', escapeForScript('a <!-- b') === 'a <\\!-- b');
check(
  'unicode line separators are escaped',
  escapeForScript('a\u2028b\u2029c') === 'a\\u2028b\\u2029c',
);
check('escaping is idempotent', escapeForScript(escaped) === escaped);
check('</style> cannot close the style element', !/<\/style/i.test(escapeForStyle('a{}</style>')));
check(
  'escapeHtml is safe in quoted-attribute context (single quote escaped)',
  escapeHtml(`a'"<>&`) === 'a&#39;&quot;&lt;&gt;&amp;',
);

// The breakout attempt, run through the real document assembly. The payload text
// survives - it is a string literal in the app's own code - but it must not create a
// script element boundary, so the element count is what proves containment.
const hostile = buildSrcDoc({ code: breakout, css: 'body{}' });
const closers = (hostile.match(/<\/script/gi) ?? []).length;
check('the document holds exactly the 5 closing tags it emitted', closers === 5);
check('the payload cannot close a script element', hostile.includes('<\\/script><script>window.__pwned'));
// `<!--` would put the tokenizer into script-data-escaped state, where a later
// `</script>` no longer closes the element. Nothing may reach the document unescaped.
check('no HTML comment opener survives into the document', !hostile.includes('<!--'));

/* -- document assembly ----------------------------------------------------- */

console.log('buildSrcDoc');
const doc = buildSrcDoc({
  code: 'window.__ran = true;',
  css: '.northwind { color: rebeccapurple }',
  namespace: 'app',
  shim: makeShim('app', { kinds: ['postgres'], shim: 'window.__contributed = 1;' }),
});

check('is a full html document', doc.startsWith('<!doctype html>') && doc.trimEnd().endsWith('</html>'));
check('declares a charset', doc.includes('<meta charset="utf-8" />'));
check('loads the default styling strategy', doc.includes('cdn.tailwindcss.com'));
check('inlines the bundled css', doc.includes('.northwind { color: rebeccapurple }'));
check('has the #root mount point', doc.includes('<div id="root"></div>'));
check('injects the user code', doc.includes('window.__ran = true;'));
check('folds in the connector shim contribution', doc.includes('window.__contributed = 1;'));
check('installs the bridge helper', doc.includes('window.__harnessBridge'));
check('installs the connector registry', doc.includes('window.__harnessRegister'));
check('carries the 60-second timeout', doc.includes('60000'));
check('captures uncaught errors', doc.includes("addEventListener('error'"));
check('captures unhandled rejections', doc.includes("addEventListener('unhandledrejection'"));
check('reports failures as preview-error', doc.includes("type: 'preview-error'"));
check('carries the blank-render watchdog', doc.includes('rendered nothing'));

// Order is load-bearing: error capture, then the shim, then the app, then the watchdog.
const iError = doc.indexOf('__harnessShowFallback');
const iShim = doc.indexOf('__harnessBridge');
const iCode = doc.indexOf('window.__ran = true;');
const iWatchdog = doc.lastIndexOf('__harnessShowFallback');
check('error capture is installed before the shim', iError > -1 && iError < iShim);
check('the shim is installed before the app code', iShim > -1 && iShim < iCode);
check('the watchdog runs after the app code', iWatchdog > iCode);

/* -- namespace binding ----------------------------------------------------- */

console.log('namespace');
const renamed = buildSrcDoc({ code: '', css: '', namespace: 'northwind' });
check('binds window[<ns>]', renamed.includes('window[NS] = api'));
check('the namespace constant is threaded through', renamed.includes('var NS = "northwind"'));
check('aliases the previous default so older apps keep resolving', renamed.includes('var ALIASES = ["app"]'));
check(
  'the default namespace installs no alias',
  buildSrcDoc({ code: '', css: '' }).includes('var ALIASES = []'),
);

/* -- never-throw stubs ----------------------------------------------------- */

console.log('stubs');
const shim = makeShim('app');
check('row-shaped stub result', shim.includes('{ rows: [], error: msg }'));
check('object-shaped stub result', shim.includes('{ data: null, error: msg }'));
check('unknown names are proxied, not undefined', shim.includes('new Proxy(target'));
check('the namespace object is never thenable', shim.includes("if (prop === 'then') return undefined;"));

/* -- the build-failure fallback -------------------------------------------- */

console.log('buildErrorDoc');
const failed = buildErrorDoc({ error: 'Could not resolve "recharts" from /App.tsx' });
check('renders a readable card, not a blank frame', failed.includes('This preview could not run'));
check('carries the build error', failed.includes('Could not resolve'));
check('reports the failure to the parent', failed.includes("type: 'preview-error'"));
check('needs no network fetch to render', !failed.includes('cdn.tailwindcss.com'));
const hostileBuildError = buildErrorDoc({ error: '</script><script>window.__pwned=1</script>' });
check(
  'a hostile build error cannot break out',
  (hostileBuildError.match(/<\/script/gi) ?? []).length === 2 &&
    !hostileBuildError.includes('<!--'),
);

/* -- result ---------------------------------------------------------------- */

console.log('');
if (failures.length > 0) {
  console.error(`FAILED: ${failures.length} of ${passed + failures.length} checks`);
  for (const name of failures) console.error(`  - ${name}`);
  process.exit(1);
}
console.log(`preview self-check: ${passed} checks passed`);
