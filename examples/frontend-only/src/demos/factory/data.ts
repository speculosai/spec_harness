/**
 * Ashford Works' mocked records, and the one action the app can take.
 *
 * Hand-written literals, and nothing drawn at runtime: the numbers the agent quotes have
 * to still be true when a visitor adds up the rows, and the conformance check greps the
 * sources to make sure.
 *
 * Two weeks of work are on record - Monday, February 23 to Friday, March 6, 2026 - because
 * the app has to pick the week that is running out of a longer table, which is exactly
 * the kind of small rule a fixed report never quite has.
 */

import type { CallHandler, Dataset } from '../../mock/types';

/* ------------------------------------------------------------------------- *
 * Row shapes
 * ------------------------------------------------------------------------- */

/** One production line. */
export interface LineRow extends Record<string, unknown> {
  /** Reference for the line, used by the other tables. */
  id: string;
  /** What the floor calls it. */
  name: string;
  /** What comes off it. */
  makes: string;
}

/** What one line made on one day, against what it was asked for. */
export interface OutputRow extends Record<string, unknown> {
  /** Which line. */
  line: string;
  /** The day, as a plain date. */
  day: string;
  /** How many finished pieces came off. */
  made: number;
  /** How many were planned for that day. */
  planned: number;
}

/** One time a machine stopped and the line stood still. */
export interface StopRow extends Record<string, unknown> {
  /** Reference for the stop. */
  id: string;
  /** Which line it happened on. */
  line: string;
  /** The day it happened. */
  day: string;
  /** Which machine stopped. */
  machine: string;
  /** Why it stopped, in the words the floor uses. */
  reason: string;
  /** How many minutes the line stood still. */
  minutes: number;
}

/** A check booked on a machine. Starts nearly empty - the app fills it. */
export interface CheckRow extends Record<string, unknown> {
  /** Reference for the check. */
  id: string;
  /** Which machine it is on. */
  machine: string;
  /** The day it is booked for. */
  day: string;
  /** `Planned` or `Done`. */
  status: string;
}

/* ------------------------------------------------------------------------- *
 * The records
 * ------------------------------------------------------------------------- */

/** Three lines, three products. */
const lines: LineRow[] = [
  { id: 'L1', name: 'Line 1', makes: 'Flat-pack shelves' },
  { id: 'L2', name: 'Line 2', makes: 'Dining chairs' },
  { id: 'L3', name: 'Line 3', makes: 'Bed frames' },
];

/**
 * Ten working days, three lines. The plan is steady - 120, 90 and 60 pieces a day - and
 * what got made tracks the minutes lost below it: roughly a quarter of a shelf a minute
 * on line 1, a chair every five and a half, a bed frame every eight.
 */
const output: OutputRow[] = [
  { line: 'L1', day: '2026-02-23', made: 115, planned: 120 },
  { line: 'L2', day: '2026-02-23', made: 87, planned: 90 },
  { line: 'L3', day: '2026-02-23', made: 56, planned: 60 },
  { line: 'L1', day: '2026-02-24', made: 113, planned: 120 },
  { line: 'L2', day: '2026-02-24', made: 88, planned: 90 },
  { line: 'L3', day: '2026-02-24', made: 58, planned: 60 },
  { line: 'L1', day: '2026-02-25', made: 114, planned: 120 },
  { line: 'L2', day: '2026-02-25', made: 85, planned: 90 },
  { line: 'L3', day: '2026-02-25', made: 58, planned: 60 },
  { line: 'L1', day: '2026-02-26', made: 114, planned: 120 },
  { line: 'L2', day: '2026-02-26', made: 90, planned: 90 },
  { line: 'L3', day: '2026-02-26', made: 57, planned: 60 },
  { line: 'L1', day: '2026-02-27', made: 115, planned: 120 },
  { line: 'L2', day: '2026-02-27', made: 86, planned: 90 },
  { line: 'L3', day: '2026-02-27', made: 60, planned: 60 },
  { line: 'L1', day: '2026-03-02', made: 110, planned: 120 },
  { line: 'L2', day: '2026-03-02', made: 85, planned: 90 },
  { line: 'L3', day: '2026-03-02', made: 56, planned: 60 },
  { line: 'L1', day: '2026-03-03', made: 115, planned: 120 },
  { line: 'L2', day: '2026-03-03', made: 84, planned: 90 },
  { line: 'L3', day: '2026-03-03', made: 49, planned: 60 },
  { line: 'L1', day: '2026-03-04', made: 111, planned: 120 },
  { line: 'L2', day: '2026-03-04', made: 83, planned: 90 },
  { line: 'L3', day: '2026-03-04', made: 56, planned: 60 },
  { line: 'L1', day: '2026-03-05', made: 114, planned: 120 },
  { line: 'L2', day: '2026-03-05', made: 85, planned: 90 },
  { line: 'L3', day: '2026-03-05', made: 53, planned: 60 },
  { line: 'L1', day: '2026-03-06', made: 108, planned: 120 },
  { line: 'L2', day: '2026-03-06', made: 83, planned: 90 },
  { line: 'L3', day: '2026-03-06', made: 54, planned: 60 },
];

