/**
 * The property demo, assembled for the host app.
 *
 * This file is the only part of the demo that renders anything, and all it renders is
 * the brand: the workspace's top bar is the page's only chrome, so the link back to the
 * other two demos lives in the logo slot beside the mark.
 *
 * Everything with behavior in it - the turns, the dataset, the actions, the card copy,
 * the composer placeholder - is in the DOM-free `./script` and `./data`, which is what
 * lets `npm run check` replay this demo under Node.
 */

import type { VerticalDemo } from '../../mock/types';
import { card, definition, probes, strings } from './script';

/** The accent this vertical is drawn in, shared with the landing card. */
const ACCENT = card.accent;

/**
 * Back to the demo list, plus Northwind's mark: a roofline over three bays, which is
 * as close to "a company that looks after buildings" as a sixteen-pixel square gets.
 */
function NorthwindLogo() {
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
      <svg width="18" height="18" viewBox="0 0 18 18" role="img" aria-label="Northwind Property Group">
        <rect x="1" y="1" width="16" height="16" rx="4" fill={ACCENT} opacity="0.12" />
        <path d="M3.5 8.25 9 4.25l5.5 4" fill="none" stroke={ACCENT} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 9.5v4M9 9.5v4M13 9.5v4" stroke={ACCENT} strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** The property vertical, as the registry and the landing page consume it. */
export const demo: VerticalDemo = {
  definition,
  card,
  strings,
  probes,
  brand: { name: 'Northwind', Logo: <NorthwindLogo /> },
};
