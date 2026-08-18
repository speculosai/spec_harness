/**
 * Adding stops up: by reason, and by machine.
 *
 * Kept apart from the components so the arithmetic can be read on its own. Ties break
 * on the name rather than on whatever order the rows arrived in, so the ranking is the
 * same every time the page is opened.
 */

import type { Line, Stop } from './rows';

/** A ranked total: what it is, how long it cost, how many times it happened. */
export interface Total {
  /** The reason, or the machine name. */
  key: string;
  /** Minutes lost. */
  minutes: number;
  /** How many stops made up that time. */
  stops: number;
}

/** A machine's total, with the two things worth saying about it in plain words. */
export interface MachineTotal extends Total {
  /** The line it sits on. */
  lineName: string;
  /** The reason it stopped for most often. */
  topReason: string;
  /** True when every one of its stops had the same reason. */
  oneReason: boolean;
}

/** Only the stops from the week that is running. Dates are text, so this is a compare. */
export function stopsInWeek(stops: Stop[], weekStart: string): Stop[] {
  return stops.filter((stop) => stop.day >= weekStart);
}

/** Group and rank, worst first. */
function totalsBy(stops: Stop[], pick: (stop: Stop) => string): Total[] {
  const byKey = new Map<string, Total>();
  for (const stop of stops) {
    const key = pick(stop);
    const total = byKey.get(key) ?? { key, minutes: 0, stops: 0 };
    total.minutes += stop.minutes;
    total.stops += 1;
    byKey.set(key, total);
  }
  return [...byKey.values()].sort((a, b) => b.minutes - a.minutes || (a.key < b.key ? -1 : 1));
}

/** Why the time went, worst reason first. */
export function reasonTotals(stops: Stop[]): Total[] {
  return totalsBy(stops, (stop) => stop.reason);
}

/** Which machine the time went on, worst machine first. */
export function machineTotals(stops: Stop[], lines: Line[]): MachineTotal[] {
  const names = new Map(lines.map((line) => [line.id, line.name]));
  return totalsBy(stops, (stop) => stop.machine).map((total) => {
    const own = stops.filter((stop) => stop.machine === total.key);
    const reasons = totalsBy(own, (stop) => stop.reason);
    return {
      ...total,
      lineName: names.get(own[0]?.line ?? '') ?? 'the floor',
      topReason: reasons[0]?.key ?? '',
      oneReason: reasons.length === 1,
    };
  });
}