/**
 * Thirty-five stops. Last week cost 271 minutes; the week that is running cost 558, and
 * 175 of those belong to the press on line 3 - five stops, every one of them low air
 * pressure. That is the fact the third build step lets someone act on.
 */
const stops: StopRow[] = [
  { id: 'S-01', line: 'L1', day: '2026-02-23', machine: 'Panel saw', reason: 'Blade change', minutes: 20 },
  { id: 'S-02', line: 'L2', day: '2026-02-23', machine: 'Paint booth', reason: 'Waiting on paint', minutes: 18 },
  { id: 'S-03', line: 'L3', day: '2026-02-23', machine: 'Drill press', reason: 'Waiting on parts', minutes: 30 },
  { id: 'S-04', line: 'L1', day: '2026-02-24', machine: 'Edge bander', reason: 'Glue jam', minutes: 22 },
  { id: 'S-05', line: 'L3', day: '2026-02-24', machine: 'Press', reason: 'Low air pressure', minutes: 15 },
  { id: 'S-06', line: 'L2', day: '2026-02-24', machine: 'Sander', reason: 'Belt slipped', minutes: 12 },
  { id: 'S-07', line: 'L1', day: '2026-02-25', machine: 'Panel saw', reason: 'Blade change', minutes: 25 },
  { id: 'S-08', line: 'L2', day: '2026-02-25', machine: 'Leg lathe', reason: 'Setup for a new size', minutes: 28 },
  { id: 'S-09', line: 'L3', day: '2026-02-25', machine: 'Packing table', reason: 'Waiting on parts', minutes: 18 },
  { id: 'S-10', line: 'L3', day: '2026-02-26', machine: 'Press', reason: 'Low air pressure', minutes: 20 },
  { id: 'S-11', line: 'L1', day: '2026-02-26', machine: 'Shrink wrapper', reason: 'Waiting on parts', minutes: 25 },
  { id: 'S-12', line: 'L2', day: '2026-02-27', machine: 'Paint booth', reason: 'Waiting on paint', minutes: 20 },
  { id: 'S-13', line: 'L1', day: '2026-02-27', machine: 'Panel saw', reason: 'Blade change', minutes: 18 },
  { id: 'S-14', line: 'L3', day: '2026-03-02', machine: 'Press', reason: 'Low air pressure', minutes: 35 },
  { id: 'S-15', line: 'L1', day: '2026-03-02', machine: 'Panel saw', reason: 'Blade change', minutes: 20 },
  { id: 'S-16', line: 'L2', day: '2026-03-02', machine: 'Paint booth', reason: 'Waiting on paint', minutes: 25 },
  { id: 'S-17', line: 'L1', day: '2026-03-02', machine: 'Edge bander', reason: 'Glue jam', minutes: 18 },
  { id: 'S-18', line: 'L3', day: '2026-03-03', machine: 'Press', reason: 'Low air pressure', minutes: 45 },
  { id: 'S-19', line: 'L2', day: '2026-03-03', machine: 'Leg lathe', reason: 'Setup for a new size', minutes: 30 },
  { id: 'S-20', line: 'L1', day: '2026-03-03', machine: 'Panel saw', reason: 'Blade change', minutes: 18 },
  { id: 'S-21', line: 'L3', day: '2026-03-03', machine: 'Drill press', reason: 'Waiting on parts', minutes: 40 },
  { id: 'S-22', line: 'L3', day: '2026-03-04', machine: 'Press', reason: 'Low air pressure', minutes: 30 },
  { id: 'S-23', line: 'L2', day: '2026-03-04', machine: 'Sander', reason: 'Belt slipped', minutes: 20 },
  { id: 'S-24', line: 'L1', day: '2026-03-04', machine: 'Shrink wrapper', reason: 'Waiting on parts', minutes: 35 },
  { id: 'S-25', line: 'L2', day: '2026-03-04', machine: 'Paint booth', reason: 'Waiting on paint', minutes: 16 },
  { id: 'S-26', line: 'L3', day: '2026-03-05', machine: 'Press', reason: 'Low air pressure', minutes: 40 },
  { id: 'S-27', line: 'L1', day: '2026-03-05', machine: 'Edge bander', reason: 'Belt slipped', minutes: 25 },
  { id: 'S-28', line: 'L2', day: '2026-03-05', machine: 'Leg lathe', reason: 'Setup for a new size', minutes: 25 },
  { id: 'S-29', line: 'L3', day: '2026-03-05', machine: 'Packing table', reason: 'Waiting on parts', minutes: 15 },
  { id: 'S-30', line: 'L3', day: '2026-03-06', machine: 'Press', reason: 'Low air pressure', minutes: 25 },
  { id: 'S-31', line: 'L1', day: '2026-03-06', machine: 'Panel saw', reason: 'Blade change', minutes: 22 },
  { id: 'S-32', line: 'L2', day: '2026-03-06', machine: 'Sander', reason: 'Belt slipped', minutes: 18 },
  { id: 'S-33', line: 'L1', day: '2026-03-06', machine: 'Edge bander', reason: 'Glue jam', minutes: 21 },
  { id: 'S-34', line: 'L2', day: '2026-03-06', machine: 'Paint booth', reason: 'Waiting on paint', minutes: 15 },
  { id: 'S-35', line: 'L3', day: '2026-03-06', machine: 'Drill press', reason: 'Waiting on parts', minutes: 20 },
];

