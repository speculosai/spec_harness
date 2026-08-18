/**
 * Where the week went: every stop reason ranked by the minutes it cost, with a filter
 * for one line at a time and a plain sentence about the machine behind the worst of it.
 *
 * The ranking is drawn against the biggest reason rather than against the total, so the
 * first bar is always full width and the rest are read against it. The line filter runs
 * the machine list underneath it too, so a check is booked from the same view that
 * showed why it is needed.
 */

import { useState } from 'react';

import { Machines } from './Machines';
import type { Note } from '../lib/actions';
import { dayLabel, minutesLost } from '../lib/rows';
import type { Check, Line, Stop } from '../lib/rows';
import { machineTotals, reasonTotals } from '../lib/summary';

/** The vertical's accent, kept next to the only marks drawn in it. */
const ACCENT = '#b45309';

/** Props for {@link WeekPanel}. */
export interface WeekPanelProps {
  /** Every line, for the filter and for naming the worst machine's line. */
  lines: Line[];
  /** The stops from the week that is running, all lines. */
  stops: Stop[];
  /** The Monday the week started. */
  weekStart: string;
  /** The last day on record. */
  today: string;
  /** Every check on the schedule, planned and done. */
  checks: Check[];
  /** Book a check on one machine. */
  onSchedule: (machine: string) => void;
  /** The machine whose check is being booked right now, if any. */
  booking: string | null;
  /** What just happened, in one line, and whether it went through. */
  note: Note | null;
}

/** One ranked bar. A track and a fill, measured against the worst reason. */
function ReasonBar({ value, of }: { value: number; of: number }) {
  const width = of > 0 ? Math.max(2, Math.round((value / of) * 100)) : 0;
  return (
    <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-2.5 w-full" role="presentation">
      <rect x="0" y="0" width="100" height="10" fill="#e7e5e4" />
      <rect x="0" y="0" width={width} height="10" fill={ACCENT} />
    </svg>
  );
}

export function WeekPanel({ lines, stops, weekStart, today, checks, onSchedule, booking, note }: WeekPanelProps) {
  const [chosen, setChosen] = useState<string>('all');

  const shown = chosen === 'all' ? stops : stops.filter((stop) => stop.line === chosen);
  const reasons = reasonTotals(shown);
  const machines = machineTotals(shown, lines);
  const worst = machines[0];
  const top = reasons[0]?.minutes ?? 0;

  const chip = (active: boolean): string =>
    `rounded-md border px-2.5 py-1 text-xs font-medium ${
      active ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-stone-200 bg-white text-stone-600'
    }`;

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="text-sm font-semibold text-stone-900">Where the week went</h2>
          <p className="text-xs text-stone-500">
            {dayLabel(weekStart)} to {dayLabel(today)}
          </p>
        </div>
        <p className="text-sm tabular-nums text-stone-700">
          <span className="font-semibold text-stone-900">{minutesLost(shown)}</span> minutes lost over{' '}
          {shown.length} stops
        </p>
      </header>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setChosen('all')} aria-pressed={chosen === 'all'} className={chip(chosen === 'all')}>
          All lines
        </button>
        {lines.map((line) => (
          <button
            key={line.id}
            type="button"
            onClick={() => setChosen(line.id)}
            aria-pressed={chosen === line.id}
            className={chip(chosen === line.id)}
          >
            {line.name}
          </button>
        ))}
      </div>

      {reasons.length === 0 ? (
        <p className="mt-4 rounded-md border border-stone-200 px-3 py-6 text-center text-sm text-stone-600">
          {chosen === 'all' ? 'Nothing stopped the floor this week.' : 'Nothing stopped this line this week.'}
        </p>
      ) : (
        <ul className="mt-4 space-y-1.5">
          <li className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-stone-400">
            <span className="w-40 shrink-0">Reason</span>
            <span className="flex-1">minutes lost</span>
            <span className="w-12 text-right">min</span>
            <span className="w-12 text-right">stops</span>
          </li>
          {reasons.map((reason) => (
            <li key={reason.key} className="flex items-center gap-3 text-sm">
              <span className="w-40 shrink-0 truncate text-stone-700">{reason.key}</span>
              <span className="flex-1">
                <ReasonBar value={reason.minutes} of={top} />
              </span>
              <span className="w-12 text-right tabular-nums text-stone-900">{reason.minutes}</span>
              <span className="w-12 text-right tabular-nums text-stone-500">{reason.stops}</span>
            </li>
          ))}
        </ul>
      )}

      {worst && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900">
          <span className="font-medium">Worst machine:</span> the {worst.key.toLowerCase()} on {worst.lineName}{' '}
          lost {worst.minutes} minutes over {worst.stops} {worst.stops === 1 ? 'stop' : 'stops'},{' '}
          {worst.oneReason ? 'every one of them' : 'most of it'} {worst.topReason.toLowerCase()}.
        </p>
      )}

      <Machines
        machines={machines}
        checks={checks}
        onSchedule={onSchedule}
        booking={booking}
        note={note}
      />
    </section>
  );
}
