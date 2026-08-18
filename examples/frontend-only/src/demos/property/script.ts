/**
 * The property demo: the scripted conversation, the landing-card copy, and the two
 * arguments this vertical has to make.
 *
 * DOM-free on purpose. `scripts/check-entry.ts` imports this module directly under Node
 * to replay every turn against the mock backend, so nothing here may reach for `window`
 * - the JSX half of the demo lives next door in `demo.tsx`.
 *
 * Every figure the agent says out loud is true of `./data.ts`: nine unpaid charges
 * worth $10,725, five agreements ending inside sixty days, six repairs open more
 * than a week. If a row changes, the narration changes with it.
 */

import type { DemoCard, DemoDefinition, DemoProbe } from '../../mock/types';
import { calls, dataset } from './data';

/** The scripted conversation. One click per turn, start to finish. */
export const definition: DemoDefinition = {
  id: 'property',
  projectId: 'property-demo',
  projectName: 'Northwind Property Group',

  welcome: {
    before: [
      "This is Northwind Property Group's workspace. Northwind looks after thirty homes and apartments across four buildings - Maple Court, Harbor View, Oak Terrace and Riverside Mews - and twenty-eight of them are rented right now.",
      'Nothing is built yet. Tell me what you want to see and I will write the app for it - the files land in the panel on the right, and the working thing appears on the left a second or two later.',
      'Where do you want to start?',
    ].join('\n\n'),
    choices: [{ id: 'attention', label: 'Show me the places that need attention' }],
  },

  turns: [
    /* ---- 1. the attention board --------------------------------------- */
    {
      before: [
        'Good place to start. I will build a board with three columns: places behind on rent, agreements ending in the next sixty days, and repairs that have been open more than a week. Each column groups by building, because that is how you walk around them.',
        "The three rules go in a file of their own, so \"more than a week\" is one line to change when you decide it should be five days. Writing it now.",
      ].join('\n\n'),
      toStage: 1,
      after: [
        'It is running on the left. Nine of your twenty-eight rented places are behind - $10,725 owed. Five agreements end inside sixty days, and two of those renters have not said yet whether they are staying. Six repairs have been open more than a week; the longest is a water stain at Riverside Mews House 3, reported twenty-eight days ago.',
        'Nobody picked those three columns in advance. You said "needs attention", and I decided what that means for a company that rents places out. That decision is the tool.',
      ].join('\n\n'),
      choices: [
        { id: 'late-detail', label: 'Break down the late payments' },
        { id: 'worst-first', label: 'Sort the late ones worst first' },
      ],
    },

    /* ---- 2. the late-payment panel ------------------------------------ */
    {
      before: [
        'Fair - "nine places, $10,725" is a number, not a plan. I will add a panel under the board that splits the late payments by how long they have been overdue, adds up what each building is carrying, and lists every charge worst first.',
        'Worst means longest overdue, not largest: a small amount unpaid since January is the one that needs the phone call. Two small charts, drawn straight from the charges, and the sums go next to the rules so the totals on the panel and the count on the board cannot drift apart.',
      ].join('\n\n'),
      toStage: 2,
      after: [
        'Two of the nine are more than sixty days overdue - $2,670 between them, one at Harbor View and one at Riverside Mews. The oldest is Harbor View Apartment 3: $1,210, seventy-four days. Three more sit in the eight-to-thirty-day band, which is $3,430 and mostly this month slipping.',
        'By building, Riverside Mews is carrying the most at $2,980 across two houses, then Maple Court at $2,765 across three. That is a different order from "which building has the most late places", and it is the order you would actually work in.',
        'So you can see the problem now. You still cannot do anything about it from here.',
      ].join('\n\n'),
      choices: [
        { id: 'send-reminders', label: 'Let me send reminders from here' },
        { id: 'chase', label: 'Add a button to chase them' },
      ],
    },

    /* ---- 3. the action ------------------------------------------------ */
    {
      before: [
        'That is the right instinct, and it is where a screen stops being a report. I will teach the data side one new thing to do, and put a "Send a reminder" button beside every late charge.',
        'Pressing it writes to the record, and then the page re-reads all four tables. The chip flips to "Reminder sent", the button goes quiet, and the totals above are worked out again from what the record now says - not from what the screen was hoping. If the write ever failed, you would see it fail.',
      ].join('\n\n'),
      toStage: 3,
      after: [
        'Try it on the left. Send a reminder to Harbor View Apartment 3 - the seventy-four-day one, at the top - and watch the chip change and the button switch off. It will not fire twice: the record now says a reminder went out, and the row reads it back on every load.',
        'That is the line no chart crosses. A chart can show you $10,725 owed across nine places. It cannot send anything.',
      ].join('\n\n'),
      choices: [
        { id: 'why-not-dashboard', label: 'Why can we not just filter the dashboard?' },
        { id: 'recap', label: 'What did we just build?' },
      ],
    },

    /* ---- 4. the closing beat: no choices, the demo ends here ---------- */
    {
      before: [
        'Because nobody chose those columns in advance. A dashboard is built once, out of the questions somebody had the week it was built, and "the overdue money by building, worst first" was not on that list - Riverside Mews carrying $2,980, then Maple Court at $2,765. Putting it in that order is new logic rather than a filter over a chart that already exists, and new logic means a ticket and a three-week wait.',
        'Meanwhile the question keeps moving. This month it is late rent; next month it is the five agreements ending before the summer, or the jobs where the same plumber is what everyone is waiting on. The person holding those questions walks around the buildings; they are not an engineer, and they should not have to become one to get a list they can work from. That is what a builder inside their own software is for: the question and the tool arrive in the same minute.',
        'And the last thing we built sends a reminder and changes the record. No chart does that, however many filters you give it - it can put $10,725 across nine places in front of you every morning and still never send one of them anything.',
        'Three prompts, three versions, one working tool: a board that says what needs attention, a panel that says how bad the money is and where, and a button that does something about it - all reading Northwind\'s own records.',
        'Everything I wrote is in the panel on the right - open any file to read it. The version list steps back to any point in this conversation, including before the button existed. The other two demos take the same idea to an online store keeping orders moving, and a furniture factory losing hours to stopped machines.',
      ].join('\n\n'),
    },
  ],

  fallback:
    'This guided demo has ended - restore a version from the timeline on the right, or head back to try another demo.',

  dataset,
  calls,
};

/** The landing card. The landing page renders these fields and nothing else. */
export const card: DemoCard = {
  title: 'Look after the buildings',
  company: 'Northwind Property Group - thirty homes and apartments across four buildings',
  why:
    'The person chasing late rent walks the buildings, and their questions change most weeks - they cannot wait in a reporting queue.',
  dashboard:
    'Nobody ships "overdue money by building, worst first" as a filter - and a chart cannot send the reminder.',
  steps: [
    'Ask for a board of what needs attention',
    'Split the late payments by how overdue they are',
    'Send a reminder and watch the record change',
  ],
  accent: '#047857',
};

/** One label override, so the composer speaks this company's language. */
export const strings: Record<string, string> = {
  'composer.placeholder': 'Ask for what you need - e.g. "the late payments, worst first"',
};

/** What `npm run check` runs to prove the action really changes the records. */
export const probes: DemoProbe[] = [
  {
    call: 'send_reminder',
    // A real reference off a real row: the check is proving the write lands, not that
    // the handler tolerates made-up ids.
    args: (data) => ({
      paymentId: String(data.payments.find((row) => String(row.status) === 'Late')?.id ?? ''),
    }),
    table: 'payments',
  },
];
