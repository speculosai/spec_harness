/**
 * Two routes and no router dependency.
 *
 * `#/` is the landing page; `#/<demoId>` opens that demo's workspace. The hash is used
 * rather than the path so the built app is a single static file that works from any
 * directory, opened over `file://` or served from a sub-path - which is the whole point
 * of an example with no backend behind it.
 */

import { useEffect, useState } from 'react';

import { DemoPage } from './DemoPage';
import { Landing } from './Landing';
import { demoById } from './demos/registry';

/** The demo id in the URL hash, or `''` for the landing page. */
function routeOf(): string {
  return window.location.hash.replace(/^#\/?/, '').split(/[?/]/)[0] ?? '';
}

export function App() {
  const [route, setRoute] = useState(routeOf);

  useEffect(() => {
    const onHashChange = (): void => setRoute(routeOf());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const demo = route ? demoById(route) : undefined;
  // An unknown hash lands on the list rather than on an error: the id in the URL is a
  // request, not a promise.
  if (!demo) return <Landing />;

  // Keyed by id so switching demos remounts the provider rather than reusing another
  // demo's rebuild key, split position and capabilities.
  return <DemoPage key={demo.definition.id} demo={demo} />;
}
