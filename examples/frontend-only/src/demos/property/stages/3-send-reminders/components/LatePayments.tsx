/**
 * The late-payment panel: how much is owed, how long it has been owed, which building
 * is carrying it, and then every charge in order, worst first - each with the button
 * that chases it.
 *
 * "Worst" is longest overdue, not largest - a small amount that has been unpaid since
 * January is the one that needs the phone call.
 *
 * The button does not edit the row it sits on. It sends the reminder, asks the page to
 * re-read the records, and lets the row come back saying what the record now says.
 */

import { useCallback, useState } from 'react';

import { bandTotals, buildingTotals, sumOwed } from '../lib/attention';
import type { LateCharge } from '../lib/attention';
import { sendReminder } from '../lib/data';
import { countOf, money, shortDate } from '../lib/format';
import { BandChart, BuildingBars } from './Bars';

/** Late, or late with a reminder against it. Both are still money owed. */
function StatusChip({ status }: { status: string }) {
  const tone =
    status === 'Reminder sent'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : 'bg-red-50 text-red-700 ring-red-200';
  return <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${tone}`}>{status}</span>;
}

/** Props for {@link LatePayments}. */
export interface LatePaymentsProps {
  /** Every unpaid charge, already sorted longest overdue first. */
  charges: LateCharge[];
  /** Re-read the records. Called after a reminder changes one. */
  onReminderSent: () => void | Promise<void>;
}

export function LatePayments({ charges, onReminderSent }: LatePaymentsProps) {
  const [sending, setSending] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const remind = useCallback(
    async (charge: LateCharge) => {
      setNote(null);
      setProblem(null);
      setSending(charge.payment.id);
      const answer = await sendReminder(charge.payment.id);
      setSending(null);
      if (!answer.ok) {
        setProblem(`That reminder did not go out - ${answer.problem ?? 'no reason given'}.`);
        return;
      }
      setNote(`Reminder sent to ${charge.renter} at ${charge.building} ${charge.place}.`);
      await onReminderSent();
    },
    [onReminderSent],
  );

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
          {countOf(charges.length, 'place', 'places')} · {money(sumOwed(charges))} owed · a reminder
          writes straight back to the records
        </p>
      </header>

      {note && <p className="border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{note}</p>}
      {problem && <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{problem}</p>}

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
              <th className="px-4 py-2 text-right font-medium">Chase it</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {charges.map((charge) => {
              const chased = charge.payment.status === 'Reminder sent';
              return (
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
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      disabled={chased || sending !== null}
                      onClick={() => void remind(charge)}
                      className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:border-stone-200 disabled:bg-stone-50 disabled:text-stone-400"
                    >
                      {sending === charge.payment.id ? 'Sending' : chased ? 'Sent' : 'Send a reminder'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
