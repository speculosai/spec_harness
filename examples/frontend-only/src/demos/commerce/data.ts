/**
 * Bluebell Goods' mocked records, and the two actions the app can take.
 *
 * Hand-written literals, and nothing drawn at runtime: the numbers the agent quotes have
 * to still be true when a visitor counts the rows, and the conformance check greps the
 * sources to make sure.
 *
 * The whole set is written as if today were March 2, 2026. Ages are stored as plain day
 * counts (`daysWaiting`) rather than computed from the clock, so the app shows the same
 * figures the agent quotes however long this example sits on a shelf.
 */

import type { CallHandler, Dataset } from '../../mock/types';

/** One customer order. */
export interface OrderRow extends Record<string, unknown> {
  /** Order reference. */
  id: string;
  /** Who bought it. */
  customer: string;
  /** How many things are in the box. */
  items: number;
  /** What the customer paid, in whole dollars. */
  value: number;
  /** The day the money arrived. */
  paidDate: string;
  /** `Shipped`, `Not shipped`, or `Released` once someone lets it go out. */
  status: string;
  /** Why it has not gone out: `Waiting on stock`, `Address problem`, `Payment check`, `None`. */
  reason: string;
  /** The item the order is short of, when it is waiting on stock. Empty otherwise. */
  waitingFor: string;
  /** The day the problem was cleared, or empty while it is still a problem. */
  clearedDate: string;
  /** Days since the money arrived, for orders that have not gone out. */
  daysWaiting: number;
}

/** One thing a customer sent back. */
export interface ReturnRow extends Record<string, unknown> {
  /** Return reference. */
  id: string;
  /** The order it came from. */
  orderId: string;
  /** What is coming back. */
  item: string;
  /** Why: `Damaged in transit`, `Wrong item sent`, `Not as described`, `Changed mind`, `Arrived late`. */
  reason: string;
  /** The day the customer asked to send it back. */
  requestedDate: string;
  /** `Waiting`, `Approved`, or `Refunded`. */
  refundStatus: string;
  /** What the customer gets back, in whole dollars. */
  amount: number;
  /** Days since they asked. */
  daysWaiting: number;
}

/** One item on the shelves. */
export interface StockRow extends Record<string, unknown> {
  /** The item, as the store lists it. */
  item: string;
  /** How many are on the shelf now. */
  onHand: number;
  /** How many are on their way from the supplier. */
  onTheWay: number;
  /** The day the supplier says they land, or empty when nothing is coming. */
  dueDate: string;
}

/**
 * Thirty-six orders paid for over the last ten days.
 *
 * Twenty-four have gone out. Four were paid in the last two days and are still being
 * picked, which is normal. The other eight have been sitting for more than two days:
 * four short of stock, two with a bad address, two held for a payment check. Three of
 * those eight have had their problem cleared (`clearedDate` is set) and are only waiting
 * for someone to let them go.
 */
