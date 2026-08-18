/**
 * The only way this app reaches data, the shape of every row that comes back, and the
 * one action this app can take.
 *
 * There is no HTTP here and no imported fixture: `window.app.data` is installed in the
 * preview frame by the connector shim, and each call is a postMessage the parent
 * answers. Neither helper ever throws - a failure arrives as an `error` alongside an
 * empty result, so a bad table name renders an empty state instead of a crash card.
 */

/** The runtime the preview injects. `app` is the namespace this workspace is bound to. */
interface DataBridge {
  query(table: string): Promise<{ rows?: unknown[]; error?: string }>;
  call(name: string, args?: Record<string, unknown>): Promise<{ result?: unknown; error?: string }>;
}

function bridge(): DataBridge {
  return (window as unknown as { app: { data: DataBridge } }).app.data;
}

/** Read a whole table. */
export async function query<T>(table: string): Promise<{ rows: T[]; error?: string }> {
  const answer = await bridge().query(table);
  return { rows: Array.isArray(answer.rows) ? (answer.rows as T[]) : [], error: answer.error };
}

/** Take an action. Re-read the table afterwards to see what it changed. */
export async function call<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ result: T | null; error?: string }> {
  const answer = await bridge().call(name, args);
  return { result: (answer.result ?? null) as T | null, error: answer.error };
}

/* ------------------------------------------------------------------------- *
 * The rows
 * ------------------------------------------------------------------------- */

/** One place Northwind rents out. */
export interface Unit {
  id: string;
  building: string;
  unit: string;
  renter: string;
  rent: number;
  /** `Rented out` or `Empty`. */
  status: string;
}

/** A rent charge against one place. */
export interface Payment {
  id: string;
  unitId: string;
  amountDue: number;
  dueDate: string;
  daysLate: number;
  /** `Paid`, `Late`, or `Reminder sent`. */
  status: string;
  remindedOn?: string;
}

/** The renter's agreement for one place. */
export interface Agreement {
  id: string;
  unitId: string;
  endDate: string;
  /** What the renter has said about the end: staying, leaving, or nothing yet. */
  plan: string;
}

/** Something reported as broken. */
export interface Repair {
  id: string;
  unitId: string;
  problem: string;
  reportedDate: string;
  /** `Open`, `Scheduled`, or `Done`. */
  status: string;
  waitingOn: string;
}

/** Everything the board reads, in one object. */
export interface Records {
  units: Unit[];
  payments: Payment[];
  agreements: Agreement[];
  repairs: Repair[];
}

/** Read all four tables at once. The first error wins; the rest still come back. */
export async function readRecords(): Promise<{ records: Records; error?: string }> {
  const [units, payments, agreements, repairs] = await Promise.all([
    query<Unit>('units'),
    query<Payment>('payments'),
    query<Agreement>('agreements'),
    query<Repair>('repairs'),
  ]);
  return {
    records: {
      units: units.rows,
      payments: payments.rows,
      agreements: agreements.rows,
      repairs: repairs.rows,
    },
    error: units.error ?? payments.error ?? agreements.error ?? repairs.error,
  };
}

/** Look places up by reference, so a charge or a repair can name its address. */
export function unitsById(units: Unit[]): Map<string, Unit> {
  return new Map(units.map((unit) => [unit.id, unit]));
}

/** Still owed, whatever has been done about it. A sent reminder is not a payment. */
export function isBehind(payment: Payment): boolean {
  return payment.status !== 'Paid';
}

/* ------------------------------------------------------------------------- *
 * Actions
 * ------------------------------------------------------------------------- */

/** What `send_reminder` answers with. */
interface ReminderResult {
  ok?: boolean;
  reason?: string;
}

/**
 * Chase one late charge.
 *
 * This is the only call in the app that changes anything, and it deliberately returns
 * nothing useful: the caller re-reads the table afterwards, because the record is the
 * truth and a screen that patches itself will eventually disagree with it.
 */
export async function sendReminder(paymentId: string): Promise<{ ok: boolean; problem?: string }> {
  const answer = await call<ReminderResult>('send_reminder', { paymentId });
  if (answer.error) return { ok: false, problem: answer.error };
  if (answer.result?.ok !== true) {
    return { ok: false, problem: answer.result?.reason ?? 'the reminder did not go out' };
  }
  return { ok: true };
}
