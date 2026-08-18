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
