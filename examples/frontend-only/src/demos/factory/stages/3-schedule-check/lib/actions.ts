/**
 * The one thing this page can do besides read: book a check on a machine.
 *
 * Kept out of the page so the board stays a board. A booking has three endings worth
 * telling apart - it went on the schedule, it was already there, or it was refused - and
 * none of them is the records failing to read, so none of them touches the page's read
 * error. The records are re-read only when something actually changed.
 */

import { useCallback, useState } from 'react';

import { call } from './data';
import { dayLabel } from './rows';

/** The line the page shows back after a booking, and whether it went through. */
export interface Note {
  text: string;
  ok: boolean;
}

/** What the `schedule_check` action answers with. */
interface Booked {
  /** False when the machine is not one the records know about. */
  ok?: boolean;
  /** The day the check is on the schedule for. */
  day?: string;
  /** True when a check was already booked and this one changed nothing. */
  alreadyPlanned?: boolean;
  /** Why it was refused, when it was. */
  message?: string;
}

/** What {@link useScheduler} hands the page. */
export interface Scheduler {
  /** The machine whose check is being booked right now, if any. */
  booking: string | null;
  /** What just happened, in one line. */
  note: Note | null;
  /** Book a check on one machine. */
  schedule: (machine: string) => void;
}

/**
 * Book a check, then re-read.
 *
 * `reload` is handed in rather than done here, so what the page draws afterward comes
 * from the records rather than from anything patched in on the way past.
 */
export function useScheduler(reload: () => Promise<void>): Scheduler {
  const [booking, setBooking] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);

  const book = useCallback(
    async (machine: string) => {
      setBooking(machine);
      const answer = await call<Booked>('schedule_check', { machine });
      setBooking(null);
      if (answer.error) {
        setNote({ text: `The check could not be booked. ${answer.error}`, ok: false });
        return;
      }
      const booked = answer.result;
      if (booked?.ok === false) {
        setNote({ text: booked.message ?? 'That check could not be booked.', ok: false });
        return;
      }
      const name = machine.toLowerCase();
      const when = booked?.day ? ` for ${dayLabel(booked.day)}` : '';
      setNote({
        text: booked?.alreadyPlanned
          ? `The ${name} already has a check booked${when}.`
          : `Check booked on the ${name}${when}.`,
        ok: true,
      });
      // Re-read rather than patch: the row that flips is drawn from the records.
      await reload();
    },
    [reload],
  );

  const schedule = useCallback((machine: string) => void book(machine), [book]);

  return { booking, note, schedule };
}
