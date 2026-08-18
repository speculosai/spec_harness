/**
 * The commerce demo: the scripted conversation, the landing-card copy, and the
 * arguments this vertical has to make.
 *
 * DOM-free on purpose. `scripts/check-entry.ts` imports this module directly under
 * Node to replay every turn against the mock backend, so nothing here may reach for
 * `window` - the JSX half of the demo lives next door in `demo.tsx`.
 *
 * Every figure the agent quotes is counted from `./data`: 36 orders, 8 of them stuck
 * for more than two days, $1,362 between them; 28 returns in the last two weeks,
 * 9 refunds waiting and $407 owed. If a row changes, these numbers change with it.
 */

import type { DemoCard, DemoDefinition, DemoProbe } from '../../mock/types';
import { calls, dataset } from './data';
import type { OrderRow, ReturnRow } from './data';

/** The scripted conversation. One click per turn, start to finish. */
export const definition: DemoDefinition = {
  id: 'commerce',
  projectId: 'commerce-demo',
  projectName: 'Bluebell Goods',

  welcome: {
    before: [
      'This is the operations workspace for Bluebell Goods, an online store selling things for the house. Your job is keeping orders moving: what has been paid for and has not gone out, what is coming back, and who is still owed money.',
      'Nothing is built yet. Tell me what you need to see and I will write it - the panel on the left runs the real app as the files land.',
      'Where should we start?',
    ].join('\n\n'),
    choices: [{ id: 'stuck', label: 'Show me the orders that are stuck' }],
  },

  turns: [
    {
      before: [
        'That is the right first question. I will read the order records and list everything that was paid for more than two days ago and never went out - grouped by what is holding it up, oldest first, with the money each one is worth.',
        'Two days is normal picking time here, so anything past that is a question somebody has to answer. Writing the app now.',
      ].join('\n\n'),
      toStage: 1,
      after: [
        'Eight of the thirty-six orders paid for in the last ten days never left the building. That is $1,362 sitting still, and the oldest has been waiting six days.',
        'Half of them are short of stock. The curtains, the pan and the throw are still on a truck, but the cream mugs landed on March 1. Two orders are held for a payment check and two have an address the carrier will not accept.',
        'Look at the last column: three of the eight say the problem is already cleared. Nobody has told the warehouse.',
      ].join('\n\n'),
      choices: [{ id: 'returns', label: 'Now show me what is coming back' }],
    },
    {
      before: [
        'Returns are the other half of this desk. I will keep the stuck list and add two sections under it: why things come back, ranked by how often, and the refunds people are still waiting on, longest wait at the top.',
        'The bars are drawn from the return records themselves, so the ranking moves when the returns do - it is not a picture of last month.',
      ].join('\n\n'),
      toStage: 2,
      after: [
        'Twenty-eight things came back in the last two weeks. Damaged in transit is the biggest reason by a distance: nine of the twenty-eight, against seven for the wrong item being sent. That is a packing problem, not a product problem.',
        'Nine refunds are still waiting for someone to approve them, $407 in total, and the oldest customer has been waiting nine days for their money.',
        'That is the number that costs you. A nine-day wait for a refund is what people write reviews about.',
      ].join('\n\n'),
      choices: [
        { id: 'act', label: 'Let me clear these from here' },
        { id: 'act-alt', label: 'Can it act, not just show?' },
      ],
    },
    {
      before: [
        'Yes, and that is where most reporting tools stop. Reading is the easy half; the useful half is doing something about what you have read. I will add two buttons: **Release** on an order whose problem is already cleared, and **Approve refund** on anything in the queue.',
        'Both write to the record and then the page reads all three tables again, so what you see afterwards is what the records say - not what the screen assumed happened.',
      ].join('\n\n'),
      toStage: 3,
      after: [
        'Three orders can go right now, $549 of goods between them, and nine refunds are waiting for a decision.',
        'Press **Release** on Marta Silva\'s order: the chip flips to Released, the stuck count drops from eight to seven, and the record behind it has changed. **Approve refund** does the same for the queue.',
        'That is the line a chart cannot cross.',
      ].join('\n\n'),
      choices: [{ id: 'why-not-dashboard', label: 'Why is this not on our dashboard?' }],
    },
    {
      // The closing turn: text only, no choices, so the demo ends cleanly.
      before: [
        'Because no filter can express the question you actually asked: paid more than two days ago, still sitting here, and the stock has already landed. The two-day rule is yours, and "the cream mugs came in on March 1" is a fact about this week - neither of them existed when somebody chose the charts. That is new logic, and new logic means a ticket, a queue and a wait of weeks, while the questions on this desk change with every promotion, every late supplier and every carrier that starts losing boxes.',
        'The person with the question is on the operations desk, not in engineering. They knew this morning that the mugs had landed. They should not have to explain that to a developer to get a list they can work from. That is why a store like Bluebell embeds a builder: the question and the tool turn up in the same ten minutes, and the tool can be thrown away when the promotion ends.',
        'And the last step is the one no chart can copy. A chart can show you that nine refunds are waiting; it cannot approve one. The button you pressed changed a real record, over the same connection the list reads through.',
        'Everything I wrote is in the file list on the right - open a file to read it, or use the version list to step back to any point in this conversation. The other two demos take the same idea to a company that rents out homes and to a furniture factory.',
      ].join('\n\n'),
    },
  ],

  fallback:
    'This guided demo has ended - restore a version from the timeline on the right, or head back to try another demo.',

  dataset,
  calls,
};

/** The landing card: this company, in the words a visitor will read first. */
export const card: DemoCard = {
  title: 'Keep the orders moving',
  company: 'Bluebell Goods - an online store for the house',
  why:
    'Every promotion, stock problem and new carrier brings a different question, and nobody on the operations desk is an engineer - the tool has to be written the day the question turns up.',
  dashboard:
    'No filter says "paid two days ago, still here, stock has landed" - and a chart cannot release the order.',
  steps: [
    'Ask for the orders that are stuck',
    'Add what is coming back and who is owed money',
    'Release an order and approve a refund, for real',
  ],
  accent: '#4338ca',
};

/** One label override, so the composer speaks this company's language. */
export const strings: Record<string, string> = {
  'composer.placeholder': 'Ask for what you need - e.g. "orders paid for but never shipped, oldest first"',
};

/**
 * What `npm run check` runs to prove the actions really mutate the data.
 *
 * Both probes pick a row the app itself would offer a button on - an order whose
 * problem is cleared, a refund nobody has approved - because both handlers refuse
 * anything else, exactly as the buttons do.
 */
export const probes: DemoProbe[] = [
  {
    call: 'release_order',
    args: (data) => {
      const orders = (data.orders ?? []) as OrderRow[];
      const ready = orders.find((order) => order.status === 'Not shipped' && order.clearedDate !== '');
      return { id: String(ready?.id ?? '') };
    },
    table: 'orders',
  },
  {
    call: 'approve_refund',
    args: (data) => {
      const returns = (data.returns ?? []) as ReturnRow[];
      const waiting = returns.find((entry) => entry.refundStatus === 'Waiting');
      return { id: String(waiting?.id ?? '') };
    },
    table: 'returns',
  },
];
