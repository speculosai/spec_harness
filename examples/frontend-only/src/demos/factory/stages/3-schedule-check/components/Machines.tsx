/**
 * The machines behind the week's stops, and the button that books a check on one.
 *
 * This is the part of the tool that writes rather than reads: the button hands the
 * machine name to the `schedule_check` action, and the row it books shows up in the
 * planned checks list below - because the whole panel is redrawn from a fresh read of
 * the records, not from anything held here.
 */

import type { Note } from '../lib/actions';
import { dayLabel } from '../lib/rows';
import type { Check } from '../lib/rows';
import type { MachineTotal } from '../lib/summary';

/** Props for {@link Machines}. */
export interface MachinesProps {
  /** The machines that stopped this week, worst first. */
  machines: MachineTotal[];
  /** Every check on the schedule, planned and done. */
  checks: Check[];
  /** Book a check on one machine. */
  onSchedule: (machine: string) => void;
  /** The machine whose check is being booked right now, if any. */
  booking: string | null;
  /** What just happened, in one line, and whether it went through. */
  note: Note | null;
}

export function Machines({ machines, checks, onSchedule, booking, note }: MachinesProps) {
  const planned = checks
    .filter((check) => check.status === 'Planned')
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  /** The check already on the schedule for a machine, if there is one. */
  const plannedFor = (machine: string): Check | undefined =>
    planned.find((check) => check.machine === machine);

  return (
    <div className="mt-5 border-t border-stone-100 pt-4">
      <h3 className="text-sm font-semibold text-stone-900">Machines behind those stops</h3>
      <p className="mt-0.5 text-xs text-stone-500">Book a check and it goes on the list below.</p>

      {note && (
        <p
          role="status"
          className={`mt-3 rounded-md border px-3 py-2 text-sm ${
            note.ok ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {note.text}
        </p>
      )}

      <ul className="mt-3 divide-y divide-stone-100">
        {machines.map((machine) => {
          const booked = plannedFor(machine.key);
          return (
            <li key={machine.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
              <div className="min-w-0">
                <p className="text-sm text-stone-800">
                  {machine.key}
                  <span className="text-stone-400"> - {machine.lineName}</span>
                </p>
                <p className="text-xs tabular-nums text-stone-500">
                  {machine.minutes} minutes over {machine.stops} {machine.stops === 1 ? 'stop' : 'stops'}
                </p>
              </div>
              {booked ? (
                <span className="rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-stone-600">
                  Check booked - {dayLabel(booked.day)}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onSchedule(machine.key)}
                  disabled={booking === machine.key}
                  className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 disabled:border-stone-200 disabled:bg-stone-50 disabled:text-stone-400"
                >
                  {booking === machine.key ? 'Booking' : 'Schedule a check'}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-4 rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
        <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Planned checks</p>
        {planned.length === 0 ? (
          <p className="mt-1 text-sm text-stone-600">Nothing booked yet.</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {planned.map((check) => (
              <li key={check.id} className="flex items-baseline justify-between gap-3 text-sm text-stone-700">
                <span>{check.machine}</span>
                <span className="tabular-nums text-stone-500">{dayLabel(check.day)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
