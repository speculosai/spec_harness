/**
 * The shapes a demo is written in.
 *
 * A demo is two halves that never mix: a DOM-free half (`script.ts` + `data.ts`) that
 * the conformance check runs under Node, and a JSX half (`demo.tsx`) that only adds a
 * brand mark. Everything in this file belongs to the first half, which is why the one
 * React reference below is a type-only import - it disappears at compile time.
 */

import type { ReactNode } from 'react';

import type { CompiledStage, StageRegistry } from '../../stages-plugin';

export type { CompiledStage, StageRegistry };

/* ------------------------------------------------------------------------- *
 * The scripted conversation
 * ------------------------------------------------------------------------- */

/** One clickable chip. The label is what gets sent as the user's next message. */
export interface DemoChoice {
  /** A short stable slug, for the package's build-intent heuristics. */
  id?: string;
  /** The chip text - phrased as the visitor speaking, nine words or fewer. */
  label: string;
  /** Optional sub-copy shown next to the label. */
  description?: string;
}

/** One scripted assistant turn. */
export interface DemoTurn {
  /** Markdown streamed before any tool activity. */
  before: string;
  /** Advance the project to this stage index. Omit for a text-only turn. */
  toStage?: number;
  /** Markdown streamed after the tool activity - the "what just happened" beat. */
  after?: string;
  /** Rendered as a ```harness-choices fence appended to the turn's text. */
  choices?: DemoChoice[];
}

/** A table of rows, exactly as the preview app receives it over the bridge. */
export type Dataset = Record<string, Array<Record<string, unknown>>>;

/** An action the generated app can take. Mutates `dataset` and returns a result. */
export type CallHandler = (dataset: Dataset, args: Record<string, unknown>) => unknown;

/** Everything the mock backend needs to run one demo. Contains no DOM references. */
export interface DemoDefinition {
  /** The demo id; also the directory name and the URL hash (`#/property`). */
  id: string;
  /** The project the workspace opens, e.g. `"property-demo"`. */
  projectId: string;
  /** `Project.name`. */
  projectName: string;
  /** Seeded into history as the first assistant message. Must offer choices. */
  welcome: DemoTurn;
  /** Played in order, one per `POST /chat`. */
  turns: DemoTurn[];
  /** Streamed once the script is exhausted. Repeats. */
  fallback: string;
  /** The mocked tables. Mutable for the life of the page. */
  dataset: Dataset;
  /** The actions the last build stage calls. */
  calls: Record<string, CallHandler>;
}

/* ------------------------------------------------------------------------- *
 * Landing-page copy
 * ------------------------------------------------------------------------- */

/** One landing card. The landing page renders these fields and nothing else. */
export interface DemoCard {
  /** What the demo builds, in plain words. */
  title: string;
  /** The company, and what it does, in one line. */
  company: string;
  /** Why a company like this embeds a builder. Two or three sentences. */
  why: string;
  /** Why a fixed dashboard cannot do this. One or two sentences. */
  dashboard: string;
  /** The three things the visitor clicks through, in order. */
  steps: string[];
  /** The vertical's accent color, as a hex string. */
  accent: string;
}

/* ------------------------------------------------------------------------- *
 * Conformance
 * ------------------------------------------------------------------------- */

/**
 * How `npm run check` exercises one of a demo's actions end to end.
 *
 * The check cannot guess that `send_reminder` wants a `paymentId` and changes the
 * `payments` table, so each demo says so. It is three lines per action, and it is what
 * proves the action path - the step a chart can never do - actually mutates data.
 */
export interface DemoProbe {
  /** The action name, exactly as the generated app calls it. */
  call: string;
  /** Build arguments from the live dataset, so the check uses a real row. */
  args: (dataset: Dataset) => Record<string, unknown>;
  /** The table the action changes; the check re-queries it and expects a difference. */
  table: string;
}

/** The DOM-free half of a demo module (`script.ts`). */
export interface DemoScript {
  /** The scripted conversation, dataset and actions. */
  definition: DemoDefinition;
  /** The landing-card copy. */
  card: DemoCard;
  /** Workspace label overrides for this demo. */
  strings: Record<string, string>;
  /** How the conformance check exercises this demo's actions. At least one. */
  probes: DemoProbe[];
}

/** A demo as the host app consumes it: the script plus its brand mark. */
export interface VerticalDemo extends DemoScript {
  /** Brand name and logo slot for `<HarnessProvider brand={...}>`. */
  brand: { name: string; Logo: ReactNode };
}
