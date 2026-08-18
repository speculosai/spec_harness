/**
 * The mock backend: one DOM-free request handler that speaks the whole protocol-1
 * wire contract for a scripted demo.
 *
 * There is no LLM and no build service behind it. The turns are written by hand and
 * the stage bundles are precompiled - but everything between here and the workspace is
 * real: the same seven SSE events, the same `Harness-Protocol` header, the same
 * `write_file` tool calls, the same snapshot and rollback shapes. That is the point of
 * the example: if this file is wrong, the real client notices.
 *
 * Not a single line below touches `window`, because `scripts/check-entry.ts` runs this
 * module under Node to prove the contract holds.
 */

import { CHOICES_FENCE, PROTOCOL_HEADER, PROTOCOL_VERSION } from '@speculosai/spec_harness/protocol';
import type { ChatMessage, FileMap, Snapshot, ToolCall } from '@speculosai/spec_harness/protocol';

import { chunkChars, chunkWords, playFrames } from './sse';
import type { Pacing, SseFrame } from './sse';
import type { DemoChoice, DemoDefinition, DemoTurn, StageRegistry } from './types';

/** The path prefix every mocked request lives under. */
export const DEMO_API_PREFIX = '/demo-api/';

/** How wide a `tool-call-delta` chunk is. Roughly one line of JSON at a time. */
const ARGS_CHUNK_CHARS = 120;

/** Per-pacing delays, in milliseconds. */
const PACING: Record<Pacing, { text: number; args: number; result: number }> = {
  live: { text: 20, args: 8, result: 180 },
  instant: { text: 0, args: 0, result: 0 },
};

/* ------------------------------------------------------------------------- *
 * Turn text
 * ------------------------------------------------------------------------- */

/**
 * Render a turn's choices as the fenced block the package parses into chips.
 *
 * `harness-choices` is the fence a conforming writer emits (the legacy
 * `speculos-choices` alias is read-only, forever). The constant comes from the package
 * rather than a literal here, so the two can never drift.
 */
export function renderChoicesFence(choices: DemoChoice[]): string {
  return `\`\`\`${CHOICES_FENCE}\n${JSON.stringify(choices, null, 2)}\n\`\`\``;
}

/**
 * The exact text of one turn.
 *
 * One function, three callers: the streamed `text-delta`s, the assistant message
 * persisted at the end of the turn, and the welcome message seeded into history. They
 * must agree byte-for-byte or a reload would silently show something different from
 * what streamed - the conformance check asserts it.
 */
export function renderTurnText(turn: DemoTurn): string {
  return turn.before + turnAfterSegment(turn) + turnFenceSegment(turn);
}

/** The `after` half of the turn text, joined the way {@link renderTurnText} joins it. */
function turnAfterSegment(turn: DemoTurn): string {
  return turn.after ? `\n\n${turn.after}` : '';
}

/** The choices half of the turn text, joined the way {@link renderTurnText} joins it. */
function turnFenceSegment(turn: DemoTurn): string {
  return turn.choices && turn.choices.length ? `\n\n${renderChoicesFence(turn.choices)}` : '';
}

/**
 * Everything a turn says *after* its tool calls: the "what just happened" beat and the
 * choices fence, with the joining blank line dropped because it starts a message here.
 *
 * A turn that writes files streams as three things - text, tool cards, text - and the
 * workspace renders it as three items, because `appendAssistantText()` starts a fresh
 * assistant bubble once a tool card has been pushed. So the turn is persisted as three
 * things too: assistant, tool messages, assistant. It is not decoration. `ChatPane`
 * only lets the *last* item's choice chips be clicked, so a turn saved as one assistant
 * message followed by its tool messages comes back from `GET /projects/:id` with a tool
 * card in the last slot - and every chip on a re-read history, including after a
 * restore from the timeline, renders disabled. The guided path would dead-end.
 */
export function turnTailText(turn: DemoTurn): string {
  const tail = turnAfterSegment(turn) + turnFenceSegment(turn);
  return tail.startsWith('\n\n') ? tail.slice(2) : tail;
}

/* ------------------------------------------------------------------------- *
 * Stage diffs -> tool calls
 * ------------------------------------------------------------------------- */

/** One tool call a turn will make, before it is given an id. */
export interface ToolCallSpec {
  /** The tool name. Both are in `MUTATING_TOOLS`, so both rebuild the preview. */
  name: 'write_file' | 'delete_file';
  /** The arguments. `write_file` carries `path` + `content`; `delete_file` only `path`. */
  input: Record<string, unknown>;
}

