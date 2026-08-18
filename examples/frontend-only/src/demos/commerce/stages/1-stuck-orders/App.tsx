/**
 * Bluebell Goods, operations desk: the orders that were paid for and never went out.
 *
 * Both tables on screen - orders and stock - are read over the bridge at load time, so
 * the page is never a copy of yesterday. The skeleton paints on the first frame and the
 * rows replace it one message later.
 *
 * Three states, and only ever one of them on screen: reading, read, or could not be
 * read. A read that fails replaces the panel rather than sitting above it, so the page
 * never shows gray bars for rows that are not coming.
 */

import { useCallback, useEffect, useState } from 'react';

import { StuckOrders } from './components/StuckOrders';
import { Panel, ReadFailed, SkeletonRows } from './components/ui';
import { query } from './lib/data';
import { money, plural } from './lib/format';
import { groupByReason, isHeldUp, totalValue } from './lib/records';
import type { Order, StockItem } from './lib/records';

export function App() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [orderRows, stockRows] = await Promise.all([query<Order>('orders'), query<StockItem>('stock')]);
    const failed = orderRows.error ?? stockRows.error;
    if (failed) {
      setError(failed);
      return;
    }
    setOrders(orderRows.rows);
    setStock(stockRows.rows);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const held = (orders ?? []).filter(isHeldUp);
  const value = totalValue(held);
  const oldest = held.reduce((longest, order) => Math.max(longest, order.daysWaiting), 0);

  const summary = error
    ? 'No figures until the records can be read.'
    : orders === null
      ? 'Reading the order records.'
      : `${held.length} of ${orders.length} orders have been waiting more than two days to go out, ` +
        `${money(value)} between them. The oldest has been here ${plural(oldest, 'day')}.`;

  return (
    <main className="min-h-screen bg-stone-50 px-6 py-8 text-stone-900">
      <div className="mx-auto max-w-4xl">
        <p className="text-xs font-medium uppercase tracking-widest text-indigo-700">Bluebell Goods</p>
        <h1 className="mt-1 text-lg font-semibold">Orders that are stuck</h1>
        <p className="mt-1 text-sm text-stone-600">{summary}</p>

        <div className="mt-4">
          {error ? (
            <ReadFailed what="order records" detail={error} onRetry={() => void load()} />
          ) : (
            <Panel title="Held up, and why" note={orders === null ? undefined : `${money(value)} waiting`}>
              {orders === null ? (
                <SkeletonRows rows={6} />
              ) : (
                <StuckOrders groups={groupByReason(held)} stock={stock} />
              )}
            </Panel>
          )}
        </div>
      </div>
    </main>
  );
}
