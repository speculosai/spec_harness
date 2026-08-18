/**
 * Bluebell Goods, operations desk: what is stuck going out, what is coming back, and
 * the two decisions this screen can make on the spot.
 *
 * Nothing is patched locally after an action. `act()` sends the decision and then reads
 * all three tables again, so the counts, the chips and the buttons afterwards are what
 * the records say - not what the browser assumed happened.
 *
 * Three states, and only ever one of them on screen: reading, read, or could not be
 * read. A read that fails replaces the panels rather than sitting above them, so the
 * page never shows gray bars for rows that are not coming.
 */

import { useCallback, useEffect, useState } from 'react';

import { RefundQueue, ReturnReasons } from './components/Returns';
import { StuckOrders } from './components/StuckOrders';
import { Panel, ReadFailed, SkeletonRows } from './components/ui';
import { call, query } from './lib/data';
import { money, plural } from './lib/format';
import {
  countReasons,
  groupByReason,
  isHeldUp,
  isReadyToGo,
  isStillStuck,
  isWaiting,
  refundQueue,
  totalAmount,
  totalValue,
} from './lib/records';
import type { Order, ReturnRow, StockItem } from './lib/records';

/** The line the page shows back after a decision. */
interface Note {
  text: string;
  ok: boolean;
}

export function App() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [returns, setReturns] = useState<ReturnRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);

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

  const act = useCallback(
    async (name: string, id: string, done: string) => {
      setBusy(id);
      const answer = await call<{ ok?: boolean; message?: string }>(name, { id });
      setBusy(null);
      if (answer.error) {
        setNote({ text: `That did not go through. ${answer.error}`, ok: false });
        return;
      }
      if (answer.result && answer.result.ok === false) {
        setNote({ text: answer.result.message ?? 'That could not be done.', ok: false });
        return;
      }
      setNote({ text: done, ok: true });
      await load();
    },
    [load],
  );

  const stuck = (orders ?? []).filter(isStillStuck);
  const ready = (orders ?? []).filter(isReadyToGo);
  const value = totalValue(stuck);
  const waiting = (returns ?? []).filter(isWaiting);
  const owed = totalAmount(waiting);

  const summary = error
    ? 'No figures until the records can be read.'
    : orders === null || returns === null
      ? 'Reading the order and return records.'
      : `${stuck.length} of ${orders.length} orders are stuck going out, ${money(value)} between them, ` +
        `and ${ready.length} of those are only waiting for someone to say go. ` +
        `${plural(waiting.length, 'refund')} are waiting to be approved, ${money(owed)}.`;

  return (
    <main className="min-h-screen bg-stone-50 px-6 py-8 text-stone-900">
      <div className="mx-auto max-w-4xl">
        <p className="text-xs font-medium uppercase tracking-widest text-indigo-700">Bluebell Goods</p>
        <h1 className="mt-1 text-lg font-semibold">Keeping orders moving</h1>
        <p className="mt-1 text-sm text-stone-600">{summary}</p>

        {note ? (
          <p
            role="status"
            className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
              note.ok ? 'border-indigo-200 bg-indigo-50 text-indigo-800' : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
          >
            {note.text}
          </p>
        ) : null}

        {error ? (
          <div className="mt-4">
            <ReadFailed what="records" detail={error} onRetry={() => void load()} />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <Panel title="Held up, and why" note={orders === null ? undefined : `${money(value)} still waiting`}>
              {orders === null ? (
                <SkeletonRows rows={6} />
              ) : (
                <StuckOrders
                  groups={groupByReason(orders.filter(isHeldUp))}
                  stock={stock}
                  busyId={busy}
                  onRelease={(order) => void act('release_order', order.id, `Order ${order.id} released.`)}
                />
              )}
            </Panel>

            <Panel
              title="Why things come back"
              note={returns === null ? undefined : `${returns.length} returns in the last two weeks`}
            >
              {returns === null ? <SkeletonRows rows={5} /> : <ReturnReasons counts={countReasons(returns)} />}
            </Panel>

            <Panel title="Refunds waiting" note={returns === null ? undefined : `${money(owed)} not approved yet`}>
              {returns === null ? (
                <SkeletonRows rows={5} />
              ) : (
                <RefundQueue
                  entries={refundQueue(returns)}
                  busyId={busy}
                  onApprove={(entry) => void act('approve_refund', entry.id, `Refund ${entry.id} approved.`)}
                />
              )}
            </Panel>
          </div>
        )}
      </div>
    </main>
  );
}
