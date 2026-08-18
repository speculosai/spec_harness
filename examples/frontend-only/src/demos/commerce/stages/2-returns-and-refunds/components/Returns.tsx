/**
 * The returns side of the desk: why things come back, and who is still owed money.
 *
 * The bars are hand-drawn SVG rather than a chart library - five reasons need five
 * rectangles, and a viewBox keeps them legible at any width. Both views are counted
 * from the same return records, so they can never tell different stories.
 */

import { money, plural } from '../lib/format';
import type { ReasonCount, ReturnRow } from '../lib/records';
import { Chip } from './ui';

/** Bar geometry, in viewBox units. */
const LABEL_WIDTH = 168;
const BAR_LEFT = LABEL_WIDTH + 8;
const BAR_RIGHT = 452;
const ROW_HEIGHT = 28;
const BAR_HEIGHT = 14;

/** Stone and indigo, matched to the Tailwind classes used everywhere else. */
const INK = '#1c1917';
const MUTED = '#57534e';
const TRACK = '#f5f5f4';
/** The one accent on this page - the same indigo as the heading above it. */
const BAR = '#4338ca';

export function ReturnReasons({ counts }: { counts: ReasonCount[] }) {
  if (!counts.length) {
    return <p className="py-4 text-center text-sm text-stone-600">Nothing has come back in the last two weeks.</p>;
  }

  const most = counts[0].count;
  const height = counts.length * ROW_HEIGHT;
  const summary = counts.map((row) => `${row.reason}, ${row.count}`).join('; ');

  return (
    <svg
      viewBox={`0 0 480 ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label={`Reasons things came back, most common first: ${summary}`}
    >
      {counts.map((row, index) => {
        const middle = index * ROW_HEIGHT + ROW_HEIGHT / 2;
        const width = Math.max(2, ((BAR_RIGHT - BAR_LEFT) * row.count) / most);
        return (
          <g key={row.reason}>
            <text x={LABEL_WIDTH} y={middle + 4} textAnchor="end" fontSize="12" fill={MUTED}>
              {row.reason}
            </text>
            <rect
              x={BAR_LEFT}
              y={middle - BAR_HEIGHT / 2}
              width={BAR_RIGHT - BAR_LEFT}
              height={BAR_HEIGHT}
              rx="3"
              fill={TRACK}
            />
            <rect x={BAR_LEFT} y={middle - BAR_HEIGHT / 2} width={width} height={BAR_HEIGHT} rx="3" fill={BAR} />
            <text x={BAR_RIGHT + 8} y={middle + 4} fontSize="12" fontWeight="500" fill={INK}>
              {row.count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function RefundQueue({ entries }: { entries: ReturnRow[] }) {
  if (!entries.length) {
    return <p className="py-4 text-center text-sm text-stone-600">Every refund has been paid back.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
            <th className="px-3 pb-2 font-medium">Return</th>
            <th className="px-3 pb-2 font-medium">Item</th>
            <th className="px-3 pb-2 font-medium">Why</th>
            <th className="px-3 pb-2 text-right font-medium">Waiting</th>
            <th className="px-3 pb-2 text-right font-medium">Refund</th>
            <th className="px-3 pb-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="px-3 py-2 font-medium tabular-nums text-stone-900">{entry.id}</td>
              <td className="px-3 py-2 text-stone-700">{entry.item}</td>
              <td className="px-3 py-2 text-stone-600">{entry.reason}</td>
              <td className="px-3 py-2 text-right tabular-nums text-stone-700">
                {plural(entry.daysWaiting, 'day')}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-stone-900">{money(entry.amount)}</td>
              <td className="px-3 py-2">
                <Chip tone={entry.refundStatus === 'Waiting' ? 'waiting' : 'done'}>{entry.refundStatus}</Chip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
