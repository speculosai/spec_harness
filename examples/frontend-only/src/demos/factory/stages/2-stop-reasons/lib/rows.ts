/**
 * The rows this app reads over the bridge, and the two date helpers it needs.
 *
 * The shapes are written out rather than inferred so the rest of the app can be read
 * without knowing what the records look like. Dates arrive as plain `YYYY-MM-DD`
 * strings, which sort correctly as text - no parsing needed to find the latest day.
 */

/** One production line. */
export interface Line {
  /** Reference for the line, used by the other tables. */
  id: string;
  /** What the floor calls it. */
  name: string;
  /** What comes off it. */
  makes: string;
}

/** What one line made on one day, against what it was asked for. */
export interface Output {
  line: string;
  day: string;
  made: number;
  planned: number;
}

/** One time a machine stopped and the line stood still. */
export interface Stop {
  id: string;
  line: string;
  day: string;
  machine: string;
  reason: string;
  minutes: number;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * A day written the way it is written on the board by the door: "Friday, March 6".
 *
 * Read in UTC on purpose - the records are calendar days, and reading them in the
 * viewer's timezone would slide half of them into the day before.
 */
export function dayLabel(day: string): string {
  const at = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return day;
  return `${WEEKDAYS[at.getUTCDay()]}, ${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}`;
}

/** The most recent day anything was recorded for. The app calls that day today. */
export function latestDay(rows: Array<{ day: string }>): string {
  return rows.reduce((latest, row) => (row.day > latest ? row.day : latest), '');
}

/**
 * The Monday of the week a day falls in.
 *
 * The records run back further than the week that is running, so "this week" has to be
 * worked out rather than assumed: everything from this Monday onward is the week.
 */
export function weekStartOf(day: string): string {
  const at = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return day;
  at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7));
  return at.toISOString().slice(0, 10);
}

/** Minutes lost across a set of stops. */
export function minutesLost(stops: Stop[]): number {
  return stops.reduce((total, stop) => total + stop.minutes, 0);
}
