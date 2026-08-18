/**
 * The stuck list: every order that was paid for more than two days ago and is still
 * here, gathered under the reason it is here for.
 *
 * One table, one `tbody` per reason, biggest reason first. Grouping in the markup
 * rather than behind a filter is deliberate - the desk wants all of it in one look, and
 * then to decide where to start.
 */

import { money, plural, shortDate } from '../lib/format';
import type { Order, ReasonGroup, StockItem } from '../lib/records';
import { Chip } from './ui';

/** What this order is actually waiting for, in one plain line. */
function heldDetail(order: Order, stock: StockItem[]): string {
  if (order.reason !== 'Waiting on stock') return 'Still waiting';
  const item = stock.find((entry) => entry.item === order.waitingFor);
  if (!item) return order.waitingFor;
  if (item.onHand > 0) return `${item.item} - ${item.onHand} on the shelf`;
  if (item.onTheWay > 0) return `${item.item} - ${item.onTheWay} due ${shortDate(item.dueDate)}`;
  return `${item.item} - none on the shelf, none on the way`;
}

export function StuckOrders({ groups, stock }: { groups: ReasonGroup[]; stock: StockItem[] }) {
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
          </tr>
        </thead>

        {groups.map((group) => (
          <tbody key={group.reason} className="divide-y divide-stone-100">
            <tr className="bg-stone-50">
              <th colSpan={2} scope="colgroup" className="px-3 py-2 text-left text-xs font-semibold text-stone-700">
                {group.reason}
              </th>
              <td colSpan={3} className="px-3 py-2 text-right text-xs tabular-nums text-stone-500">
                {plural(group.orders.length, 'order')}, {money(group.value)}
              </td>
            </tr>

            {group.orders.map((order) => (
              <tr key={order.id}>
                <td className="px-3 py-2 font-medium tabular-nums text-stone-900">{order.id}</td>
                <td className="px-3 py-2 text-stone-700">{order.customer}</td>
                <td className="px-3 py-2 text-right tabular-nums text-stone-700">
                  {plural(order.daysWaiting, 'day')}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-stone-900">{money(order.value)}</td>
                <td className="px-3 py-2 text-stone-600">
                  {order.clearedDate ? (
                    <Chip tone="done">{`Cleared ${shortDate(order.clearedDate)}`}</Chip>
                  ) : (
                    heldDetail(order, stock)
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
