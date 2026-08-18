/**
 * One line's day: what it made against what was planned, and everything that stopped it.
 *
 * The bar pair is two plain rectangles in an SVG - the planned run, and the part of it
 * that actually came off. No chart library: at this size a library would be more code
 * than the drawing.
 */

import { minutesLost } from '../lib/rows';
import type { Line, Stop } from '../lib/rows';

/** The vertical's accent, kept next to the only marks drawn in it. */
const ACCENT = '#b45309';

/** Props for {@link LineToday}. */
export interface LineTodayProps {
  /** The line this card is about. */
  line: Line;
  /** Pieces finished today. */
  made: number;
  /** Pieces the plan asked for today. */
  planned: number;
  /** Today's stops on this line, in the order they happened. */
  stops: Stop[];
}

/** Planned above, made below, both measured against the same full width. */
function MadeVsPlanned({ made, planned }: { made: number; planned: number }) {
  const share = planned > 0 ? Math.min(100, Math.round((made / planned) * 100)) : 0;
  return (
    <svg
      viewBox="0 0 100 14"
      preserveAspectRatio="none"
      className="h-3.5 w-full"
      role="img"
      aria-label={`${made} made against ${planned} planned`}
    >
      <rect x="0" y="0" width="100" height="6" fill={ACCENT} opacity="0.18" />
      <rect x="0" y="8" width={share} height="6" fill={ACCENT} />
    </svg>
  );
}

export function LineToday({ line, made, planned, stops }: LineTodayProps) {
  const short = Math.max(0, planned - made);
  const lost = minutesLost(stops);

  return (
    <article className="rounded-lg border border-stone-200 bg-white p-4">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-stone-900">{line.name}</h3>
          <p className="text-xs text-stone-500">{line.makes}</p>
        </div>
        <p className="text-sm tabular-nums text-stone-700">
          <span className="font-semibold text-stone-900">{made}</span> of {planned} made
        </p>
      </header>

      <div className="mt-3">
        <MadeVsPlanned made={made} planned={planned} />
      </div>
      <p className="mt-1.5 flex justify-between text-[11px] uppercase tracking-wide text-stone-400">
        <span>planned {planned}</span>
        <span>{short === 0 ? 'on plan' : `${short} short`}</span>
      </p>

      <div className="mt-4 border-t border-stone-100 pt-2">
        <p className="text-xs text-stone-500">
          {stops.length === 0
            ? 'Nothing stopped this line today.'
            : `${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}, ${lost} minutes lost`}
        </p>
        {stops.length > 0 && (
          <ul className="mt-1 divide-y divide-stone-100">
            {stops.map((stop) => (
              <li key={stop.id} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                <span className="text-stone-700">
                  {stop.machine}
                  <span className="text-stone-400"> - {stop.reason.toLowerCase()}</span>
                </span>
                <span className="tabular-nums text-stone-600">{stop.minutes} min</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
