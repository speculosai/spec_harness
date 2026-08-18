/**
 * What the records mean: the row shapes that come off the bridge, and the handful of
 * rules this desk reads them by.
 *
 * The important rule is what counts as stuck. Two days is normal picking time at
 * Bluebell, so an order paid for more than two days ago that is still in the building
 * is a question somebody has to answer. Keeping that in one place means the heading,
 * the groups and the totals can never disagree about it.
 */

/** One customer order. */
export interface Order {
  id: string;
  customer: string;
  items: number;
  value: number;
  paidDate: string;
  status: string;
  reason: string;
  waitingFor: string;
  clearedDate: string;
  daysWaiting: number;
}

/** One item on the shelves. */
export interface StockItem {
  item: string;
  onHand: number;
  onTheWay: number;
  dueDate: string;
}

/** Normal picking time, in days. Older than this and the order is worth a look. */
export const NORMAL_DAYS = 2;

/** Paid for, still with us, and older than normal picking time. */
export function isHeldUp(order: Order): boolean {
  return order.status !== 'Shipped' && order.daysWaiting > NORMAL_DAYS;
}

/** The money sitting in a set of orders. */
export function totalValue(orders: Order[]): number {
  return orders.reduce((total, order) => total + order.value, 0);
}

/** One reason, and the orders held for it. */
export interface ReasonGroup {
  reason: string;
  orders: Order[];
  value: number;
}

/**
 * Group held-up orders by why they are held: biggest group first, oldest order first
 * inside each group. Both ties break on value, so nothing on screen ever wobbles
 * between two reads of the same records.
 */
export function groupByReason(orders: Order[]): ReasonGroup[] {
  const groups = new Map<string, Order[]>();
  for (const order of orders) {
    const held = groups.get(order.reason) ?? [];
    held.push(order);
    groups.set(order.reason, held);
  }

  return [...groups.entries()]
    .map(([reason, held]) => ({
      reason,
      orders: [...held].sort((a, b) => b.daysWaiting - a.daysWaiting || b.value - a.value),
      value: totalValue(held),
    }))
    .sort((a, b) => b.orders.length - a.orders.length || b.value - a.value);
}

/* -------------------------------------------------------------------------- *
 * Returns and refunds
 * -------------------------------------------------------------------------- */

/** One thing a customer sent back. */
export interface ReturnRow {
  id: string;
  orderId: string;
  item: string;
  reason: string;
  requestedDate: string;
  refundStatus: string;
  amount: number;
  daysWaiting: number;
}

/** Nobody has approved this refund yet. */
export function isWaiting(entry: ReturnRow): boolean {
  return entry.refundStatus === 'Waiting';
}

/** The money has not gone back yet, approved or not. */
export function inQueue(entry: ReturnRow): boolean {
  return entry.refundStatus !== 'Refunded';
}

/**
 * The refund queue, longest wait first.
 *
 * An approved refund stays in the list until the money has actually gone out, so the
 * queue reads as a worklist rather than as rows vanishing the moment anyone acts.
 */
export function refundQueue(entries: ReturnRow[]): ReturnRow[] {
  return entries.filter(inQueue).sort((a, b) => b.daysWaiting - a.daysWaiting || b.amount - a.amount);
}

/** What a set of refunds adds up to. */
export function totalAmount(entries: ReturnRow[]): number {
  return entries.reduce((total, entry) => total + entry.amount, 0);
}

/** One reason things come back, and how often. */
export interface ReasonCount {
  reason: string;
  count: number;
}

/** Reasons ranked by how many returns each one accounts for. */
export function countReasons(entries: ReturnRow[]): ReasonCount[] {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1));
}
