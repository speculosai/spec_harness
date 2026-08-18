/**
 * One column of the board: a heading, a one-line summary, and the rows grouped under
 * the building they belong to.
 *
 * It knows nothing about rent or repairs - the rules in `lib/attention.ts` decide what
 * an entry says, this decides how it looks. Adding a fourth column is a fourth call to
 * this component.
 */

import type { AttentionEntry, Tone } from '../lib/attention';

/** Color carries urgency, and the wording repeats it - color alone is not a label. */
const TONE_CLASS: Record<Tone, string> = {
  urgent: 'bg-red-50 text-red-700 ring-red-200',
  soon: 'bg-amber-50 text-amber-800 ring-amber-200',
  steady: 'bg-stone-100 text-stone-600 ring-stone-200',
};

/** Props for {@link AttentionColumn}. */
export interface AttentionColumnProps {
  /** The plain-words question this column answers. */
  heading: string;
  /** The count and the total, in one line. */
  summary: string;
  /** The rows, already in the order the rule put them. */
  entries: AttentionEntry[];
  /** What to say when there is nothing to do - good news, said plainly. */
  empty: string;
}

/** Group entries by building, keeping the order the rule sorted them into. */
function byBuilding(entries: AttentionEntry[]): Array<[string, AttentionEntry[]]> {
  const groups = new Map<string, AttentionEntry[]>();
  for (const entry of entries) {
    const existing = groups.get(entry.building);
    if (existing) existing.push(entry);
    else groups.set(entry.building, [entry]);
  }
  return [...groups];
}

export function AttentionColumn({ heading, summary, entries, empty }: AttentionColumnProps) {
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-stone-200 bg-white">
      <header className="border-b border-stone-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-stone-900">{heading}</h2>
        <p className="mt-0.5 text-xs text-stone-500">{summary}</p>
      </header>

      {entries.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-stone-500">{empty}</p>
      ) : (
        <div className="divide-y divide-stone-100">
          {byBuilding(entries).map(([building, rows]) => (
            <div key={building} className="px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
                {building} · {rows.length}
              </p>
              <ul className="mt-2 space-y-2.5">
                {rows.map((entry) => (
                  <li key={entry.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-900">
                        {entry.place}
                        {entry.person ? <span className="text-stone-500"> · {entry.person}</span> : null}
                      </p>
                      <p className="mt-0.5 text-xs leading-snug text-stone-500">{entry.note}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs tabular-nums ring-1 ring-inset ${TONE_CLASS[entry.tone]}`}
                    >
                      {entry.headline}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