/** What is on the schedule before anyone uses the app: one check done, one coming up. */
const checks: CheckRow[] = [
  { id: 'C-01', machine: 'Panel saw', day: '2026-02-17', status: 'Done' },
  { id: 'C-02', machine: 'Sander', day: '2026-03-10', status: 'Planned' },
];

/** The tables the preview app can read over the bridge. */
export const dataset: Dataset = { lines, output, stops, checks };

/* ------------------------------------------------------------------------- *
 * The action
 * ------------------------------------------------------------------------- */

/** The last day anyone recorded output for. The app calls this day "today". */
function lastDayOnRecord(rows: OutputRow[]): string {
  return rows.reduce((latest, row) => (row.day > latest ? row.day : latest), '');
}

/**
 * The next day the floor is running: tomorrow, unless tomorrow is a weekend.
 *
 * Derived from the records rather than the clock, so a check booked in this demo lands
 * on the same Monday every time anyone plays it.
 */
function nextWorkingDay(day: string): string {
  const at = new Date(`${day}T00:00:00Z`);
  do {
    at.setUTCDate(at.getUTCDate() + 1);
  } while (at.getUTCDay() === 0 || at.getUTCDay() === 6);
  return at.toISOString().slice(0, 10);
}

/**
 * Book a check on a machine.
 *
 * This is the step a chart cannot take: it writes a row back. Asking twice is not an
 * error - the machine already has a check booked, and the app says so.
 */
const scheduleCheck: CallHandler = (data, args) => {
  const machine = String(args.machine ?? '');
  const stopRows = data.stops as StopRow[];
  const checkRows = data.checks as CheckRow[];

  if (!machine || !stopRows.some((stop) => stop.machine === machine)) {
    return { ok: false, machine, message: `no machine called ${machine}` };
  }

  const planned = checkRows.find((check) => check.machine === machine && check.status === 'Planned');
  if (planned) return { ok: true, machine, day: planned.day, alreadyPlanned: true };

  const day = nextWorkingDay(lastDayOnRecord(data.output as OutputRow[]));
  const id = `C-${String(checkRows.length + 1).padStart(2, '0')}`;
  checkRows.push({ id, machine, day, status: 'Planned' });
  return { ok: true, machine, day, alreadyPlanned: false };
};

/** The actions the generated app can take. */
export const calls: Record<string, CallHandler> = { schedule_check: scheduleCheck };
