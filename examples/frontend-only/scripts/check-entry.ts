/**
 * The conformance check: does the mock backend actually speak the protocol, and does
 * every demo actually play?
 *
 * This is the machine-checked half of the example. It builds the same stage registry
 * the Vite plugin serves - compiling every stage with esbuild, so a stage that does not
 * build fails here rather than in someone's browser - mounts the mock backend on top of
 * it, and then behaves like the real client: it reads `/capabilities`, opens the chat
 * stream, parses the frames with the framing rules from `spec/chat-protocol.md`, and
 * checks what the project looks like afterwards.
 *
 * Nothing here imports a `.tsx` module or touches `window`, which is exactly why every
 * demo keeps its turns, dataset and card copy in a DOM-free `script.ts` + `data.ts`.
 *
 * Run it with `npm run check`; `scripts/check.mjs` bundles this file and imports it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { buildStageRegistry } from '../stages-plugin';
import type { CompiledStage } from '../stages-plugin';
import { DEMO_API_PREFIX, createDemoBackend, diffToToolCalls, renderTurnText, turnTailText } from '../src/mock/server';
import { DATA_SHIM } from '../src/mock/shim';
import type { DemoScript, DemoTurn } from '../src/mock/types';
import * as commerce from '../src/demos/commerce/script';
import * as factory from '../src/demos/factory/script';
import * as property from '../src/demos/property/script';

/**
 * How many stage-advancing turns a finished demo must have.
 *
 * Three build steps then a closing beat is the shape the example promises: the landing
 * card lists three steps, and the third one is the action a chart cannot do.
 */
const MIN_BUILD_TURNS = 3;

/** Where the example lives. `check.mjs` sets this, because the bundle runs from a temp dir. */
const ROOT = process.env.HARNESS_EXAMPLE_ROOT ?? process.cwd();

/* ------------------------------------------------------------------------- *
 * Assertions
 * ------------------------------------------------------------------------- */

const failures: string[] = [];
let checks = 0;
let context = '';

/** Everything reported from here on is about this demo/turn. */
function within(label: string): void {
  context = label;
}

function check(ok: boolean, message: string): void {
  checks += 1;
  if (!ok) failures.push(`${context}: ${message}`);
}

/** Stable JSON, so key order never decides whether two values are "equal". */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A failure message has to fit on a screen; a whole `write_file` payload does not. */
function preview(value: string): string {
  return value.length <= 200 ? value : `${value.slice(0, 200)}… (${value.length} chars)`;
}

function checkEqual(actual: unknown, expected: unknown, message: string): void {
  const left = canonical(actual);
  const right = canonical(expected);
  check(
    left === right,
    left === right ? message : `${message}\n    expected ${preview(right)}\n    actual   ${preview(left)}`,
  );
}

/* ------------------------------------------------------------------------- *
 * A minimal SSE reader, per the package's framing rules
 * ------------------------------------------------------------------------- */

/** One decoded frame. */
interface Frame {
  event: string;
  data: Record<string, unknown>;
}

/**
 * Read a response body as SSE frames: normalise CRLF, split on a blank line, take the
 * `event:` name and the `data:` lines (one leading space after the colon is framing),
 * and emit the final block at EOF because `done` is only advisory.
 */
async function readFrames(body: ReadableStream<Uint8Array>): Promise<Frame[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let buffer = '';

  const push = (block: string): void => {
    if (!block.trim()) return;
    let event = '';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!event) return;
    frames.push({ event, data: JSON.parse(data.join('\n') || '{}') as Record<string, unknown> });
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) push(block);
  }
  buffer = (buffer + decoder.decode()).replace(/\r\n/g, '\n');
  push(buffer);
  return frames;
}

/* ------------------------------------------------------------------------- *
 * Setup
 * ------------------------------------------------------------------------- */

const scripts: DemoScript[] = [property, commerce, factory];

