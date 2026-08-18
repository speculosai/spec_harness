/**
 * The factory demo, assembled for the host app.
 *
 * This file is the only part of the demo that renders anything, and all it renders is
 * the brand: the workspace's top bar is the page's only chrome, so the back link to
 * the other demos lives in the logo slot beside the mark.
 *
 * Everything with behavior in it - the turns, the dataset, the actions, the card copy -
 * is in the DOM-free `./script` and `./data`, which is what lets `npm run check` replay
 * this demo under Node.
 */

import type { VerticalDemo } from '../../mock/types';
import { card, definition, probes, strings } from './script';

/** The accent this vertical is drawn in, shared with the landing card. */
const ACCENT = card.accent;

/**
 * Back to the demo list, plus Ashford's mark: three bars of different heights, one per
 * line, which is the same shape the app draws when it ranks them. Rendered in the
 * `<Builder>` top bar, the page's only chrome.
 */
function AshfordLogo() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <a
        href="#/"
        aria-label="All demos"
        title="All demos"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
          borderRadius: 6,
          color: 'inherit',
          textDecoration: 'none',
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        &#8592;
      </a>
      <svg width="18" height="18" viewBox="0 0 18 18" role="img" aria-label="Ashford Works">
        <rect x="1" y="1" width="16" height="16" rx="4" fill={ACCENT} opacity="0.14" />
        <path
          d="M4.5 13.5v-4M9 13.5v-7M13.5 13.5v-5"
          fill="none"
          stroke={ACCENT}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/** The factory vertical, as the registry and the landing page consume it. */
export const demo: VerticalDemo = {
  definition,
  card,
  strings,
  probes,
  brand: { name: 'Ashford Works', Logo: <AshfordLogo /> },
};
