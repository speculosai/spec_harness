/**
 * Plan-mode choices: the fenced block the agent writes inside its own text, parsed out
 * into clickable chips.
 *
 * `spec/message-format.md` fixes the wire form (a ```` ```harness-choices ```` fence
 * holding a JSON array of `{id, label}`) and the legacy-alias read rule: the earlier
 * `speculos-choices` fence is baked into conversations that already exist, so a reader
 * MUST accept it forever and a writer MUST never emit it.
 */

import { CHOICES_FENCE, LEGACY_CHOICES_FENCE } from '../protocol';

/** One clickable option. */
export interface ChoiceOption {
  /** A short stable slug, when the agent supplied one. */
  id?: string;
  /** The text on the chip; also the answer sent back as the user's next message. */
  label: string;
  /** Optional sub-copy. */
  description?: string;
  /**
   * Whether picking this option should start the build. Set explicitly by the agent,
   * or inferred from the conventional `build` / `just-build` slugs the plan prompt
   * asks for, so the user is never stuck one more question away from a build.
   */
  build?: boolean;
}

/** A parsed choices block. */
export interface ChoiceSpec {
  /** The question, when the block carried one. The agent usually asks it in its text. */
  question?: string;
  /** The options. Never empty - a block that parses to nothing is left as code. */
  options: ChoiceOption[];
  /** Whether more than one option may be picked. */
  multi?: boolean;
}

/** A run of assistant text: markdown, a parsed choices block, or one still streaming. */
export type AssistantSegment =
  | { kind: 'md'; text: string }
  | { kind: 'choices'; spec: ChoiceSpec }
  | { kind: 'choices-loading' };

/** Fences accepted on read. The first is the only one ever written. */
const FENCES = [`\`\`\`${CHOICES_FENCE}`, `\`\`\`${LEGACY_CHOICES_FENCE}`];

/** Slugs the plan prompt uses for "stop planning and build it". */
const BUILD_SLUGS = /^(just[-_]?)?build/i;

function normalizeOption(raw: unknown): ChoiceOption | null {
  if (typeof raw === 'string' && raw.trim()) return { label: raw.trim() };
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const label = typeof entry.label === 'string' ? entry.label.trim() : '';
  if (!label) return null;
  const id = typeof entry.id === 'string' ? entry.id : undefined;
  const description =
    typeof entry.description === 'string' && entry.description.trim() ? entry.description.trim() : undefined;
  const build = entry.build === true || (!!id && BUILD_SLUGS.test(id)) || undefined;
  return { id, label, description, build };
}

/**
 * Normalize either accepted body shape: the spec's bare array of choices, or the
 * `{question, options, multi}` object some agents emit. Anything else is not a
 * choices block and falls back to a plain fenced code block.
 */
function normalizeSpec(body: string): ChoiceSpec | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) {
    const options = parsed.map(normalizeOption).filter((o): o is ChoiceOption => o !== null);
    return options.length ? { options } : null;
  }
  if (parsed && typeof parsed === 'object') {
    const entry = parsed as Record<string, unknown>;
    const list = Array.isArray(entry.options) ? entry.options : [];
    const options = list.map(normalizeOption).filter((o): o is ChoiceOption => o !== null);
    if (!options.length) return null;
    return {
      question: typeof entry.question === 'string' && entry.question.trim() ? entry.question.trim() : undefined,
      options,
      multi: entry.multi === true,
    };
  }
  return null;
}

/** The earliest accepted fence in `text`, or `null`. */
function findFence(text: string): { at: number; fence: string } | null {
  let best: { at: number; fence: string } | null = null;
  for (const fence of FENCES) {
    const at = text.indexOf(fence);
    if (at !== -1 && (best === null || at < best.at)) best = { at, fence };
  }
  return best;
}

/**
 * Split assistant text into markdown runs and choices blocks.
 *
 * A block whose closing fence has not arrived yet yields `choices-loading`, so the
 * user never watches raw JSON stream past. A block that fails to parse is rendered as
 * an ordinary code block rather than dropped.
 */
export function parseAssistantSegments(text: string): AssistantSegment[] {
  const segments: AssistantSegment[] = [];
  let rest = text;

  for (;;) {
    const found = findFence(rest);
    if (!found) break;
    const before = rest.slice(0, found.at);
    if (before.trim()) segments.push({ kind: 'md', text: before });

    const bodyStart = found.at + found.fence.length;
    const close = rest.indexOf('```', bodyStart);
    if (close === -1) {
      segments.push({ kind: 'choices-loading' });
      return segments;
    }
    const body = rest.slice(bodyStart, close);
    rest = rest.slice(close + 3);

    const spec = normalizeSpec(body);
    if (spec) segments.push({ kind: 'choices', spec });
    else segments.push({ kind: 'md', text: `\`\`\`\n${body.trim()}\n\`\`\`` });
  }

  if (rest.trim()) segments.push({ kind: 'md', text: rest });
  return segments;
}
