/**
 * The late-payment panel: how much is owed, how long it has been owed, which building
 * is carrying it, and then every charge in order, worst first.
 *
 * "Worst" is longest overdue, not largest - a small amount that has been unpaid since
 * January is the one that needs the phone call.
 */

import { bandTotals, buildingTotals, sumOwed } from '../lib/attention';
import type { LateCharge } from '../lib/attention';
import { countOf, money, shortDate } from '../lib/format';
import { BandChart, BuildingBars } from './Bars';

/** Whatever the record calls it, every charge in this panel is money still owed. */
function StatusChip({ status }: { status: string }) {
  return (
    <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700 ring-1 ring-inset ring-red-200">
      {status}
    </span>
  );
}

/** Props for {@link LatePayments}. */
export interface LatePaymentsProps {
  /** Every unpaid charge, already sorted longest overdue first. */
  charges: LateCharge[];
}

export function LatePayments({ charges }: LatePaymentsProps) {
  if (charges.length === 0) {
    return (
      <section className="rounded-lg border border-stone-200 bg-white px-4 py-8 text-center text-sm text-stone-500">
        Nothing is owed this month.
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <header className="border-b border-stone-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-stone-900">Late payments, worst first</h2>
        <p className="mt-0.5 text-xs text-stone-500">
          {countOf(charges.length, 'place', 'places')} · {money(sumOwed(charges))} owed
        </p>
      </header>

      <div className="grid gap-5 border-b border-stone-100 px-4 py-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-stone-400">How far behind</p>
          <div className="mt-2">
            <BandChart bands={bandTotals(charges)} />
          </div>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-stone-400">By building</p>
          <div className="mt-2">
            <BuildingBars buildings={buildingTotals(charges)} />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-2 font-medium">Place</th>
              <th className="px-4 py-2 font-medium">Renter</th>
              <th className="px-4 py-2 text-right font-medium">Owed</th>
              <th className="px-4 py-2 text-right font-medium">Days late</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {charges.map((charge) => (
              <tr key={charge.payment.id}>
                <td className="px-4 py-2">
                  <span className="font-medium text-stone-900">{charge.building}</span>
                  <span className="text-stone-500"> {charge.place}</span>
                </td>
                <td className="px-4 py-2 text-stone-700">{charge.renter}</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(charge.payment.amountDue)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {charge.payment.daysLate}
                  <span className="ml-1 text-xs text-stone-400">
                    due {shortDate(charge.payment.dueDate)}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <StatusChip status={charge.payment.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