/**
 * Every `toolCallId` any demo has ever streamed.
 *
 * `historyToItems()` resolves a `role:'tool'` message with `items.find(item =>
 * item.toolCallId === message.tool_call_id)` - first match wins. A repeated id would
 * mark an earlier card done and strand the real one on `pending`, which the terminal
 * sweep then turns into a phantom failed write. So the ids are checked to be unique
 * across every turn of every demo, not merely within a turn.
 */
const seenCallIds = new Set<string>();

within('stages');
const stages = await buildStageRegistry(join(ROOT, 'src', 'demos'));
for (const script of scripts) {
  const list: CompiledStage[] = stages[script.definition.id] ?? [];
  check(list.length >= 2, `${script.definition.id} needs at least a starter stage and one built stage`);
  for (const stage of list) {
    check(stage.code.length > 0, `${script.definition.id}/${stage.name} compiled to an empty bundle`);
    check(Object.keys(stage.files).length > 0, `${script.definition.id}/${stage.name} has no files`);
  }
}

const backend = createDemoBackend({
  demos: scripts.map((script) => script.definition),
  stages,
  shim: DATA_SHIM,
  // Same frames, no sleeping: the check reads the stream at full speed.
  pacing: 'instant',
});

/** Issue a request and parse the JSON body. */
async function json<T>(path: string, init?: RequestInit): Promise<{ status: number; headers: Headers; body: T }> {
  const response = await backend.handle(path, init);
  const body = (await response.json()) as T;
  return { status: response.status, headers: response.headers, body };
}

/**
 * Which stage a demo is on when `turns[index]` starts: the most recent `toStage`
 * before it, or the starter stage. A text-only turn in the middle leaves the project
 * where it was, so this walks back rather than looking only at the previous turn.
 */
function stageBefore(turns: DemoTurn[], index: number): number {
  for (let at = index - 1; at >= 0; at -= 1) {
    const stage = turns[at]?.toStage;
    if (stage !== undefined) return stage;
  }
  return 0;
}

/** Pull a `harness-choices` fence out of assistant text and parse it. */
function parseFence(text: string): Array<{ label?: unknown }> | null {
  const open = text.indexOf('```harness-choices');
  if (open === -1) return null;
  const start = open + '```harness-choices'.length;
  const close = text.indexOf('```', start);
  if (close === -1) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, close));
    return Array.isArray(parsed) ? (parsed as Array<{ label?: unknown }>) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------- *
 * Per demo
 * ------------------------------------------------------------------------- */

interface ProjectBody {
  id: string;
  name: string;
  template: string;
  files: Record<string, string>;
  dependencies: Record<string, string>;
  messages: Array<Record<string, unknown>>;
  updatedAt: string;
}

interface SnapshotBody {
  id: string;
  messageIndex: number;
  createdAt: string;
  kind: string;
}

