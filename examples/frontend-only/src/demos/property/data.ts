/**
 * Northwind Property Group's records, and the one action the app can take.
 *
 * Everything here is a hand-written literal and nothing is drawn at runtime: the agent
 * quotes these numbers out loud in the chat, so they have to still be true when a
 * visitor counts the rows. The conformance check greps this file for random draws and
 * checks every date in it falls in 2026.
 *
 * The records are a frozen snapshot taken on March 16, 2026 - see `TODAY` in each stage's
 * `lib/format.ts`, which is what "how many days late" and "ending within 60 days" are
 * measured against. Freezing the clock is why the board says the same thing today as it
 * will next year.
 *
 * The dataset is mutable and lives as long as the page does: `send_reminder` really does
 * change a row, and that is the whole point of the last build step.
 */

import type { CallHandler, Dataset } from '../../mock/types';

/* ------------------------------------------------------------------------- *
 * Row shapes
 * ------------------------------------------------------------------------- */

/** One place Northwind rents out. */
export interface UnitRow extends Record<string, unknown> {
  /** The reference on the paperwork, e.g. `"MC-01"`. */
  id: string;
  /** Which building it belongs to. */
  building: string;
  /** The apartment or house number within that building. */
  unit: string;
  /** Who lives there. Empty when nobody does. */
  renter: string;
  /** Monthly rent, in whole dollars. */
  rent: number;
  /** `"Rented out"` or `"Empty"`. */
  status: string;
}

/** This month's rent charge for one rented place. */
export interface PaymentRow extends Record<string, unknown> {
  /** Charge reference. */
  id: string;
  /** The place it is for. */
  unitId: string;
  /** How much is owed, in whole dollars. */
  amountDue: number;
  /** The day it was due. */
  dueDate: string;
  /** Days past the due date. Zero once it is paid. */
  daysLate: number;
  /** `"Paid"`, `"Late"`, or `"Reminder sent"`. */
  status: string;
  /** The day a reminder went out, once one has. */
  remindedOn?: string;
}

/** The renter's agreement for one place. */
export interface AgreementRow extends Record<string, unknown> {
  /** Agreement reference. */
  id: string;
  /** The place it covers. */
  unitId: string;
  /** The last day it runs to. */
  endDate: string;
  /** What the renter has said about the end: staying, leaving, or nothing yet. */
  plan: string;
}

/** Something reported as broken in one of the places. */
export interface RepairRow extends Record<string, unknown> {
  /** Job reference. */
  id: string;
  /** The place it was reported at. */
  unitId: string;
  /** What is wrong, in the words it was reported in. */
  problem: string;
  /** The day it was reported. */
  reportedDate: string;
  /** `"Open"`, `"Scheduled"`, or `"Done"`. */
  status: string;
  /** Who or what the job is waiting on. */
  waitingOn: string;
}

/* ------------------------------------------------------------------------- *
 * The places: 30 across four buildings, 28 of them rented out
 * ------------------------------------------------------------------------- */

