/**
 * The small shared pieces every section on this page is built from: the card, the gray
 * bars it shows while its rows are on their way, the panel that takes their place when
 * the records will not come, and the chip that marks a row's state.
 *
 * The skeleton matters more than it looks. The preview treats an app that paints
 * nothing for a second and a half as broken, and the records arrive one message after
 * the first frame - so the page draws its own outline first and fills it in after.
 */

import type { ReactNode } from 'react';

/** A titled card. `note` is the small figure on the right of the heading. */
export function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white">
      <header className="flex items-baseline justify-between gap-3 border-b border-stone-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
        {note ? <p className="text-xs tabular-nums text-stone-500">{note}</p> : null}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

/** Placeholder bars, shown inside a panel until its rows arrive. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="h-8 rounded bg-stone-100" />
      ))}
    </div>
  );
}

/**
 * What the page shows in place of its panels when the records cannot be read.
 *
 * The skeleton has to give way to this. Gray placeholder bars sitting under an error
 * message read as "the rows are still on their way", and they are not - so the page
 * says what happened and offers the one thing worth doing about it.
 */
export function ReadFailed({ what, detail, onRetry }: { what: string; detail: string; onRetry: () => void }) {
  return (
    <section className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
      <h2 className="text-sm font-medium text-red-800">
        The {what} could not be read. {detail}
      </h2>
      <p className="mt-1 text-sm text-red-700">The page fills in again as soon as they can be.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      >
        Try again
      </button>
    </section>
  );
}

/** A row's state in two words. Amber is a job to do; indigo is done. */
export function Chip({ tone, children }: { tone: 'done' | 'waiting'; children: string }) {
  const style =
    tone === 'done' ? 'bg-indigo-50 text-indigo-800 ring-indigo-200' : 'bg-amber-50 text-amber-800 ring-amber-200';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${style}`}>{children}</span>
  );
}
