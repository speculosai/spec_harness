/**
 * The factory demo: the scripted conversation, the landing-card copy, and the
 * arguments this vertical has to make.
 *
 * DOM-free on purpose. `scripts/check-entry.ts` imports this module directly under
 * Node to replay every turn against the mock backend, so nothing here may reach for
 * `window` - the JSX half of the demo lives next door in `demo.tsx`.
 *
 * Every number the agent quotes below is true of `./data.ts`: 558 minutes lost across
 * 22 stops in the running week, 175 of them on the press on line 3, 245 pieces made
 * against a plan of 270 on Friday, March 6, and on line 1 alone 60 minutes of blade
 * changes against the edge bander's 64. If the records change, this text changes.
 */

import type { DemoCard, DemoDefinition, DemoProbe } from '../../mock/types';
import { calls, dataset } from './data';
import type { StopRow } from './data';

/** The scripted conversation. One click per turn, start to finish. */
export const definition: DemoDefinition = {
  id: 'factory',
  projectId: 'factory-demo',
  projectName: 'Ashford Works',

  welcome: {
    before: [
      'This is the workspace for Ashford Works - three lines, making flat-pack shelves, dining chairs and bed frames. The records are already connected: what each line made against its plan, and every time a machine stopped.',
      'Nothing is built yet. Tell me what you want to see and I will write it - the panel on the left runs the real app as the files land.',
      'Where do you want to start?',
    ].join('\n\n'),
    choices: [{ id: 'today', label: 'Show me how each line did today' }],
  },

  turns: [
    /* -- 1: today, line by line ------------------------------------------- */
    {
      before: [
        'Right. Three tables to read - the lines, what each one made against plan, and every stop - and one page to put today on: a bar pair per line for made against planned, with the stops that explain the gap listed underneath it.',
        'The day is not written into the code. The app takes the most recent day in the records and calls that today, so the same page is still right tomorrow. Three files.',
      ].join('\n\n'),
      toStage: 1,
      after: [
        'Today is Friday, March 6: 245 pieces made against a plan of 270. Line 1 is 12 short, line 2 is 7, line 3 is 6, and the six stops listed under them cost 121 minutes between them.',
        'That is the gap. It is not the pattern - one day tells you which line struggled, not what keeps happening to it. The stop records go back further than today, so there is more in there than this page is using.',
      ].join('\n\n'),
      choices: [
        { id: 'rank-reasons', label: 'Rank what stops us across the week' },
        { id: 'worst-machine', label: 'Which machine costs us the most?' },
      ],
    },

    /* -- 2: the week, ranked by what it cost ------------------------------ */
    {
      before: [
        'Then we widen it to the week. The records hold last week too, so the app works out which Monday the running week started on and counts from there - that rule is four lines, and it is the difference between "this week" and "everything we ever wrote down".',
        'Under today\'s cards: every stop reason ranked by the minutes it cost, a filter to look at one line at a time, and a plain sentence naming the machine behind the worst of it. Two new files, two changed.',
      ].join('\n\n'),
      toStage: 2,
      after: [
        '558 minutes lost this week across 22 stops. Low air pressure is top by a distance - 175 minutes over five stops - and every one of those five stops is the same machine: the press on line 3. One machine is close to a third of the week. Last week it cost 35 minutes, so this is new.',
        'Filter to line 1 and the shape changes completely. Blade changes on the panel saw cost the most minutes there - 60 over three stops - while the machine losing the most is the edge bander, 64 minutes, most of it glue jams. That is what the filter is for: the same question, asked about the part of the floor you are standing on.',
        'Now the awkward part. You can see it, and the page still cannot do anything about it.',
      ].join('\n\n'),
      choices: [
        { id: 'book-check', label: 'Let me book a check on a machine' },
        { id: 'press-check', label: 'Get someone to look at the press' },
      ],
    },

    /* -- 3: the action - book a check ------------------------------------- */
    {
      before: [
        'Agreed - a page that only tells you is half a tool. I am adding the machines behind those stops as a ranked list under the same line filter, each with a Schedule a check button, and a planned checks list beneath it.',
        'The button tells the records to book a check on that machine, and then the page reads all four tables again. What you see afterward is what was written down, not something I kept in memory. Two new files, three changed.',
      ].join('\n\n'),
      toStage: 3,
      after: [
        'Try the press. The check goes on the schedule for Monday, March 9, that row swaps its button for "Check booked - Monday, March 9", and the planned checks list underneath picks it up. The sander was already booked before we started, which is why its row shows a date instead of a button.',
        'That is the line between this and a chart. A chart can put the press at the top of the list every day this week without one thing changing on the floor.',
      ].join('\n\n'),
      choices: [{ id: 'why-not-reports', label: "Couldn't our reports have told us this?" }],
    },

    /* -- 4: the closing beat. Text only, no choices, the demo ends here. --- */
    {
      before: [
        'Because "only the night shift, only stops longer than half an hour, only the machines that supplier serviced in January" is not a filter on a report somebody already built - it is new logic, and new logic is a ticket and a queue. By the time it lands the press has either been fixed or cost you another 175 minutes.',
        'And these questions belong to this floor. Nobody else has your three lines, your sizes, your shift schedule; the person holding the question is the one standing next to the machine, not an engineer in another building. That is why a company like this puts a builder inside its own tools instead of buying one more report - the question and the tool arrive in the same minute.',
        'The other half is the button. Every chart ever drawn can tell you the press is the worst machine on the floor. Only a tool can book the check.',
        'Everything I wrote is on the right: open a file to read it, or use the version list to step back to any point in this conversation and watch the preview rebuild. The other two demos - an online store keeping orders moving, and a company that rents out homes - are behind the arrow at the top left.',
      ].join('\n\n'),
    },
  ],

  fallback:
    'This guided demo has ended - restore a version from the timeline on the right, or use the arrow at the top left to pick another demo.',

  dataset,
  calls,
};

/** The landing card. The landing page renders these fields and nothing else. */
export const card: DemoCard = {
  title: 'Lose less time to stops',
  company: 'Ashford Works - three lines making household furniture',
  why:
    'The questions are about this floor - this press, this week, this shift - and they change as the work changes. The person asking runs the line.',
  dashboard:
    '"Only the night shift, only stops over half an hour" is new logic, not a filter - and a chart cannot book the check.',
  steps: [
    'See today, line by line, against the plan',
    'Rank the week by the time each stop cost',
    'Book a check on the machine costing the most',
  ],
  accent: '#b45309',
};

/** One label override, so the composer speaks this company's language. */
export const strings: Record<string, string> = {
  'composer.placeholder': 'Ask for what you need - e.g. "which machine cost us the most this week"',
};

/** What `npm run check` runs to prove the action really mutates the data. */
export const probes: DemoProbe[] = [
  {
    call: 'schedule_check',
    // A real machine off a real stop, the same way the app passes one from a clicked row.
    args: (data) => ({ machine: String((data.stops[0] as StopRow | undefined)?.machine ?? '') }),
    table: 'checks',
  },
];
