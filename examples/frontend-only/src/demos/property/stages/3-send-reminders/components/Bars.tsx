/**
 * The two figures on the late-payment panel, drawn by hand.
 *
 * Both are plain `<svg>`: four columns for the overdue bands, one horizontal bar per
 * building. `preserveAspectRatio="none"` lets each one stretch to whatever width the
 * panel has, which is what keeps them readable in a narrow preview.
 */

import type { Total } from '../lib/attention';
import { countOf, money } from '../lib/format';

/** The vertical's accent, and the gray the bars sit on. */
const ACCENT = '#047857';
const TRACK = '#e7e5e4';

/** Two decimals is plenty for a bar, and it keeps the markup readable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** How much is owed in each band, worst on the left. */
export function BandChart({ bands }: { bands: Total[] }) {
  const most = Math.max(1, ...bands.map((band) => band.owed));
  const slot = 100 / bands.length;

  return (
    <div>
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="h-20 w-full"
        role="img"
        aria-label="How much is owed in each band of days late"
      >
        {bands.map((band, index) => {
          const height = band.owed === 0 ? 0 : round(Math.max(1.5, (band.owed / most) * 36));
          return (
            <rect
              key={band.label}
              x={round(index * slot + slot * 0.22)}
              y={round(38 - height)}
              width={round(slot * 0.56)}
              height={height}
              fill={ACCENT}
              opacity={round(0.85 - index * 0.15)}
            />
          );
        })}
        <line x1="0" y1="38.5" x2="100" y2="38.5" stroke={TRACK} strokeWidth="1" />
      </svg>
      <ul className="mt-2 grid grid-cols-4 gap-1 text-center">
        {bands.map((band) => (
          <li key={band.label}>
            <p className="text-[11px] leading-tight text-stone-500">{band.label}</p>
            <p className="text-xs font-medium tabular-nums text-stone-900">{money(band.owed)}</p>
            <p className="text-[11px] tabular-nums text-stone-400">
              {countOf(band.count, 'place', 'places')}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What each building is carrying, drawn against the one carrying the most. */
export function BuildingBars({ buildings }: { buildings: Total[] }) {
  const most = buildings[0]?.owed ?? 0;

  return (
    <ul className="space-y-2.5">
      {buildings.map((building) => (
        <li key={building.label}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate text-stone-700">
              {building.label}
              <span className="text-stone-400"> · {countOf(building.count, 'place', 'places')}</span>
            </span>
            <span className="shrink-0 tabular-nums text-stone-900">{money(building.owed)}</span>
          </div>
          <svg
            viewBox="0 0 100 6"
            preserveAspectRatio="none"
            className="mt-1 h-1.5 w-full"
            role="presentation"
          >
            <rect x="0" y="0" width="100" height="6" fill={TRACK} />
            <rect
              x="0"
              y="0"
              width={most > 0 ? round(Math.max(2, (building.owed / most) * 100)) : 0}
              height="6"
              fill={ACCENT}
            />
          </svg>
        </li>
      ))}
    </ul>
  );
}