const units: UnitRow[] = [
  { id: 'MC-01', building: 'Maple Court', unit: 'Apartment 1', renter: 'Ada Nowak', rent: 925, status: 'Rented out' },
  { id: 'MC-02', building: 'Maple Court', unit: 'Apartment 2', renter: 'Ben Harding', rent: 950, status: 'Rented out' },
  { id: 'MC-03', building: 'Maple Court', unit: 'Apartment 3', renter: 'Chloe Ferrand', rent: 900, status: 'Rented out' },
  { id: 'MC-04', building: 'Maple Court', unit: 'Apartment 4', renter: 'Dev Raman', rent: 1010, status: 'Rented out' },
  { id: 'MC-05', building: 'Maple Court', unit: 'Apartment 5', renter: 'Elsie Bourne', rent: 875, status: 'Rented out' },
  { id: 'MC-06', building: 'Maple Court', unit: 'Apartment 6', renter: '', rent: 995, status: 'Empty' },
  { id: 'MC-07', building: 'Maple Court', unit: 'Apartment 7', renter: 'Femi Adeyemi', rent: 940, status: 'Rented out' },
  { id: 'MC-08', building: 'Maple Court', unit: 'Apartment 8', renter: 'Greta Lindqvist', rent: 960, status: 'Rented out' },

  { id: 'HV-01', building: 'Harbor View', unit: 'Apartment 1', renter: 'Hana Okafor', rent: 1180, status: 'Rented out' },
  { id: 'HV-02', building: 'Harbor View', unit: 'Apartment 2', renter: 'Ivan Petrov', rent: 1150, status: 'Rented out' },
  { id: 'HV-03', building: 'Harbor View', unit: 'Apartment 3', renter: 'Jonas Berg', rent: 1210, status: 'Rented out' },
  { id: 'HV-04', building: 'Harbor View', unit: 'Apartment 4', renter: 'Kayla Mensah', rent: 1095, status: 'Rented out' },
  { id: 'HV-05', building: 'Harbor View', unit: 'Apartment 5', renter: 'Liam Doherty', rent: 1240, status: 'Rented out' },
  { id: 'HV-06', building: 'Harbor View', unit: 'Apartment 6', renter: 'Mira Sandhu', rent: 1130, status: 'Rented out' },
  { id: 'HV-07', building: 'Harbor View', unit: 'Apartment 7', renter: 'Noor Haddad', rent: 1175, status: 'Rented out' },
  { id: 'HV-08', building: 'Harbor View', unit: 'Apartment 8', renter: 'Omar Vasquez', rent: 1205, status: 'Rented out' },

  { id: 'OT-01', building: 'Oak Terrace', unit: 'House 12', renter: 'Priya Nair', rent: 1400, status: 'Rented out' },
  { id: 'OT-02', building: 'Oak Terrace', unit: 'House 14', renter: 'Quinn Delaney', rent: 1350, status: 'Rented out' },
  { id: 'OT-03', building: 'Oak Terrace', unit: 'House 16', renter: 'Rosa Iglesias', rent: 1325, status: 'Rented out' },
  { id: 'OT-04', building: 'Oak Terrace', unit: 'House 18', renter: 'Sam Whitlock', rent: 1475, status: 'Rented out' },
  { id: 'OT-05', building: 'Oak Terrace', unit: 'House 20', renter: 'Tomas Nowicki', rent: 1290, status: 'Rented out' },
  { id: 'OT-06', building: 'Oak Terrace', unit: 'House 22', renter: 'Ursula Kane', rent: 1440, status: 'Rented out' },
  { id: 'OT-07', building: 'Oak Terrace', unit: 'House 24', renter: 'Viktor Halloran', rent: 1380, status: 'Rented out' },

  { id: 'RM-01', building: 'Riverside Mews', unit: 'House 1', renter: 'Wendy Osei', rent: 1520, status: 'Rented out' },
  { id: 'RM-02', building: 'Riverside Mews', unit: 'House 2', renter: 'Xavier Lund', rent: 1495, status: 'Rented out' },
  { id: 'RM-03', building: 'Riverside Mews', unit: 'House 3', renter: 'Yasmin Cole', rent: 1550, status: 'Rented out' },
  { id: 'RM-04', building: 'Riverside Mews', unit: 'House 4', renter: 'Zach Ferreira', rent: 1460, status: 'Rented out' },
  { id: 'RM-05', building: 'Riverside Mews', unit: 'House 5', renter: '', rent: 1585, status: 'Empty' },
  { id: 'RM-06', building: 'Riverside Mews', unit: 'House 6', renter: 'Anya Volkov', rent: 1510, status: 'Rented out' },
  { id: 'RM-07', building: 'Riverside Mews', unit: 'House 7', renter: 'Brendan Foy', rent: 1475, status: 'Rented out' },
];

/* ------------------------------------------------------------------------- *
 * The money: one charge per rented place. Nine are behind, $10,725 in total
 * ------------------------------------------------------------------------- */

