/**
 * Bluebell Goods, operations desk: what is stuck going out, and what is coming back.
 *
 * Three tables are read over the bridge at load time - orders, stock and returns - and
 * every figure on screen is counted from those rows. The skeletons paint on the first
 * frame; the rows replace them one message later.
 *
 * Three states, and only ever one of them on screen: reading, read, or could not be
 * read. A read that fails replaces the panels rather than sitting above them, so the
 * page never shows gray bars for rows that are not coming.
 */

import { useCallback, useEffect, useState } from 'react';

import { RefundQueue, ReturnReasons } from './components/Returns';
import { StuckOrders } from './components/StuckOrders';
import { Panel, ReadFailed, SkeletonRows } from './components/ui';
import { query } from './lib/data';
import { money, plural } from './lib/format';
import { countReasons, groupByReason, isHeldUp, isWaiting, refundQueue, totalAmount, totalValue } from './lib/records';
import type { Order, ReturnRow, StockItem } from './lib/records';

export function App() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [returns, setReturns] = useState<ReturnRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [orderRows, stockRows, returnRows] = await Promise.all([
      query<Order>('orders'),
      query<StockItem>('stock'),
      query<ReturnRow>('returns'),
    ]);
    const failed = orderRows.error ?? stockRows.error ?? returnRows.error;
    if (failed) {
      setError(failed);
      return;
    }
    setOrders(orderRows.rows);
    setStock(stockRows.rows);
    setReturns(returnRows.rows);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const held = (orders ?? []).filter(isHeldUp);
  const value = totalValue(held);
  const waiting = (returns ?? []).filter(isWaiting);
  const owed = totalAmount(waiting);

  const summary = error
    ? 'No figures until the records can be read.'
    : orders === null || returns === null
      ? 'Reading the order and return records.'
      : `${held.length} of ${orders.length} orders are stuck going out, ${money(value)} between them. ` +
        `${plural(waiting.length, 'refund')} are waiting to be approved, ${money(owed)}.`;

  return (
    <main className="min-h-screen bg-stone-50 px-6 py-8 text-stone-900">
      <div className="mx-auto max-w-4xl">
        <p className="text-xs font-medium uppercase tracking-widest text-indigo-700">Bluebell Goods</p>
        <h1 className="mt-1 text-lg font-semibold">Keeping orders moving</h1>
        <p className="mt-1 text-sm text-stone-600">{summary}</p>

        {error ? (
          <div className="mt-4">
            <ReadFailed what="records" detail={error} onRetry={() => void load()} />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <Panel title="Held up, and why" note={orders === null ? undefined : `${money(value)} waiting`}>
              {orders === null ? (
                <SkeletonRows rows={6} />
              ) : (
                <StuckOrders groups={groupByReason(held)} stock={stock} />
              )}
            </Panel>

            <Panel
              title="Why things come back"
              note={returns === null ? undefined : `${returns.length} returns in the last two weeks`}
            >
              {returns === null ? <SkeletonRows rows={5} /> : <ReturnReasons counts={countReasons(returns)} />}
            </Panel>

            <Panel title="Refunds waiting" note={returns === null ? undefined : `${money(owed)} not approved yet`}>
              {returns === null ? <SkeletonRows rows={5} /> : <RefundQueue entries={refundQueue(returns)} />}
            </Panel>
          </div>
        )}
      </div>
    </main>
  );
}
