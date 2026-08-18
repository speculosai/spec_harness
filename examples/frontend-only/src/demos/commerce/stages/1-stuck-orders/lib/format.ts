/**
 * Display helpers. Three of them, and none of them ask the clock.
 *
 * Ages come off the records as day counts, and dates are formatted by splitting the
 * string rather than parsing it, so the screen reads the same in every timezone.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Whole dollars, the way the finance team writes them. */
export function money(amount: number): string {
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

/** `2026-03-01` becomes `Mar 1`. An unexpected string is shown as it is. */
export function shortDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  const index = Number(month) - 1;
  if (!year || !MONTHS[index] || !day) return iso;
  return `${MONTHS[index]} ${Number(day)}`;
}

/** `1 day`, `4 days`. */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}