const payments: PaymentRow[] = [
  { id: 'P-3001', unitId: 'MC-01', amountDue: 925, dueDate: '2026-03-01', daysLate: 0, status: 'Paid' },
  { id: 'P-3002', unitId: 'MC-02', amountDue: 950, dueDate: '2026-03-01', daysLate: 15, status: 'Late' },
  { id: 'P-3003', unitId: 'MC-03', amountDue: 900, dueDate: '2026-03-01', daysLate: 0, status: 'Paid' },
  { id: 'P-3004', unitId: 'MC-04', amountDue: 1010, dueDate: '2026-03-01', daysLate: 0, status: 'Paid' },
  { id: 'P-3005', unitId: 'MC-05', amountDue: 875, dueDate: '2026-02-01', daysLate: 43, status: 'Late' },
  { id: 'P-3006', unitId: 'MC-07', amountDue: 940, dueDate: '2026-03-12', daysLate: 4, status: 'Late' },
  { id: 'P-3007', unitId: 'MC-08', amountDue: 960, dueDate: '2026-03-01', daysLate: 0, status: 'Paid' },

  { id: 'P-3008', unitId: 'HV-01', amountDue: 1180, dueDate: '2026-03-05', daysLate: 0, status: 'Paid' },
  { id: 'P-3009', unitId: 'HV-02', amountDue: 1150, dueDate: '2026-03-05', daysLate: 0, status: 'Paid' },
  { id: 'P-3010', unitId: 'HV-03', amountDue: 1210, dueDate: '2026-01-01', daysLate: 74, status: 'Late' },
  { id: 'P-3011', unitId: 'HV-04', amountDue: 1095, dueDate: '2026-03-05', daysLate: 0, status: 'Paid' },
  { id: 'P-3012', unitId: 'HV-05', amountDue: 1240, dueDate: '2026-03-05', daysLate: 0, status: 'Paid' },
  { id: 'P-3013', unitId: 'HV-06', amountDue: 1130, dueDate: '2026-03-05', daysLate: 11, status: 'Late' },
  { id: 'P-3014', unitId: 'HV-07', amountDue: 1175, dueDate: '2026-03-05', daysLate: 0, status: 'Paid' },
  { id: 'P-3015', unitId: 'HV-08', amountDue: 1205, dueDate: '2026-03-05', daysLate: 0, status: 'Paid' },

  { id: 'P-3016', unitId: 'OT-01', amountDue: 1400, dueDate: '2026-03-03', daysLate: 0, status: 'Paid' },
  { id: 'P-3017', unitId: 'OT-02', amountDue: 1350, dueDate: '2026-02-20', daysLate: 24, status: 'Late' },
  { id: 'P-3018', unitId: 'OT-03', amountDue: 1325, dueDate: '2026-03-03', daysLate: 0, status: 'Paid' },
  { id: 'P-3019', unitId: 'OT-04', amountDue: 1475, dueDate: '2026-03-03', daysLate: 0, status: 'Paid' },
  { id: 'P-3020', unitId: 'OT-05', amountDue: 1290, dueDate: '2026-02-05', daysLate: 39, status: 'Late' },
  { id: 'P-3021', unitId: 'OT-06', amountDue: 1440, dueDate: '2026-03-03', daysLate: 0, status: 'Paid' },
  { id: 'P-3022', unitId: 'OT-07', amountDue: 1380, dueDate: '2026-03-03', daysLate: 0, status: 'Paid' },

  { id: 'P-3023', unitId: 'RM-01', amountDue: 1520, dueDate: '2026-03-09', daysLate: 7, status: 'Late' },
  { id: 'P-3024', unitId: 'RM-02', amountDue: 1495, dueDate: '2026-03-01', daysLate: 0, status: 'Paid' },
  { id: 'P-3025', unitId: 'RM-03', amountDue: 1550, dueDate: '2026-03-01', daysLate: 0, status: 'Paid' },
  { id: 'P-3026', unitId: 'RM-04', amountDue: 1460, dueDate: '2026-01-05', daysLate: 70, status: 'Late' },
  { id: 'P-3027', unitId: 'RM-06', amountDue: 1510, dueDate: '2026-03-01', daysLate: 0, status: 'Paid' },
  { id: 'P-3028', unitId: 'RM-07', amountDue: 1475, dueDate: '2026-03-01', daysLate: 0, status: 'Paid' },
];

/* ------------------------------------------------------------------------- *
 * The agreements: one per rented place. Five end within 60 days of March 16
 * ------------------------------------------------------------------------- */