const orders: OrderRow[] = [
  { id: 'O-4401', customer: 'Hannah Poole', items: 2, value: 64, paidDate: '2026-02-21', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4402', customer: 'Dev Chauhan', items: 1, value: 29, paidDate: '2026-02-21', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4403', customer: 'Erin Walsh', items: 4, value: 138, paidDate: '2026-02-22', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4404', customer: 'Milo Brand', items: 3, value: 97, paidDate: '2026-02-22', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4405', customer: 'Sofia Duarte', items: 1, value: 34, paidDate: '2026-02-23', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4406', customer: 'Jonah Reid', items: 5, value: 176, paidDate: '2026-02-23', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4407', customer: 'Cora Whitfield', items: 2, value: 58, paidDate: '2026-02-23', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4408', customer: 'Ade Bakare', items: 6, value: 231, paidDate: '2026-02-24', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4409', customer: 'Nils Berger', items: 1, value: 41, paidDate: '2026-02-24', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4410', customer: 'Grace Lim', items: 3, value: 112, paidDate: '2026-02-24', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4411', customer: 'Tomas Novak', items: 2, value: 73, paidDate: '2026-02-25', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4412', customer: 'Priya Raman', items: 3, value: 148, paidDate: '2026-02-24', status: 'Not shipped', reason: 'Waiting on stock', waitingFor: 'Linen curtains, 72 in', clearedDate: '', daysWaiting: 6 },
  { id: 'O-4413', customer: 'Farah Aziz', items: 4, value: 149, paidDate: '2026-02-25', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4414', customer: 'Leo Hartmann', items: 1, value: 27, paidDate: '2026-02-25', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4415', customer: 'Marta Silva', items: 6, value: 264, paidDate: '2026-02-25', status: 'Not shipped', reason: 'Address problem', waitingFor: '', clearedDate: '2026-03-01', daysWaiting: 5 },
  { id: 'O-4416', customer: 'Bea Sanderson', items: 2, value: 86, paidDate: '2026-02-26', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4417', customer: 'Kwame Mensah', items: 3, value: 104, paidDate: '2026-02-26', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4418', customer: 'Sam Okoro', items: 2, value: 96, paidDate: '2026-02-25', status: 'Not shipped', reason: 'Waiting on stock', waitingFor: 'Stoneware mug, cream', clearedDate: '2026-03-01', daysWaiting: 5 },
  { id: 'O-4419', customer: 'Rosa Ibarra', items: 5, value: 193, paidDate: '2026-02-27', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4420', customer: 'Callum Frey', items: 1, value: 36, paidDate: '2026-02-27', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4421', customer: 'Aiko Mori', items: 4, value: 212, paidDate: '2026-02-26', status: 'Not shipped', reason: 'Payment check', waitingFor: '', clearedDate: '', daysWaiting: 4 },
  { id: 'O-4422', customer: 'Ines Moreau', items: 2, value: 79, paidDate: '2026-02-28', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4423', customer: 'Yusuf Demir', items: 3, value: 121, paidDate: '2026-02-28', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4424', customer: 'Owen Clarke', items: 1, value: 58, paidDate: '2026-02-26', status: 'Not shipped', reason: 'Waiting on stock', waitingFor: 'Cast iron pan, 10 in', clearedDate: '', daysWaiting: 4 },
  { id: 'O-4425', customer: 'Alma Sorensen', items: 1, value: 45, paidDate: '2026-02-28', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4426', customer: 'Petra Lang', items: 4, value: 158, paidDate: '2026-03-01', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4427', customer: 'Ruth Ellery', items: 5, value: 189, paidDate: '2026-02-27', status: 'Not shipped', reason: 'Payment check', waitingFor: '', clearedDate: '2026-03-02', daysWaiting: 3 },
  { id: 'O-4428', customer: 'Rhys Morgan', items: 2, value: 68, paidDate: '2026-03-01', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4429', customer: 'Mei Tanaka', items: 3, value: 127, paidDate: '2026-03-01', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4430', customer: 'Nadia Hassan', items: 2, value: 74, paidDate: '2026-02-27', status: 'Not shipped', reason: 'Address problem', waitingFor: '', clearedDate: '', daysWaiting: 3 },
  { id: 'O-4431', customer: 'Oscar Nunes', items: 1, value: 39, paidDate: '2026-03-01', status: 'Shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
  { id: 'O-4433', customer: 'Lena Fischer', items: 7, value: 321, paidDate: '2026-02-27', status: 'Not shipped', reason: 'Waiting on stock', waitingFor: 'Wool throw, gray', clearedDate: '', daysWaiting: 3 },
  { id: 'O-4434', customer: 'Tom Beckett', items: 1, value: 42, paidDate: '2026-02-28', status: 'Not shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 2 },
  { id: 'O-4435', customer: 'Carl Jensen', items: 3, value: 117, paidDate: '2026-03-01', status: 'Not shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 1 },
  { id: 'O-4436', customer: 'Iris Doyle', items: 2, value: 88, paidDate: '2026-03-01', status: 'Not shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 1 },
  { id: 'O-4437', customer: 'Hugo Marsh', items: 4, value: 156, paidDate: '2026-03-02', status: 'Not shipped', reason: 'None', waitingFor: '', clearedDate: '', daysWaiting: 0 },
];

/**
 * Twenty-eight things customers sent back over the last two weeks.
 *
 * Nine refunds are still waiting for someone to approve them, four are approved and on
 * their way out, fifteen are paid back. Damaged in transit is the biggest reason, nine
 * of the twenty-eight.
 */
const returns: ReturnRow[] = [
  { id: 'R-2101', orderId: 'O-4301', item: 'Cast iron pan, 10 in', reason: 'Damaged in transit', requestedDate: '2026-02-21', refundStatus: 'Waiting', amount: 68, daysWaiting: 9 },
  { id: 'R-2102', orderId: 'O-4309', item: 'Linen curtains, 72 in', reason: 'Wrong item sent', requestedDate: '2026-02-22', refundStatus: 'Waiting', amount: 54, daysWaiting: 8 },
  { id: 'R-2103', orderId: 'O-4316', item: 'Stoneware mug, cream', reason: 'Damaged in transit', requestedDate: '2026-02-23', refundStatus: 'Waiting', amount: 24, daysWaiting: 7 },
  { id: 'R-2104', orderId: 'O-4322', item: 'Wool throw, gray', reason: 'Not as described', requestedDate: '2026-02-24', refundStatus: 'Waiting', amount: 45, daysWaiting: 6 },
  { id: 'R-2105', orderId: 'O-4327', item: 'Bath towel set, white', reason: 'Damaged in transit', requestedDate: '2026-02-25', refundStatus: 'Waiting', amount: 38, daysWaiting: 5 },
  { id: 'R-2106', orderId: 'O-4334', item: 'Oak cutting board', reason: 'Wrong item sent', requestedDate: '2026-02-26', refundStatus: 'Waiting', amount: 29, daysWaiting: 4 },
  { id: 'R-2107', orderId: 'O-4341', item: 'Glass storage jars, set of 4', reason: 'Changed mind', requestedDate: '2026-02-27', refundStatus: 'Waiting', amount: 32, daysWaiting: 3 },
  { id: 'R-2108', orderId: 'O-4348', item: 'Copper table lamp', reason: 'Damaged in transit', requestedDate: '2026-02-28', refundStatus: 'Waiting', amount: 76, daysWaiting: 2 },
  { id: 'R-2109', orderId: 'O-4355', item: 'Cotton bed sheet, full', reason: 'Arrived late', requestedDate: '2026-03-01', refundStatus: 'Waiting', amount: 41, daysWaiting: 1 },
  { id: 'R-2110', orderId: 'O-4318', item: 'Bamboo bath mat', reason: 'Wrong item sent', requestedDate: '2026-02-24', refundStatus: 'Approved', amount: 22, daysWaiting: 6 },
  { id: 'R-2111', orderId: 'O-4325', item: 'Ceramic plant pot, large', reason: 'Damaged in transit', requestedDate: '2026-02-25', refundStatus: 'Approved', amount: 34, daysWaiting: 5 },
  { id: 'R-2112', orderId: 'O-4331', item: 'Wooden spoon set', reason: 'Changed mind', requestedDate: '2026-02-26', refundStatus: 'Approved', amount: 19, daysWaiting: 4 },
  { id: 'R-2113', orderId: 'O-4338', item: 'Stainless steel kettle', reason: 'Not as described', requestedDate: '2026-02-27', refundStatus: 'Approved', amount: 58, daysWaiting: 3 },
  { id: 'R-2114', orderId: 'O-4260', item: 'Glass carafe, 34 oz', reason: 'Damaged in transit', requestedDate: '2026-02-16', refundStatus: 'Refunded', amount: 26, daysWaiting: 14 },
  { id: 'R-2115', orderId: 'O-4263', item: 'Cork coasters, set of 4', reason: 'Wrong item sent', requestedDate: '2026-02-16', refundStatus: 'Refunded', amount: 14, daysWaiting: 14 },
  { id: 'R-2116', orderId: 'O-4267', item: 'Velvet cushion, ocher', reason: 'Not as described', requestedDate: '2026-02-17', refundStatus: 'Refunded', amount: 31, daysWaiting: 13 },
  { id: 'R-2117', orderId: 'O-4271', item: 'Recycled glass tumbler', reason: 'Damaged in transit', requestedDate: '2026-02-17', refundStatus: 'Refunded', amount: 18, daysWaiting: 13 },
  { id: 'R-2118', orderId: 'O-4274', item: 'Jute doormat', reason: 'Changed mind', requestedDate: '2026-02-18', refundStatus: 'Refunded', amount: 23, daysWaiting: 12 },
  { id: 'R-2119', orderId: 'O-4278', item: 'Linen napkins, set of 6', reason: 'Wrong item sent', requestedDate: '2026-02-18', refundStatus: 'Refunded', amount: 27, daysWaiting: 12 },
  { id: 'R-2120', orderId: 'O-4282', item: 'Cotton dish towels, set of 3', reason: 'Arrived late', requestedDate: '2026-02-19', refundStatus: 'Refunded', amount: 16, daysWaiting: 11 },
  { id: 'R-2121', orderId: 'O-4286', item: 'Marble pastry board', reason: 'Damaged in transit', requestedDate: '2026-02-20', refundStatus: 'Refunded', amount: 49, daysWaiting: 10 },
  { id: 'R-2122', orderId: 'O-4289', item: 'Brass picture frame, 8x10', reason: 'Not as described', requestedDate: '2026-02-20', refundStatus: 'Refunded', amount: 21, daysWaiting: 10 },
  { id: 'R-2123', orderId: 'O-4293', item: 'Enamel casserole dish', reason: 'Wrong item sent', requestedDate: '2026-02-21', refundStatus: 'Refunded', amount: 62, daysWaiting: 9 },
  { id: 'R-2124', orderId: 'O-4297', item: 'Stoneware serving bowl', reason: 'Damaged in transit', requestedDate: '2026-02-22', refundStatus: 'Refunded', amount: 35, daysWaiting: 8 },
  { id: 'R-2125', orderId: 'O-4304', item: 'Rattan laundry basket', reason: 'Changed mind', requestedDate: '2026-02-23', refundStatus: 'Refunded', amount: 28, daysWaiting: 7 },
  { id: 'R-2126', orderId: 'O-4311', item: 'Bath towel set, white', reason: 'Arrived late', requestedDate: '2026-02-24', refundStatus: 'Refunded', amount: 38, daysWaiting: 6 },
  { id: 'R-2127', orderId: 'O-4319', item: 'Wicker storage trunk', reason: 'Wrong item sent', requestedDate: '2026-02-25', refundStatus: 'Refunded', amount: 74, daysWaiting: 5 },
  { id: 'R-2128', orderId: 'O-4336', item: 'Cotton bed sheet, full', reason: 'Not as described', requestedDate: '2026-02-27', refundStatus: 'Refunded', amount: 41, daysWaiting: 3 },
];

/**
 * Twenty-six items on the shelves.
 *
 * The first four are the ones stuck orders are short of: the mugs landed on March 1,
 * which is why one of those orders is ready to go; the other three are still on a truck.
 */
const stock: StockRow[] = [
  { item: 'Linen curtains, 72 in', onHand: 0, onTheWay: 40, dueDate: '2026-03-05' },
  { item: 'Cast iron pan, 10 in', onHand: 0, onTheWay: 25, dueDate: '2026-03-04' },
  { item: 'Wool throw, gray', onHand: 0, onTheWay: 60, dueDate: '2026-03-06' },
  { item: 'Stoneware mug, cream', onHand: 120, onTheWay: 0, dueDate: '' },
  { item: 'Bath towel set, white', onHand: 46, onTheWay: 0, dueDate: '' },
  { item: 'Oak cutting board', onHand: 18, onTheWay: 30, dueDate: '2026-03-09' },
  { item: 'Glass storage jars, set of 4', onHand: 64, onTheWay: 0, dueDate: '' },
  { item: 'Copper table lamp', onHand: 9, onTheWay: 24, dueDate: '2026-03-07' },
  { item: 'Cotton bed sheet, full', onHand: 73, onTheWay: 0, dueDate: '' },
  { item: 'Enamel casserole dish', onHand: 12, onTheWay: 20, dueDate: '2026-03-10' },
  { item: 'Rattan laundry basket', onHand: 27, onTheWay: 0, dueDate: '' },
  { item: 'Bamboo bath mat', onHand: 51, onTheWay: 0, dueDate: '' },
  { item: 'Ceramic plant pot, large', onHand: 33, onTheWay: 40, dueDate: '2026-03-11' },
  { item: 'Wooden spoon set', onHand: 88, onTheWay: 0, dueDate: '' },
  { item: 'Linen napkins, set of 6', onHand: 41, onTheWay: 0, dueDate: '' },
  { item: 'Cork coasters, set of 4', onHand: 96, onTheWay: 0, dueDate: '' },
  { item: 'Stainless steel kettle', onHand: 15, onTheWay: 30, dueDate: '2026-03-08' },
  { item: 'Glass carafe, 34 oz', onHand: 22, onTheWay: 0, dueDate: '' },
  { item: 'Velvet cushion, ocher', onHand: 37, onTheWay: 25, dueDate: '2026-03-12' },
  { item: 'Recycled glass tumbler', onHand: 110, onTheWay: 0, dueDate: '' },
  { item: 'Cotton dish towels, set of 3', onHand: 82, onTheWay: 0, dueDate: '' },
  { item: 'Brass picture frame, 8x10', onHand: 24, onTheWay: 0, dueDate: '' },
  { item: 'Wicker storage trunk', onHand: 6, onTheWay: 12, dueDate: '2026-03-13' },
  { item: 'Marble pastry board', onHand: 11, onTheWay: 0, dueDate: '' },
  { item: 'Stoneware serving bowl', onHand: 29, onTheWay: 0, dueDate: '' },
  { item: 'Jute doormat', onHand: 44, onTheWay: 20, dueDate: '2026-03-14' },
];

/** The tables the preview app can read over the bridge. */
export const dataset: Dataset = { orders, returns, stock };

/**
 * Let an order go out.
 *
 * Only an order whose problem has been cleared can be released - the app disables the
 * button on the rest, and this refuses them too, because an action a person can reach
 * by other means still has to be safe.
 */
const releaseOrder: CallHandler = (data, args) => {
  const id = String(args.id ?? '');
  const row = (data.orders as OrderRow[]).find((order) => order.id === id);
  if (!row) return { ok: false, id, message: 'no such order' };
  if (row.status !== 'Not shipped') return { ok: false, id, message: 'this order has already gone out' };
  if (!row.clearedDate) return { ok: false, id, message: 'this order is still waiting' };
  row.status = 'Released';
  return { ok: true, id, status: row.status };
};

/** Approve the money going back to a customer. */
const approveRefund: CallHandler = (data, args) => {
  const id = String(args.id ?? '');
  const row = (data.returns as ReturnRow[]).find((entry) => entry.id === id);
  if (!row) return { ok: false, id, message: 'no such return' };
  if (row.refundStatus !== 'Waiting') return { ok: false, id, message: 'this refund is already approved' };
  row.refundStatus = 'Approved';
  return { ok: true, id, refundStatus: row.refundStatus };
};

/** The actions the generated app can take. */
export const calls: Record<string, CallHandler> = {
  release_order: releaseOrder,
  approve_refund: approveRefund,
};