/** Deterministic path order: everything alphabetically, with the entry point last. */
function writeOrder(a: string, b: string): number {
  const entryA = a === '/index.tsx' ? 1 : 0;
  const entryB = b === '/index.tsx' ? 1 : 0;
  if (entryA !== entryB) return entryA - entryB;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Turn "stage N became stage N+1" into the tool calls that would have produced it.
 *
 * The diff *is* the scripted turn: whatever the agent narrates, the visitor sees these
 * exact files land in the explorer. `write_file` carries the whole file because
 * `changesByTurn()` in the package reads `content` out of the call's arguments to build
 * per-turn diffs; an argument shape without it produces an empty diff view.
 *
 * Deletes go first and the entry point is written last, so the file map never passes
 * through a state where `/index.tsx` imports something that is not there yet.
 */
export function diffToToolCalls(from: FileMap, to: FileMap): ToolCallSpec[] {
  const deletes = Object.keys(from)
    .filter((path) => !(path in to))
    .sort(writeOrder)
    .map((path): ToolCallSpec => ({ name: 'delete_file', input: { path } }));

  const writes = Object.keys(to)
    .filter((path) => from[path] !== to[path])
    .sort(writeOrder)
    .map((path): ToolCallSpec => ({ name: 'write_file', input: { path, content: to[path] } }));

  return [...deletes, ...writes];
}

/* ------------------------------------------------------------------------- *
 * State
 * ------------------------------------------------------------------------- */

/** A snapshot as stored: the public fields plus everything a rollback needs to undo. */
interface StoredSnapshot extends Snapshot {
  /** Which stage the project was on. */
  stageIndex: number;
  /** A deep copy of the conversation at capture time. */
  messages: ChatMessage[];
  /** How far through the script the demo had played. */
  playedTurns: number;
}

/** One demo's mutable session state. Lives for as long as the page does. */
interface DemoState {
  demo: DemoDefinition;
  stageIndex: number;
  playedTurns: number;
  messages: ChatMessage[];
  snapshots: StoredSnapshot[];
  updatedAt: string;
}

/** Options for {@link createDemoBackend}. */
export interface DemoBackendOptions {
  /** The demos this backend answers for, one route namespace each. */
  demos: DemoDefinition[];
  /** Every demo's compiled stages, keyed by demo id. */
  stages: StageRegistry;
  /** The connector shim returned with every bundle. */
  shim: string;
  /**
   * How fast turns play. `live` (the default) is the demo's own pacing; the
   * conformance check uses `instant` so it reads the same frames at full speed.
   */
  pacing?: Pacing;
}

/** The mock backend. One method: answer a request. */
export interface DemoBackend {
  /** Answer a request whose pathname starts with {@link DEMO_API_PREFIX}. */
  handle(pathname: string, init?: RequestInit): Promise<Response>;
}

/** A plain deep copy. Messages are JSON all the way down, so this is enough. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Build the mock backend for a set of demos.
 *
 * State is per-backend and in memory: reloading the page restarts every demo, which is
 * exactly what a visitor wants from a guided tour.
 */
export function createDemoBackend(options: DemoBackendOptions): DemoBackend {
  const { demos, stages, shim } = options;
  const delays = PACING[options.pacing ?? 'live'];

  /** Monotonic ISO timestamps: the version timeline sorts on them, so ties are bugs. */
  let lastStamp = 0;
  const stamp = (): string => {
    lastStamp = Math.max(Date.now(), lastStamp + 1);
    return new Date(lastStamp).toISOString();
  };

  /** Tool-call ids are globally monotonic, the way a real provider's are. */
  let callSeq = 0;
  let snapshotSeq = 0;

  const states = new Map<string, DemoState>();
  for (const demo of demos) {
    const welcomeText = renderTurnText(demo.welcome);
    states.set(demo.id, {
      demo,
      stageIndex: 0,
      playedTurns: 0,
      messages: [{ role: 'assistant', content: welcomeText }],
      snapshots: [],
      updatedAt: stamp(),
    });
  }

  const headers = (contentType: string): Record<string, string> => ({
    // Without this header the client cannot tell a conforming body from a host's own
    // 200 page, and `readCapabilities` falls back to protocol-1 defaults - which would
    // put the plan toggle and the attachment buttons back on a scripted demo.
    [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
    'content-type': contentType,
  });

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: headers('application/json') });

  const stagesOf = (demoId: string): StageRegistry[string] => stages[demoId] ?? [];

  const filesAt = (state: DemoState, index: number): FileMap => stagesOf(state.demo.id)[index]?.files ?? {};

  const publicSnapshot = (snapshot: StoredSnapshot): Snapshot => ({
    id: snapshot.id,
    messageIndex: snapshot.messageIndex,
    createdAt: snapshot.createdAt,
    kind: snapshot.kind,
  });

  const takeSnapshot = (state: DemoState, kind: 'pre-turn' | 'undo'): StoredSnapshot => {
    snapshotSeq += 1;
    const snapshot: StoredSnapshot = {
      id: `snap_${snapshotSeq}`,
      messageIndex: state.messages.length,
      createdAt: stamp(),
      kind,
      stageIndex: state.stageIndex,
      messages: clone(state.messages),
      playedTurns: state.playedTurns,
    };
    state.snapshots.push(snapshot);
    return snapshot;
  };

  /* -- the chat turn ----------------------------------------------------- */

  function runTurn(state: DemoState, message: string, signal?: AbortSignal | null): Response {
    const demo = state.demo;
    const scripted = state.playedTurns < demo.turns.length;
    // Past the end of the script the fallback repeats rather than the demo breaking.
    const turn: DemoTurn = scripted ? demo.turns[state.playedTurns] : { before: demo.fallback };

    takeSnapshot(state, 'pre-turn');
    if (scripted) state.playedTurns += 1;
    state.messages.push({ role: 'user', content: message });

    const calls =
      turn.toStage === undefined
        ? []
        : diffToToolCalls(filesAt(state, state.stageIndex), filesAt(state, turn.toStage)).map((spec) => {
            callSeq += 1;
            return { ...spec, id: `call_${callSeq}` };
          });

    const fullText = renderTurnText(turn);
    const tailText = turnTailText(turn);
    let finalized = false;
    /** How many `tool-result` frames actually reached the reader. Abort can stop this short. */
    let deliveredResults = 0;

    /** Persist the turn. Runs once, whether the reader stayed to the end or not. */
    const finalize = (): void => {
      if (finalized) return;
      finalized = true;
      // Only the calls whose result was delivered happened as far as the client is
      // concerned. Persisting the rest would leave the transcript claiming writes the
      // preview never rebuilt for - the file map and the history have to tell one story.
      const landed = calls.slice(0, deliveredResults);

      if (!landed.length) {
        // Nothing landed: one assistant message with the whole turn, exactly as a
        // text-only turn persists, and the project stays on the stage it was on.
        state.messages.push({ role: 'assistant', content: fullText });
        state.updatedAt = stamp();
        return;
      }

      // Mirror what streamed: the text before the tools, the tool cards, then the text
      // (and the chips) after them - so a re-read history ends on the assistant bubble
      // that carries the choices, which is the only item `ChatPane` makes clickable.
      state.messages.push({
        role: 'assistant',
        content: turn.before,
        tool_calls: landed.map(
          (call): ToolCall => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.input) },
          }),
        ),
      });
      for (const call of landed) {
        state.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.name,
          content: '{"ok":true}',
        });
      }
      if (tailText) state.messages.push({ role: 'assistant', content: tailText });

      if (turn.toStage !== undefined) state.stageIndex = turn.toStage;
      state.updatedAt = stamp();
    };

    /**
     * Frame-by-frame side effects, run only for frames that made it out.
     *
     * The project advances on the first tool result the reader actually receives: that
     * result is what bumps the client's rebuild key, and the bundle it then asks for
     * has to be the new stage rather than the one being replaced. Doing it here instead
     * of inside the generator means a turn stopped during the pause before a result
     * leaves the backend where the client still is.
     */
    const onSent = (frame: SseFrame): void => {
      if (frame.event !== 'tool-result') return;
      deliveredResults += 1;
      if (deliveredResults === 1 && turn.toStage !== undefined) {
        state.stageIndex = turn.toStage;
        state.updatedAt = stamp();
      }
      // Persist as soon as the last file has landed, the way the reference agent saves
      // per tool: the explorer re-reads the project on that rebuild, and it should find
      // this turn's changes already in the history it reads.
      if (deliveredResults === calls.length) finalize();
    };

    async function* frames(): AsyncGenerator<SseFrame> {
      // The client ignores this event - it rendered the user's bubble optimistically -
      // but a conforming server sends it, so the mock does too.
      yield { event: 'user-message', data: { text: message } };

      for (const text of chunkWords(turn.before)) {
        yield { event: 'text-delta', data: { text }, delayMs: delays.text };
      }

      for (let index = 0; index < calls.length; index += 1) {
        const call = calls[index];
        // The client pairs the finished card to its pending one by canonicalized-args
        // equality, so these chunks must concatenate to exactly `JSON.stringify(input)`.
        for (const argsDelta of chunkChars(JSON.stringify(call.input), ARGS_CHUNK_CHARS)) {
          yield { event: 'tool-call-delta', data: { index, argsDelta }, delayMs: delays.args };
        }
        yield { event: 'tool-call', data: { toolCallId: call.id, name: call.name, input: call.input } };
        // The stage advance and the persist both hang off `onSent`, so they only happen
        // for results the reader was actually given.
        yield {
          event: 'tool-result',
          data: { toolCallId: call.id, name: call.name, output: { ok: true } },
          delayMs: delays.result,
        };
      }

      for (const text of chunkWords(turnAfterSegment(turn))) {
        yield { event: 'text-delta', data: { text }, delayMs: delays.text };
      }
      for (const text of chunkWords(turnFenceSegment(turn))) {
        yield { event: 'text-delta', data: { text }, delayMs: delays.text };
      }

      yield { event: 'done', data: {} };
    }

    return new Response(playFrames(frames(), { signal, onFinish: finalize, onSent }), {
      status: 200,
      headers: headers('text/event-stream'),
    });
  }

  /* -- routing ----------------------------------------------------------- */

  function readBody(init: RequestInit): Record<string, unknown> {
    if (typeof init.body !== 'string' || !init.body) return {};
    try {
      const parsed: unknown = JSON.parse(init.body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  async function handle(pathname: string, init: RequestInit = {}): Promise<Response> {
    if (!pathname.startsWith(DEMO_API_PREFIX)) return json({ error: 'not found' }, 404);

    const segments = pathname
      .slice(DEMO_API_PREFIX.length)
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));

    const [demoId, ...rest] = segments;
    const state = demoId ? states.get(demoId) : undefined;
    if (!state) return json({ error: 'unknown demo' }, 404);

    const method = (init.method ?? 'GET').toUpperCase();
    const [head, id, tail] = rest;

    if (method === 'GET' && head === 'capabilities' && rest.length === 1) {
      return json({
        protocol: PROTOCOL_VERSION,
        namespace: 'app',
        // Bundling happens on the "server" (here), nothing can be installed, and the
        // stage bundles assume the automatic JSX runtime.
        sandbox: { location: 'server', supportsInstall: false, jsxRuntime: 'automatic' },
        // The demo is scripted, so the plan toggle, the attach buttons and the model
        // picker would all be lying. Advertising none of them hides all three.
        planMode: false,
        attachments: [],
        models: [],
        connectors: ['data'],
        snapshots: true,
      });
    }

    if (head === 'projects' && id !== undefined) {
      if (id !== state.demo.projectId) return json({ error: 'unknown project' }, 404);

      if (method === 'GET' && tail === undefined) {
        return json({
          id: state.demo.projectId,
          name: state.demo.projectName,
          template: 'react-ts',
          files: filesAt(state, state.stageIndex),
          dependencies: {},
          messages: state.messages,
          updatedAt: state.updatedAt,
        });
      }

      if (method === 'GET' && tail === 'snapshots') {
        return json(state.snapshots.map(publicSnapshot));
      }

      if (method === 'POST' && tail === 'rollback') {
        const snapshotId = readBody(init).snapshotId;
        const target = state.snapshots.find((snapshot) => snapshot.id === snapshotId);
        if (!target) return json({ error: 'unknown snapshot' }, 404);
        // Capture where we are before moving, so a restore is itself undoable - the
        // package's timeline offers that undo the moment a restore returns.
        const undo = takeSnapshot(state, 'undo');
        state.messages = clone(target.messages);
        state.stageIndex = target.stageIndex;
        state.playedTurns = target.playedTurns;
        state.updatedAt = stamp();
        return json({ ok: true, messageIndex: target.messageIndex, undoSnapshotId: undo.id });
      }
    }

    if (method === 'POST' && head === 'bundle' && id !== undefined && tail === undefined) {
      if (id !== state.demo.projectId) return json({ error: 'unknown project' }, 404);
      const stage = stagesOf(state.demo.id)[state.stageIndex];
      return json({
        code: stage?.code ?? '',
        css: '',
        // The summary the package folds into the preview document: which kinds exist,
        // and the in-iframe shim that resolves them.
        connectors: { kinds: ['data'], shim },
      });
    }

    if (method === 'POST' && head === 'chat' && rest.length === 1) {
      const body = readBody(init);
      const message = typeof body.message === 'string' ? body.message : '';
      return runTurn(state, message, init.signal);
    }

    if (method === 'POST' && head === 'connectors' && id === 'data' && tail === undefined) {
      const body = readBody(init);
      if (body.op === 'query') {
        const table = typeof body.table === 'string' ? body.table : '';
        return json({ rows: state.demo.dataset[table] ?? [] });
      }
      if (body.op === 'call') {
        const name = typeof body.name === 'string' ? body.name : '';
        const handler = state.demo.calls[name];
        // An unknown action is an in-band error, never a 500: the shim turns `{error}`
        // into `{result: null, error}` and the app renders a message instead of dying.
        if (!handler) return json({ error: `unknown action ${name}` });
        const args = body.args && typeof body.args === 'object' ? (body.args as Record<string, unknown>) : {};
        return json({ result: handler(state.demo.dataset, args) });
      }
      return json({ error: `unknown operation ${String(body.op ?? '')}` });
    }

    return json({ error: 'not found' }, 404);
  }

  return { handle };
}