const agreements: AgreementRow[] = [
  { id: 'A-4001', unitId: 'MC-01', endDate: '2026-08-31', plan: 'Staying' },
  { id: 'A-4002', unitId: 'MC-02', endDate: '2026-09-30', plan: 'Not said yet' },
  { id: 'A-4003', unitId: 'MC-03', endDate: '2026-03-31', plan: 'Not said yet' },
  { id: 'A-4004', unitId: 'MC-04', endDate: '2026-07-31', plan: 'Staying' },
  { id: 'A-4005', unitId: 'MC-05', endDate: '2026-10-31', plan: 'Not said yet' },
  { id: 'A-4006', unitId: 'MC-07', endDate: '2026-06-30', plan: 'Staying' },
  { id: 'A-4007', unitId: 'MC-08', endDate: '2026-05-11', plan: 'Staying' },

  { id: 'A-4008', unitId: 'HV-01', endDate: '2026-04-14', plan: 'Leaving' },
  { id: 'A-4009', unitId: 'HV-02', endDate: '2026-11-30', plan: 'Staying' },
  { id: 'A-4010', unitId: 'HV-03', endDate: '2026-08-15', plan: 'Not said yet' },
  { id: 'A-4011', unitId: 'HV-04', endDate: '2026-09-15', plan: 'Staying' },
  { id: 'A-4012', unitId: 'HV-05', endDate: '2026-12-31', plan: 'Staying' },
  { id: 'A-4013', unitId: 'HV-06', endDate: '2026-07-15', plan: 'Not said yet' },
  { id: 'A-4014', unitId: 'HV-07', endDate: '2026-10-15', plan: 'Staying' },
  { id: 'A-4015', unitId: 'HV-08', endDate: '2026-06-30', plan: 'Staying' },

  { id: 'A-4016', unitId: 'OT-01', endDate: '2026-11-30', plan: 'Staying' },
  { id: 'A-4017', unitId: 'OT-02', endDate: '2026-08-31', plan: 'Not said yet' },
  { id: 'A-4018', unitId: 'OT-03', endDate: '2026-12-15', plan: 'Staying' },
  { id: 'A-4019', unitId: 'OT-04', endDate: '2026-04-30', plan: 'Not said yet' },
  { id: 'A-4020', unitId: 'OT-05', endDate: '2026-09-30', plan: 'Not said yet' },
  { id: 'A-4021', unitId: 'OT-06', endDate: '2026-07-31', plan: 'Staying' },
  { id: 'A-4022', unitId: 'OT-07', endDate: '2026-10-31', plan: 'Staying' },

  { id: 'A-4023', unitId: 'RM-01', endDate: '2026-11-15', plan: 'Staying' },
  { id: 'A-4024', unitId: 'RM-02', endDate: '2026-05-09', plan: 'Staying' },
  { id: 'A-4025', unitId: 'RM-03', endDate: '2026-12-31', plan: 'Staying' },
  { id: 'A-4026', unitId: 'RM-04', endDate: '2026-06-30', plan: 'Not said yet' },
  { id: 'A-4027', unitId: 'RM-06', endDate: '2026-09-30', plan: 'Staying' },
  { id: 'A-4028', unitId: 'RM-07', endDate: '2026-08-15', plan: 'Staying' },
];

/* ------------------------------------------------------------------------- *
 * The repairs: 26 jobs. Six have been waiting more than a week
 * ------------------------------------------------------------------------- */