for (const script of scripts) {
  const { definition } = script;
  const base = `${DEMO_API_PREFIX}${definition.id}`;
  const projectPath = `${base}/projects/${definition.projectId}`;
  const demoStages = stages[definition.id] ?? [];

  /* 1. capabilities ------------------------------------------------------ */

  within(`${definition.id} / capabilities`);
  const caps = await json<Record<string, unknown>>(`${base}/capabilities`);
  check(caps.status === 200, `expected 200, got ${caps.status}`);
  check(caps.headers.get('Harness-Protocol') === '1', 'the Harness-Protocol response header is required');
  checkEqual(
    caps.body,
    {
      protocol: 1,
      namespace: 'app',
      sandbox: { location: 'server', supportsInstall: false, jsxRuntime: 'automatic' },
      planMode: false,
      attachments: [],
      models: [],
      connectors: ['data'],
      snapshots: true,
    },
    'the capabilities body must match the demo contract',
  );

  const missing = await json<{ error?: string }>(`${base}/projects/nope`);
  check(missing.status === 404, `an unknown project must 404, got ${missing.status}`);
  check(missing.headers.get('Harness-Protocol') === '1', 'even a 404 carries the protocol header');

  /* 2. the seeded project ------------------------------------------------ */

  within(`${definition.id} / project`);
  const opened = await json<ProjectBody>(projectPath);
  check(opened.status === 200, `expected 200, got ${opened.status}`);
  const welcome = opened.body.messages[0];
  check(welcome?.role === 'assistant', 'history must open with the assistant welcome');
  const welcomeText = typeof welcome?.content === 'string' ? welcome.content : '';
  checkEqual(welcomeText, renderTurnText(definition.welcome), 'the seeded welcome must be the rendered turn text');
  const welcomeChoices = parseFence(welcomeText);
  check(welcomeChoices !== null, 'the welcome must carry a parseable harness-choices fence');
  check(
    (welcomeChoices ?? []).filter((choice) => typeof choice.label === 'string' && choice.label).length >= 1,
    'the welcome fence needs at least one labelled choice',
  );
  checkEqual(opened.body.files, demoStages[0]?.files ?? {}, 'a fresh project holds the starter stage');

  /* 3. play every scripted turn ------------------------------------------ */

  let messageCount = opened.body.messages.length;
  let snapshotCount = 0;

  for (let index = 0; index < definition.turns.length; index += 1) {
    const turn = definition.turns[index];
    within(`${definition.id} / turn ${index + 1}`);

    const previous: DemoTurn = index === 0 ? definition.welcome : definition.turns[index - 1];
    const message = previous.choices?.[0]?.label ?? 'Keep going';

    const response = await backend.handle(`${base}/chat`, {
      method: 'POST',
      body: JSON.stringify({ projectId: definition.projectId, message }),
    });
    check(response.status === 200, `chat must answer 200, got ${response.status}`);
    check(
      (response.headers.get('content-type') ?? '').includes('text/event-stream'),
      'the chat response must be an event stream',
    );
    check(response.headers.get('Harness-Protocol') === '1', 'the chat stream carries the protocol header');
    check(response.body !== null, 'the chat response must have a body');
    const frames = await readFrames(response.body as ReadableStream<Uint8Array>);

    check(frames[0]?.event === 'user-message', `the first frame must be user-message, got ${frames[0]?.event}`);
    checkEqual(frames[0]?.data.text, message, 'user-message echoes the message that was sent');
    check(frames[frames.length - 1]?.event === 'done', 'the last frame must be done');

    const streamed = frames
      .filter((frame) => frame.event === 'text-delta')
      .map((frame) => String(frame.data.text ?? ''))
      .join('');
    checkEqual(streamed, renderTurnText(turn), 'the streamed text must equal the rendered turn text exactly');

    const argsByIndex = new Map<number, string>();
    for (const frame of frames) {
      if (frame.event !== 'tool-call-delta') continue;
      const at = Number(frame.data.index);
      argsByIndex.set(at, (argsByIndex.get(at) ?? '') + String(frame.data.argsDelta ?? ''));
    }

    const toolCalls = frames.filter((frame) => frame.event === 'tool-call');
    const toolResults = frames.filter((frame) => frame.event === 'tool-result');
    const expectedCalls =
      turn.toStage === undefined
        ? []
        : diffToToolCalls(
            demoStages[stageBefore(definition.turns, index)]?.files ?? {},
            demoStages[turn.toStage]?.files ?? {},
          );
    check(
      toolCalls.length === expectedCalls.length,
      `expected ${expectedCalls.length} tool calls, saw ${toolCalls.length}`,
    );
    check(toolResults.length === toolCalls.length, 'every tool call needs exactly one result');

    toolCalls.forEach((frame, at) => {
      const streamedArgs = argsByIndex.get(at);
      check(streamedArgs !== undefined, `tool ${at} streamed no argument deltas`);
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(streamedArgs ?? '');
      } catch {
        check(false, `tool ${at}: the concatenated argsDelta is not JSON`);
      }
      // This is the pairing rule in useHarnessChat: the card is matched by
      // canonicalised-args equality, so anything less than exact is a lost card.
      checkEqual(parsed, frame.data.input, `tool ${at}: the streamed args must deep-equal the tool-call input`);
      // ...and the real client compares `JSON.stringify(parseArgs(argsText))` against
      // `JSON.stringify(input)`, which is insertion order, not sorted order. Deep
      // equality is not enough: a mock that streamed the same keys in another order
      // would pass the assertion above and still miss its card in the browser, falling
      // through to the first-pending fallback.
      check(
        streamedArgs === JSON.stringify(frame.data.input),
        `tool ${at}: the concatenated argsDelta must be byte-identical to JSON.stringify(input) - useHarnessChat pairs on key order`,
      );
      const callId = String(frame.data.toolCallId ?? '');
      check(callId.length > 0, `tool ${at}: a tool-call needs an id`);
      check(!seenCallIds.has(callId), `tool ${at}: toolCallId ${callId} was already used - ids are globally monotonic`);
      seenCallIds.add(callId);
      const name = String(frame.data.name ?? '');
      check(name === 'write_file' || name === 'delete_file', `tool ${at}: unexpected tool ${name}`);
      const input = (frame.data.input ?? {}) as Record<string, unknown>;
      check(typeof input.path === 'string' && input.path.startsWith('/'), `tool ${at}: needs an absolute path`);
      if (name === 'write_file') {
        // `changesByTurn()` reads `content` out of the arguments to build the per-turn
        // diff view; a write without it renders an empty diff.
        check(typeof input.content === 'string', `tool ${at}: write_file must carry content`);
      }
      const result = toolResults[at];
      checkEqual(result?.data.toolCallId, frame.data.toolCallId, `tool ${at}: the result must match the call id`);
      const output = (result?.data.output ?? {}) as Record<string, unknown>;
      check(output.ok === true, `tool ${at}: the result must report ok`);
    });

    const after = await json<ProjectBody>(projectPath);
    const expectedStage = turn.toStage ?? stageBefore(definition.turns, index);
    checkEqual(after.body.files, demoStages[expectedStage]?.files ?? {}, 'the project must hold the target stage');
    // A turn that wrote files is persisted the way it streamed - assistant, tool
    // messages, assistant - so the choices fence lands on the LAST item and its chips
    // stay clickable when the history is re-read (after a restore, say). A text-only
    // turn is one assistant message.
    const tailText = toolCalls.length ? turnTailText(turn) : '';
    const persistedTail = tailText ? 1 : 0;
    check(
      after.body.messages.length === messageCount + 2 + toolCalls.length + persistedTail,
      `messages must grow by 1 user + 1 assistant + ${toolCalls.length} tool${
        persistedTail ? ' + 1 assistant' : ''
      }, saw ${after.body.messages.length - messageCount}`,
    );
    // What a reload would render has to be what streamed: same text, same tool calls,
    // in the OpenAI shape `historyToItems()` rehydrates from.
    const persistedUser = after.body.messages[messageCount];
    checkEqual(persistedUser, { role: 'user', content: message }, 'the user message is persisted verbatim');
    const persistedAssistant = after.body.messages[messageCount + 1] ?? {};
    check(persistedAssistant.role === 'assistant', 'the turn opens with an assistant message');
    checkEqual(
      persistedAssistant.content,
      toolCalls.length ? turn.before : renderTurnText(turn),
      'the persisted assistant text must equal what streamed',
    );
    if (persistedTail) {
      const tail = after.body.messages[messageCount + 2 + toolCalls.length] ?? {};
      check(tail.role === 'assistant', 'a turn with tool calls closes on a second assistant message');
      checkEqual(tail.content, tailText, 'the closing assistant message carries the beat and the choices fence');
      checkEqual(
        `${String(persistedAssistant.content ?? '')}\n\n${tailText}`,
        renderTurnText(turn),
        'the two assistant messages must rejoin into exactly the text that streamed',
      );
      // The whole point of the split: the chips have to be on the last thing in history.
      checkEqual(
        after.body.messages[after.body.messages.length - 1],
        tail,
        'the choices fence must be the last message, or ChatPane renders its chips disabled',
      );
    }
    const persistedCalls = (persistedAssistant.tool_calls ?? []) as Array<Record<string, unknown>>;
    check(persistedCalls.length === toolCalls.length, 'every streamed tool call is persisted');
    persistedCalls.forEach((persisted, at) => {
      checkEqual(persisted.type, 'function', `persisted call ${at} must be a function call`);
      const fn = (persisted.function ?? {}) as Record<string, unknown>;
      checkEqual(fn.name, toolCalls[at]?.data.name, `persisted call ${at} keeps its tool name`);
      checkEqual(
        JSON.parse(String(fn.arguments ?? 'null')),
        toolCalls[at]?.data.input,
        `persisted call ${at} keeps its arguments`,
      );
      const toolMessage = after.body.messages[messageCount + 2 + at] ?? {};
      checkEqual(toolMessage.role, 'tool', `result ${at} is persisted as a tool message`);
      checkEqual(toolMessage.tool_call_id, persisted.id, `result ${at} is linked to its call`);
      checkEqual(toolMessage.content, '{"ok":true}', `result ${at} carries its output`);
    });

    messageCount = after.body.messages.length;

    const snapshots = await json<SnapshotBody[]>(`${projectPath}/snapshots`);
    check(
      snapshots.body.length === snapshotCount + 1,
      `snapshots must grow by exactly 1, saw ${snapshots.body.length - snapshotCount}`,
    );
    check(snapshots.body[snapshots.body.length - 1]?.kind === 'pre-turn', 'a turn captures a pre-turn snapshot');
    snapshotCount = snapshots.body.length;
  }

  /* 3b. the finished transcript ------------------------------------------ */

  within(`${definition.id} / transcript`);
  {
    const played = await json<ProjectBody>(projectPath);
    const declared = new Map<string, number>();
    for (const message of played.body.messages) {
      if (message.role !== 'assistant') continue;
      for (const call of (message.tool_calls ?? []) as Array<Record<string, unknown>>) {
        const id = String(call.id ?? '');
        declared.set(id, (declared.get(id) ?? 0) + 1);
      }
    }
    for (const [id, count] of declared) {
      check(count === 1, `tool call id ${id} is declared ${count} times in one transcript`);
    }
    for (const message of played.body.messages) {
      if (message.role !== 'tool') continue;
      const id = String(message.tool_call_id ?? '');
      // `historyToItems()` takes the FIRST card with a matching id, so a result that
      // resolves to none (or to two) is a card stuck pending, which the terminal sweep
      // then renders as a write that failed.
      check(declared.get(id) === 1, `tool result ${id} must resolve to exactly one tool call, found ${declared.get(id) ?? 0}`);
    }
  }

  /* 4. turn shape -------------------------------------------------------- */

  within(`${definition.id} / shape`);
  check((definition.welcome.choices ?? []).length >= 1, 'the welcome must offer a choice');
  check(definition.welcome.toStage === undefined, 'the welcome must not advance the project');
  check(
    definition.turns.length >= MIN_BUILD_TURNS + 1,
    `a demo needs ${MIN_BUILD_TURNS} build turns and a closing turn, has ${definition.turns.length}`,
  );

  let buildTurns = 0;
  definition.turns.forEach((turn, index) => {
    const closing = index === definition.turns.length - 1;
    const count = (turn.choices ?? []).length;
    if (closing) {
      check(count === 0, 'the closing turn must not offer choices');
      check(turn.toStage === undefined, 'the closing turn must not advance the project');
    } else {
      check(count >= 1 && count <= 2, `turn ${index + 1} must offer 1-2 choices, has ${count}`);
    }
    if (turn.toStage === undefined) return;
    buildTurns += 1;
    const from = demoStages[stageBefore(definition.turns, index)]?.files ?? {};
    const calls = diffToToolCalls(from, demoStages[turn.toStage]?.files ?? {});
    check(
      calls.length >= 1 && calls.length <= 8,
      `turn ${index + 1} must change 1-8 files, changes ${calls.length}`,
    );
  });
  check(
    buildTurns >= MIN_BUILD_TURNS,
    `a demo needs at least ${MIN_BUILD_TURNS} stage-advancing turn(s), has ${buildTurns}`,
  );
  check(definition.fallback.trim().length > 0, 'a demo needs fallback text');

  /* 5. bundling ---------------------------------------------------------- */

  within(`${definition.id} / bundle`);
  const bundle = await json<{ code?: string; css?: string; connectors?: { kinds?: string[]; shim?: string } }>(
    `${base}/bundle/${definition.projectId}`,
    { method: 'POST' },
  );
  check(bundle.status === 200, `bundle must answer 200, got ${bundle.status}`);
  check(typeof bundle.body.code === 'string' && bundle.body.code.length > 0, 'the bundle must carry code');
  checkEqual(bundle.body.connectors?.kinds, ['data'], 'the bundle must advertise the data connector');
  const shim = bundle.body.connectors?.shim ?? '';
  check(shim.length > 0 && shim.includes('__harnessRegister'), 'the shim must register a connector');

  /* 6. the data connector ------------------------------------------------ */

  within(`${definition.id} / connector`);
  for (const table of Object.keys(definition.dataset)) {
    const rows = await json<{ rows: unknown[] }>(`${base}/connectors/data`, {
      method: 'POST',
      body: JSON.stringify({ op: 'query', table }),
    });
    check(rows.status === 200, `query ${table} must answer 200, got ${rows.status}`);
    check(Array.isArray(rows.body.rows) && rows.body.rows.length >= 1, `table ${table} answered no rows`);
  }

  const unknownTable = await json<{ rows: unknown[] }>(`${base}/connectors/data`, {
    method: 'POST',
    body: JSON.stringify({ op: 'query', table: 'not-a-table' }),
  });
  checkEqual(unknownTable.body.rows, [], 'an unknown table answers with no rows');

  const unknownAction = await json<{ error?: string }>(`${base}/connectors/data`, {
    method: 'POST',
    body: JSON.stringify({ op: 'call', name: 'not-an-action', args: {} }),
  });
  check(unknownAction.status === 200, 'an unknown action is an in-band error, not a 500');
  check(
    (unknownAction.body.error ?? '').includes('not-an-action'),
    'an unknown action reports its own name back',
  );

  check(script.probes.length >= 1, 'every demo needs at least one action probe');
  for (const probe of script.probes) {
    const args = probe.args(definition.dataset);
    const before = canonical(definition.dataset[probe.table]);
    const called = await json<{ result?: unknown; error?: string }>(`${base}/connectors/data`, {
      method: 'POST',
      body: JSON.stringify({ op: 'call', name: probe.call, args }),
    });
    check(called.status === 200, `${probe.call} must answer 200, got ${called.status}`);
    check(called.body.error === undefined, `${probe.call} answered with an error: ${String(called.body.error)}`);
    const requeried = await json<{ rows: unknown[] }>(`${base}/connectors/data`, {
      method: 'POST',
      body: JSON.stringify({ op: 'query', table: probe.table }),
    });
    check(
      canonical(requeried.body.rows) !== before,
      `${probe.call} did not visibly change ${probe.table}`,
    );
  }

  /* 7. snapshots and rollback -------------------------------------------- */

  within(`${definition.id} / rollback`);
  const beforeRollback = await json<ProjectBody>(projectPath);
  const history = await json<SnapshotBody[]>(`${projectPath}/snapshots`);
  const first = history.body[0];
  check(first?.kind === 'pre-turn', 'the first snapshot is the first turn');

  const missingSnapshot = await json<{ error?: string }>(`${projectPath}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ snapshotId: 'snap_nope' }),
  });
  check(missingSnapshot.status === 404, `an unknown snapshot must 404, got ${missingSnapshot.status}`);

  const rolled = await json<{ ok: boolean; messageIndex: number; undoSnapshotId: string }>(
    `${projectPath}/rollback`,
    { method: 'POST', body: JSON.stringify({ snapshotId: first?.id }) },
  );
  check(rolled.status === 200, `rollback must answer 200, got ${rolled.status}`);
  check(rolled.body.ok === true, 'rollback must report ok');
  checkEqual(rolled.body.messageIndex, first?.messageIndex, 'rollback reports the restored message index');
  check(typeof rolled.body.undoSnapshotId === 'string' && rolled.body.undoSnapshotId.length > 0, 'rollback is itself undoable');

  const restored = await json<ProjectBody>(projectPath);
  checkEqual(restored.body.files, demoStages[0]?.files ?? {}, 'rolling back to the first turn restores stage 0');
  check(
    restored.body.messages.length === (first?.messageIndex ?? -1),
    `messages must be truncated to ${first?.messageIndex}, saw ${restored.body.messages.length}`,
  );

  const undone = await json<{ ok: boolean }>(`${projectPath}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ snapshotId: rolled.body.undoSnapshotId }),
  });
  check(undone.status === 200, `undo must answer 200, got ${undone.status}`);
  const back = await json<ProjectBody>(projectPath);
  checkEqual(back.body.files, beforeRollback.body.files, 'undoing the rollback restores the files exactly');
  checkEqual(back.body.messages, beforeRollback.body.messages, 'undoing the rollback restores the transcript exactly');

  // The script pointer travels with the snapshot: back at the end of the script, one
  // more turn is the fallback rather than a replay of turn one.
  const extra = await backend.handle(`${base}/chat`, {
    method: 'POST',
    body: JSON.stringify({ projectId: definition.projectId, message: 'Anything else?' }),
  });
  const extraFrames = await readFrames(extra.body as ReadableStream<Uint8Array>);
  const extraText = extraFrames
    .filter((frame) => frame.event === 'text-delta')
    .map((frame) => String(frame.data.text ?? ''))
    .join('');
  checkEqual(extraText, definition.fallback, 'past the end of the script the fallback plays');
}

