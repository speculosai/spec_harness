/**
 * The rules that decide what lands on the board, and the money behind the first one.
 *
 * They live apart from the page so the wording of a rule is one line to change: today a
 * repair counts as stuck after a week, and if that is the wrong week the change is here
 * rather than spread through the layout. The late-payment half at the bottom answers
 * the panel's three questions - how much in total, per band, per building - in one
 * place, which is what keeps those figures adding up.
 */

import { isBehind, unitsById } from './data';
import type { Payment, Records, Unit } from './data';
import { countOf, daysSince, daysUntil, money, shortDate } from './format';

/** An agreement this close to its end date needs a conversation. */
export const ENDING_WITHIN_DAYS = 60;

/** A repair open for longer than this has stopped being a normal repair. */
export const WAITING_LONGER_THAN_DAYS = 7;

/** How loudly a row asks to be dealt with. */
export type Tone = 'urgent' | 'soon' | 'steady';

/**
 * One line on the board. Every column renders these and nothing else: `id` is the
 * charge, agreement or repair reference, `building` is what the columns group on,
 * `headline` is the number that has to fit in a chip, and `note` is the rest of it.
 */
export interface AttentionEntry {
  id: string;
  building: string;
  place: string;
  person: string;
  headline: string;
  note: string;
  tone: Tone;
}

/** Where a row lives, whether or not the place is still on file. */
function addressOf(unit: Unit | undefined): { building: string; place: string; person: string } {
  if (!unit) return { building: 'Not on file', place: 'Unknown place', person: '' };
  return { building: unit.building, place: unit.unit, person: unit.renter || 'Empty' };
}

/** Charges that have not been paid, longest overdue first. */
export function behindOnPayment(records: Records): AttentionEntry[] {
  const places = unitsById(records.units);
  return records.payments
    .filter(isBehind)
    .sort((a, b) => b.daysLate - a.daysLate)
    .map((payment): AttentionEntry => ({
      id: payment.id,
      ...addressOf(places.get(payment.unitId)),
      headline: money(payment.amountDue),
      note:
        payment.status === 'Reminder sent'
          ? `${countOf(payment.daysLate, 'day', 'days')} late, reminder sent`
          : `${countOf(payment.daysLate, 'day', 'days')} late, due ${shortDate(payment.dueDate)}`,
      tone: payment.daysLate > 30 ? 'urgent' : 'soon',
    }));
}

/** Agreements ending inside the window, soonest first. */
export function agreementsEnding(records: Records): AttentionEntry[] {
  const places = unitsById(records.units);
  return records.agreements
    .filter((agreement) => {
      const left = daysUntil(agreement.endDate);
      return left >= 0 && left <= ENDING_WITHIN_DAYS;
    })
    .sort((a, b) => daysUntil(a.endDate) - daysUntil(b.endDate))
    .map((agreement): AttentionEntry => ({
      id: agreement.id,
      ...addressOf(places.get(agreement.unitId)),
      headline: `${daysUntil(agreement.endDate)} days`,
      note: `Ends ${shortDate(agreement.endDate)} · ${agreement.plan.toLowerCase()}`,
      tone: agreement.plan === 'Not said yet' ? 'soon' : 'steady',
    }));
}

/** Repairs still open after longer than a week, longest wait first. */
export function repairsWaiting(records: Records): AttentionEntry[] {
  const places = unitsById(records.units);
  return records.repairs
    .filter((job) => job.status !== 'Done' && daysSince(job.reportedDate) > WAITING_LONGER_THAN_DAYS)
    .sort((a, b) => daysSince(b.reportedDate) - daysSince(a.reportedDate))
    .map((job): AttentionEntry => ({
      id: job.id,
      ...addressOf(places.get(job.unitId)),
      headline: `${daysSince(job.reportedDate)} days`,
      note: `${job.problem} · waiting on ${job.waitingOn.toLowerCase()}`,
      tone: daysSince(job.reportedDate) > 14 ? 'urgent' : 'soon',
    }));
}

/* ------------------------------------------------------------------------- *
 * The money behind the first column
 * ------------------------------------------------------------------------- */

/** A charge that is still owed, with the address it belongs to attached. */
export interface LateCharge {
  payment: Payment;
  building: string;
  place: string;
  renter: string;
}

/** How long overdue, in bands, worst first. */
export const OVERDUE_BANDS: ReadonlyArray<{ label: string; from: number; to: number }> = [
  { label: 'More than 60 days', from: 61, to: Number.MAX_SAFE_INTEGER },
  { label: '31 to 60 days', from: 31, to: 60 },
  { label: '8 to 30 days', from: 8, to: 30 },
  { label: '1 to 7 days', from: 1, to: 7 },
];

/** A band or a building, and what it is carrying. */
export interface Total {
  label: string;
  count: number;
  owed: number;
}

/** Everything in a list of charges, added up. */
export function sumOwed(charges: LateCharge[]): number {
  return charges.reduce((total, charge) => total + charge.payment.amountDue, 0);
}

/** Every unpaid charge, longest overdue first, with its address. */
export function lateCharges(records: Records): LateCharge[] {
  const places = unitsById(records.units);
  return records.payments
    .filter(isBehind)
    .sort((a, b) => b.daysLate - a.daysLate)
    .map((payment): LateCharge => {
      const where = addressOf(places.get(payment.unitId));
      return { payment, building: where.building, place: where.place, renter: where.person };
    });
}

/** Every band, in the fixed worst-first order, including the empty ones. */
export function bandTotals(charges: LateCharge[]): Total[] {
  return OVERDUE_BANDS.map((band): Total => {
    const inBand = charges.filter(
      (charge) => charge.payment.daysLate >= band.from && charge.payment.daysLate <= band.to,
    );
    return { label: band.label, count: inBand.length, owed: sumOwed(inBand) };
  });
}

/** Buildings that are owed money, the one owed the most first. */
export function buildingTotals(charges: LateCharge[]): Total[] {
  const totals = new Map<string, Total>();
  for (const charge of charges) {
    const row = totals.get(charge.building) ?? { label: charge.building, count: 0, owed: 0 };
    row.count += 1;
    row.owed += charge.payment.amountDue;
    totals.set(charge.building, row);
  }
  return [...totals.values()].sort((a, b) => b.owed - a.owed);
}