const repairs: RepairRow[] = [
  // Waiting more than a week, longest first.
  { id: 'R-5001', unitId: 'RM-03', problem: 'Water stain on the back bedroom wall', reportedDate: '2026-02-16', status: 'Open', waitingOn: 'Contractor' },
  { id: 'R-5002', unitId: 'OT-03', problem: 'Water heater will not heat up', reportedDate: '2026-02-24', status: 'Open', waitingOn: 'Plumber' },
  { id: 'R-5003', unitId: 'OT-06', problem: 'Roof shingle came loose in the wind', reportedDate: '2026-02-27', status: 'Scheduled', waitingOn: 'Roofer' },
  { id: 'R-5004', unitId: 'HV-02', problem: 'Front door lock sticks', reportedDate: '2026-03-02', status: 'Scheduled', waitingOn: 'Locksmith' },
  { id: 'R-5005', unitId: 'MC-04', problem: 'Kitchen faucet drips all night', reportedDate: '2026-03-05', status: 'Open', waitingOn: 'Plumber' },
  { id: 'R-5006', unitId: 'HV-07', problem: 'Shower runs cold', reportedDate: '2026-03-06', status: 'Open', waitingOn: 'A part to arrive' },

  // Reported in the last week.
  { id: 'R-5007', unitId: 'OT-07', problem: 'Exhaust fan very loud', reportedDate: '2026-03-09', status: 'Scheduled', waitingOn: 'A part to arrive' },
  { id: 'R-5008', unitId: 'HV-05', problem: 'Radiator cold at the top', reportedDate: '2026-03-10', status: 'Scheduled', waitingOn: 'Plumber' },
  { id: 'R-5009', unitId: 'HV-08', problem: 'Bathroom fan not clearing the steam', reportedDate: '2026-03-10', status: 'Open', waitingOn: 'Handyman' },
  { id: 'R-5010', unitId: 'MC-02', problem: 'Window handle snapped', reportedDate: '2026-03-11', status: 'Open', waitingOn: 'Handyman' },
  { id: 'R-5011', unitId: 'RM-06', problem: 'Fence panel blown over', reportedDate: '2026-03-11', status: 'Open', waitingOn: 'Handyman' },
  { id: 'R-5012', unitId: 'OT-01', problem: 'Yard gate off its hinge', reportedDate: '2026-03-12', status: 'Open', waitingOn: 'Handyman' },
  { id: 'R-5013', unitId: 'MC-01', problem: 'Hallway light flickers', reportedDate: '2026-03-13', status: 'Open', waitingOn: 'Electrician' },
  { id: 'R-5014', unitId: 'HV-04', problem: 'Door buzzer does not ring', reportedDate: '2026-03-14', status: 'Open', waitingOn: 'Electrician' },
  { id: 'R-5015', unitId: 'MC-07', problem: 'Oven door will not close', reportedDate: '2026-03-14', status: 'Open', waitingOn: 'The renter to pick a time' },
  { id: 'R-5016', unitId: 'RM-01', problem: 'Driveway light out', reportedDate: '2026-03-15', status: 'Open', waitingOn: 'Electrician' },

  // Finished.
  { id: 'R-5017', unitId: 'MC-05', problem: 'Bathroom sink clogged', reportedDate: '2026-01-12', status: 'Done', waitingOn: 'Nobody' },
  { id: 'R-5018', unitId: 'OT-04', problem: 'Gutter overflowing', reportedDate: '2026-01-15', status: 'Done', waitingOn: 'Nobody' },
  { id: 'R-5019', unitId: 'MC-08', problem: 'Smoke alarm beeping', reportedDate: '2026-01-20', status: 'Done', waitingOn: 'Nobody' },
  { id: 'R-5020', unitId: 'RM-02', problem: 'Water heater pressure low', reportedDate: '2026-01-26', status: 'Done', waitingOn: 'Nobody' },
  { id: 'R-5021', unitId: 'HV-06', problem: 'Leak under the kitchen sink', reportedDate: '2026-01-28', status: 'Done', waitingOn: 'Nobody' },
  { id: 'R-5022', unitId: 'HV-01', problem: 'Elevator door slow to close', reportedDate: '2026-02-02', status: 'Done', waitingOn: 'Nobody' },
  { id: 'R-5023', unitId: 'RM-07', problem: 'Broken paving stone', reportedDate: '2026-02-05', status: 'Done', waitingOn: 'Nobody' },
  { id: 'R-5024', unitId: 'HV-03', problem: 'Kitchen cabinet door off', reportedDate: '2026-02-09', status: 'Done', waitingOn: 'Nobody' },
  { id: 'R-5025', unitId: 'OT-02', problem: 'Back door drafty', reportedDate: '2026-02-11', status: 'Done', waitingOn: 'Nobody' },
  { id: 'R-5026', unitId: 'OT-05', problem: 'Doorbell battery dead', reportedDate: '2026-02-19', status: 'Done', waitingOn: 'Nobody' },
];

/* ------------------------------------------------------------------------- *
 * The tables and the action
 * ------------------------------------------------------------------------- */

/** The tables the preview app can read over the bridge. */
export const dataset: Dataset = { units, payments, agreements, repairs };

/** The day these records were taken. Reminders are stamped with it. */
export const SNAPSHOT_DAY = '2026-03-16';

/**
 * Chase one late payment.
 *
 * This is the line that makes the last build step more than a chart: it changes a
 * record. The app calls it, re-reads the table, and the row it just acted on comes back
 * saying `Reminder sent`.
 */
const sendReminder: CallHandler = (data, args) => {
  const paymentId = String(args.paymentId ?? '');
  const rows = data.payments as PaymentRow[];
  const row = rows.find((payment) => payment.id === paymentId);
  if (!row) return { ok: false, paymentId, reason: 'no charge with that reference' };
  if (row.status === 'Paid') return { ok: false, paymentId, reason: 'that one is already paid' };
  if (row.status === 'Reminder sent') {
    return { ok: false, paymentId, reason: 'a reminder already went out for that one' };
  }
  row.status = 'Reminder sent';
  row.remindedOn = SNAPSHOT_DAY;
  return { ok: true, paymentId, status: row.status, remindedOn: row.remindedOn };
};

/** The actions the generated app can take. */
export const calls: Record<string, CallHandler> = { send_reminder: sendReminder };
