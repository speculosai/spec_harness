/**
 * The stuck list: every order that was paid for more than two days ago and is still
 * here, gathered under the reason it is here for.
 *
 * One table, one `tbody` per reason, biggest reason first. Grouping in the markup
 * rather than behind a filter is deliberate - the desk wants all of it in one look, and
 * then to decide where to start.
 *
 * The last column is the part that writes back: an order whose problem has already been
 * cleared gets a Release button, and pressing it changes the order record itself.
 *
 * A released order stays in its group - it has not physically left the building yet -
 * but it drops out of the subtotal beside the reason, which counts only what is still
 * waiting. That is the same figure the card heading shows, so the two always agree.
 */

import { money, plural, shortDate } from '../lib/format';
import { isReadyToGo } from '../lib/records';
import type { Order, ReasonGroup, StockItem } from '../lib/records';
import { ActionButton, Chip } from './ui';

/** What this order is actually waiting for, in one plain line. */
function heldDetail(order: Order, stock: StockItem[]): string {
  if (order.reason !== 'Waiting on stock') return 'Still waiting';
  const item = stock.find((entry) => entry.item === order.waitingFor);
  if (!item) return order.waitingFor;
  if (item.onHand > 0) return `${item.item} - ${item.onHand} on the shelf`;
  if (item.onTheWay > 0) return `${item.item} - ${item.onTheWay} due ${shortDate(item.dueDate)}`;
  return `${item.item} - none on the shelf, none on the way`;
}

export function StuckOrders({
  groups,
  stock,
  busyId,
  onRelease,
}: {
  groups: ReasonGroup[];
  stock: StockItem[];
  busyId: string | null;
  onRelease: (order: Order) => void;
}) {
  if (!groups.length) {
    return (
      <p className="py-4 text-center text-sm text-stone-600">
        Nothing is stuck. Everything paid for more than two days ago has gone out.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
            <th className="px-3 pb-2 font-medium">Order</th>
            <th className="px-3 pb-2 font-medium">Customer</th>
            <th className="px-3 pb-2 text-right font-medium">Waiting</th>
            <th className="px-3 pb-2 text-right font-medium">Value</th>
            <th className="px-3 pb-2 font-medium">Where it stands</th>
            <th className="px-3 pb-2 text-right font-medium">Action</th>
          </tr>
        </thead>

        {groups.map((group) => (
          <tbody key={group.reason} className="divide-y divide-stone-100">
            <tr className="bg-stone-50">
              <th colSpan={2} scope="colgroup" className="px-3 py-2 text-left text-xs font-semibold text-stone-700">
                {group.reason}
              </th>
              <td colSpan={4} className="px-3 py-2 text-right text-xs tabular-nums text-stone-500">
                {plural(group.stuck.length, 'order')} still waiting, {money(group.value)}
                {group.orders.length > group.stuck.length
                  ? ` · ${group.orders.length - group.stuck.length} released`
                  : ''}
              </td>
            </tr>

            {group.orders.map((order) => (
              <tr key={order.id} className={order.status === 'Released' ? 'bg-indigo-50/50' : undefined}>
                <td className="px-3 py-2 font-medium tabular-nums text-stone-900">{order.id}</td>
                <td className="px-3 py-2 text-stone-700">{order.customer}</td>
                <td className="px-3 py-2 text-right tabular-nums text-stone-700">
                  {plural(order.daysWaiting, 'day')}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-stone-900">{money(order.value)}</td>
                <td className="px-3 py-2 text-stone-600">
                  {order.status === 'Released' ? (
                    <Chip tone="done">Released</Chip>
                  ) : order.clearedDate ? (
                    <Chip tone="done">{`Cleared ${shortDate(order.clearedDate)}`}</Chip>
                  ) : (
                    heldDetail(order, stock)
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {order.status === 'Released' ? (
                    <span className="text-xs text-stone-500">Going out today</span>
                  ) : isReadyToGo(order) ? (
                    <ActionButton busy={busyId === order.id} onClick={() => onRelease(order)}>
                      Release
                    </ActionButton>
                  ) : (
                    <span className="text-xs text-stone-400">Not yet</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
