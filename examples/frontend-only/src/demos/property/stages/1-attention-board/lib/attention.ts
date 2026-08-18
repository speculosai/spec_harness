/**
 * The three rules that decide what lands on the board.
 *
 * They live apart from the page so the wording of a rule is one line to change: today a
 * repair counts as stuck after a week, and if that turns out to be the wrong week, the
 * change is here rather than spread through the layout.
 */

import { isBehind, unitsById } from './data';
import type { Records, Unit } from './data';
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
      note: `${countOf(payment.daysLate, 'day', 'days')} late, due ${shortDate(payment.dueDate)}`,
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
