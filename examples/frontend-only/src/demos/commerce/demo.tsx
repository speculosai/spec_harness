/**
 * The commerce demo, assembled for the host app.
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

/** Back to the demo list, plus Bluebell's mark. Rendered in `<Builder>`'s top bar. */
function BluebellLogo() {
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
      <svg width="18" height="18" viewBox="0 0 18 18" role="img" aria-label="Bluebell Goods">
        <rect x="1" y="1" width="16" height="16" rx="4" fill={ACCENT} opacity="0.14" />
        <path
          d="M4.5 6.5h9v7h-9v-7ZM4.5 6.5 6 4h6l1.5 2.5M9 6.5v7"
          fill="none"
          stroke={ACCENT}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** The commerce vertical, as the registry and the landing page consume it. */
export const demo: VerticalDemo = {
  definition,
  card,
  strings,
  probes,
  brand: { name: 'Bluebell Goods', Logo: <BluebellLogo /> },
};
