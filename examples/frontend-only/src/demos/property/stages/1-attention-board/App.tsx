/**
 * The attention board: the three things that go wrong with a rented place, side by
 * side, grouped by building.
 *
 * The page owns the reading and nothing else. What counts as "behind", "ending soon"
 * or "waiting too long" is in `lib/attention.ts`; how a row looks is in
 * `components/AttentionColumn.tsx`.
 */

import { useCallback, useEffect, useState } from 'react';

import { AttentionColumn } from './components/AttentionColumn';
import {
  agreementsEnding,
  behindOnPayment,
  ENDING_WITHIN_DAYS,
  repairsWaiting,
  WAITING_LONGER_THAN_DAYS,
} from './lib/attention';
import { isBehind, readRecords } from './lib/data';
import type { Records } from './lib/data';
import { countOf, money, TODAY_LABEL } from './lib/format';

/** What the page holds when a read fails, so nothing is left waiting on records. */
const NOTHING_READ: Records = { units: [], payments: [], agreements: [], repairs: [] };

/** Painted on the first frame, before the records arrive. */
function Skeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3" aria-hidden="true">
      {[0, 1, 2].map((column) => (
        <div key={column} className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="h-3 w-32 rounded bg-stone-200" />
          <div className="mt-2 h-2 w-24 rounded bg-stone-100" />
          <div className="mt-5 space-y-3">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="h-8 rounded bg-stone-100" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Shown in place of the board when the records did not come back. */
function CouldNotRead({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  return (
    <section className="rounded-lg border border-red-200 bg-red-50 px-4 py-10 text-center">
      <h2 className="text-sm font-semibold text-red-800">Your records could not be read.</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-red-700">
        {reason} The board stays empty rather than showing half a picture.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100"
      >
        Try again
      </button>
    </section>
  );
}

/** The line under the heading: what was read, or why nothing was. */
function summaryLine(records: Records | null, error: string | null): string {
  if (error) return 'Nothing could be read just now.';
  if (records === null) return 'Reading your records.';
  const rented = records.units.filter((unit) => unit.status === 'Rented out').length;
  return `${countOf(records.units.length, 'place', 'places')}, ${rented} rented out. Records read at ${TODAY_LABEL}.`;
}

export function App() {
  const [records, setRecords] = useState<Records | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const answer = await readRecords();
    setError(answer.error ?? null);
    setRecords(answer.error ? NOTHING_READ : answer.records);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const behind = records ? behindOnPayment(records) : [];
  const ending = records ? agreementsEnding(records) : [];
  const waiting = records ? repairsWaiting(records) : [];
  const owed = records ? records.payments.filter(isBehind).reduce((total, p) => total + p.amountDue, 0) : 0;

  return (
    <main className="min-h-screen bg-stone-50 px-5 py-7 text-stone-900">
      <div className="mx-auto max-w-6xl">
        <header>
          <p className="text-xs font-medium uppercase tracking-widest text-emerald-700">
            Northwind Property Group
          </p>
          <h1 className="mt-1 text-lg font-semibold">What needs attention</h1>
          <p className="mt-1 text-sm text-stone-600">{summaryLine(records, error)}</p>
        </header>

        <div className="mt-5">
          {records === null ? (
            <Skeleton />
          ) : error ? (
            <CouldNotRead reason={error} onRetry={() => void load()} />
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <AttentionColumn
                heading="Behind on payment"
                summary={`${countOf(behind.length, 'place', 'places')} · ${money(owed)} owed`}
                entries={behind}
                empty="Everyone is up to date this month."
              />
              <AttentionColumn
                heading="Agreement ending soon"
                summary={`${countOf(ending.length, 'agreement', 'agreements')} · within ${ENDING_WITHIN_DAYS} days`}
                entries={ending}
                empty={`No agreement ends in the next ${ENDING_WITHIN_DAYS} days.`}
              />
              <AttentionColumn
                heading="Repairs waiting too long"
                summary={`${countOf(waiting.length, 'repair', 'repairs')} · open more than ${WAITING_LONGER_THAN_DAYS} days`}
                entries={waiting}
                empty="Nothing has been waiting more than a week."
              />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
