/**
 * The floor board: today line by line, and the week ranked by what the stops cost.
 *
 * All three tables are read over the bridge in one go, and the newest day in the output
 * records is what the app calls today - nothing here reads the clock, so the board says
 * the same thing whenever it is opened.
 */

import { useCallback, useEffect, useState } from 'react';

import { LineToday } from './components/LineToday';
import { WeekPanel } from './components/WeekPanel';
import { query } from './lib/data';
import { dayLabel, latestDay, weekStartOf } from './lib/rows';
import type { Line, Output, Stop } from './lib/rows';
import { stopsInWeek } from './lib/summary';

/** Everything the board draws, once all three tables are in. */
interface Board {
  day: string;
  lines: Line[];
  output: Output[];
  stops: Stop[];
}

/** Painted on the first frame, while the rows are still on their way. */
function Skeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-40 rounded-lg border border-stone-200 bg-white" />
      ))}
    </div>
  );
}

/** Drawn instead of the skeleton when the read failed and there is nothing to show. */
function ReadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-8 text-center">
      <p className="text-sm text-stone-600">Nothing to draw until the records come back.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
      >
        Try again
      </button>
    </div>
  );
}

export function App() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [lines, output, stops] = await Promise.all([
      query<Line>('lines'),
      query<Output>('output'),
      query<Stop>('stops'),
    ]);
    const failed = lines.error ?? output.error ?? stops.error;
    if (failed) {
      setError(failed);
      return;
    }
    setError(null);
    setBoard({
      day: latestDay(output.rows),
      lines: lines.rows,
      output: output.rows,
      stops: stops.rows,
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Clear the failure first, so a retry paints the skeleton again while it reads. */
  const retry = useCallback(() => {
    setError(null);
    void load();
  }, [load]);

  const today = board?.output.filter((row) => row.day === board.day) ?? [];
  const made = today.reduce((total, row) => total + row.made, 0);
  const planned = today.reduce((total, row) => total + row.planned, 0);
  const weekStart = board ? weekStartOf(board.day) : '';
  const count = board?.lines.length ?? 0;
  /** A read that failed with nothing already on screen: there is no board to draw at all. */
  const nothingToShow = error !== null && board === null;

  return (
    <main className="min-h-screen bg-stone-50 px-6 py-8 text-stone-900">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-widest text-amber-700">Ashford Works</p>
        <h1 className="mt-1 text-lg font-semibold">The floor, today and this week</h1>
        {!nothingToShow && (
          <p className="mt-1 text-sm text-stone-600">
            {board === null
              ? 'Reading the day.'
              : `${dayLabel(board.day)} - ${made} of ${planned} pieces made across ${count} ${count === 1 ? 'line' : 'lines'}.`}
          </p>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            The records could not be read. {error}
          </p>
        )}

        <h2 className="mt-6 text-xs font-medium uppercase tracking-wide text-stone-500">Today, line by line</h2>
        <div className="mt-2 space-y-3">
          {nothingToShow ? (
            <ReadFailed onRetry={retry} />
          ) : board === null ? (
            <Skeleton />
          ) : board.lines.length === 0 ? (
            <p className="rounded-lg border border-stone-200 bg-white px-4 py-6 text-center text-sm text-stone-600">
              No lines are set up yet.
            </p>
          ) : (
            board.lines.map((line) => {
              const day = board.output.find((row) => row.line === line.id && row.day === board.day);
              return (
                <LineToday
                  key={line.id}
                  line={line}
                  made={day?.made ?? 0}
                  planned={day?.planned ?? 0}
                  stops={board.stops.filter((stop) => stop.line === line.id && stop.day === board.day)}
                />
              );
            })
          )}
        </div>

        {board !== null && (
          <div className="mt-6">
            <WeekPanel
              lines={board.lines}
              stops={stopsInWeek(board.stops, weekStart)}
              weekStart={weekStart}
              today={board.day}
            />
          </div>
        )}
      </div>
    </main>
  );
}