/* ------------------------------------------------------------------------- *
 * 8. Dataset and source hygiene
 * ------------------------------------------------------------------------- */

within('hygiene');

const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;
for (const script of scripts) {
  for (const [table, rows] of Object.entries(script.definition.dataset)) {
    rows.forEach((row, index) => {
      for (const [key, value] of Object.entries(row)) {
        if (typeof value !== 'string' || !DATE.test(value)) continue;
        const at = Date.parse(value);
        check(!Number.isNaN(at), `${script.definition.id}.${table}[${index}].${key} is not a real date: ${value}`);
        check(
          new Date(at).getUTCFullYear() === 2026,
          `${script.definition.id}.${table}[${index}].${key} must fall in 2026, is ${value}`,
        );
      }
    });
  }
}

/** Every source file under a directory, filtered by extension. */
function sourcesUnder(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at)) {
      const full = join(at, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (extensions.some((extension) => full.endsWith(extension))) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const scanned = [
  ...sourcesUnder(join(ROOT, 'src', 'mock'), ['.ts']),
  ...sourcesUnder(join(ROOT, 'src', 'demos'), ['.ts']),
];
for (const file of scanned) {
  // Deterministic or it is not a demo: the agent quotes numbers out of these rows.
  check(!readFileSync(file, 'utf8').includes('Math.random'), `${file} draws a random number`);
}

/* ------------------------------------------------------------------------- *
 * Report
 * ------------------------------------------------------------------------- */

if (failures.length) {
  console.error(`\n${failures.length} of ${checks} checks failed:\n`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('');
  process.exitCode = 1;
} else {
  console.log(`ok - ${checks} wire-protocol checks passed across ${scripts.length} demos`);
}
