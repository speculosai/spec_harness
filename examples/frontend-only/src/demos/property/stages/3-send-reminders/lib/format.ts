/**
 * Money, dates, and the one day everything is counted from.
 *
 * Northwind's records are a snapshot taken on March 16, 2026, so the board measures
 * "days late" and "ends within 60 days" against that fixed day rather than the clock.
 * Reading a frozen set of records against a moving today is how a board starts lying.
 */

/** The day these records were taken. */
export const TODAY = '2026-03-16';

/** The same day, written out for the page header. */
export const TODAY_LABEL = 'March 16, 2026';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC on a `YYYY-MM-DD` day, so day counts never drift with the timezone. */
function midnight(day: string): number {
  return Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
}

/** Whole dollars, grouped: `$10,725`. */
export function money(amount: number): string {
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

/** `2026-03-31` reads as `Mar 31`. */
export function shortDate(day: string): string {
  return new Date(midnight(day)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** How many days ago something happened. Never negative. */
export function daysSince(day: string): number {
  return Math.max(0, Math.round((midnight(TODAY) - midnight(day)) / DAY_MS));
}

/** How many days until a day arrives. Negative once it has passed. */
export function daysUntil(day: string): number {
  return Math.round((midnight(day) - midnight(TODAY)) / DAY_MS);
}

/** `1 place`, `9 places` - counted things read badly without this. */
export function countOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
