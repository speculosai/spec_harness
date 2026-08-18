# Frontend-only demos

Three guided demos - a property manager, an online shop, a furniture factory - each
built by clicking through a scripted conversation in the real Speculos Harness
workspace. The workspace is real: the same `<HarnessProvider>` and `<Builder>` you
would embed, the real streamed wire protocol, real files written into a real project,
a real sandboxed preview. The agent is a script rather than a model, and the company
data is invented.

There is no backend. A patched `fetch` answers everything under `/demo-api/` from
memory, which is why this example needs no API key, no Docker and no build service.

## Run it

```bash
npm install
npm run dev      # http://localhost:5174
```

That is the whole setup. The landing page lists the three demos; each one opens the
workspace with its first suggestion already on screen.

## The three demos

| Vertical | Company | What you click through | What the last step does |
|---|---|---|---|
| `property` | Northwind Property Group - homes and apartments people rent | Ask for the places needing attention; watch the app get written; act on a late payment | Sends a reminder and marks that charge as chased |
| `commerce` | Bluebell Goods - an online shop for the house | Ask for the orders that are stuck; watch the app get written; clear one | Releases an order and approves a refund, for real |
| `factory` | Ashford Works - three lines making furniture | Ask where the week lost time; watch the app get written; act on the worst machine | Books a check and records it |

## Why these three

They are three companies whose questions are specific to their own buildings,
promotions and production lines, and whose questions change most weeks. The person
with the question is an operator, not an engineer.

The argument, once, properly: **a dashboard is a fixed set of charts somebody chose in
advance.** Filters only slice what was already built, so a genuinely new question -
this building only, this promotion only, only the stops longer than half an hour -
needs new logic. New logic means a ticket, a queue and a wait, and by the time the
answer lands the question has usually moved. An embedded builder collapses that: the
person with the question describes it and gets a working tool in the same minute.

And there is one thing a chart cannot do at all. Each demo's last build step *acts* -
it sends a reminder, releases an order, books a check - and writes the change back
into the records the app is reading. That is the line between a report and a tool.

## How the mock works

`src/mock/browser.ts` patches `window.fetch` once at startup. Requests whose pathname
starts with `/demo-api/` go to `createDemoBackend(...).handle(pathname, init)` in
`src/mock/server.ts`; everything else passes through. The server module never touches
`window`, because `npm run check` runs it under Node.

Each demo is mounted at `/demo-api/<demoId>`:

| Endpoint | What it answers |
|---|---|
| `GET /capabilities` | Protocol 1, namespace `app`, server-side bundling, snapshots on. Plan mode, attachments and the model picker are all advertised off, because a scripted demo cannot honour them. |
| `GET /projects/:id` | The project: the current stage's files, the conversation so far, `updatedAt`. |
| `POST /bundle/:id` | The current stage's prebuilt bundle, plus the `data` connector summary and its shim. |
| `POST /chat` | The next scripted turn, as a server-sent-event stream. |
| `GET /projects/:id/snapshots` | The version timeline - one `pre-turn` snapshot per turn, plus `undo` points. |
| `POST /projects/:id/rollback` | Restore a snapshot, capturing an undo point first. |
| `POST /connectors/data` | `{op:'query', table}` and `{op:'call', name, args}` from the preview's bridge. |

Every response carries `Harness-Protocol: 1`. Without that header the client cannot
tell a conforming body from a host's own 200 page, and falls back to protocol-1
defaults.

**The chat stream** is the hand-rolled SSE framing from `spec/chat-protocol.md`:
`event: <name>\n` + `data: <json>\n\n`. A turn sends `user-message`, streams its text
as `text-delta` chunks, streams each tool call's arguments as `tool-call-delta` frames
before the `tool-call` and its `tool-result`, streams the closing text and the choices
fence, then `done`. The argument deltas must concatenate to exactly
`JSON.stringify(input)`: the client pairs a finished tool card to its pending one by
comparing canonicalised arguments.

A turn that writes files is *persisted* the way it streamed - an assistant message, the
tool messages, then a second assistant message carrying the closing beat and the choices
fence. That is deliberate. The workspace only lets the last item in the transcript
answer with a click, so a turn stored as one assistant message followed by its tool
messages comes back from `GET /projects/:id` with a tool card in the last slot and every
chip greyed out - which anyone who restores a version from the timeline would hit.

**The bridge** is the real one. The preview iframe is null-origin, so a generated app
cannot fetch anything; it calls `window.app.data.query('units')`, the shim in
`src/mock/shim.ts` turns that into a `postMessage`, the workspace proxies it to
`POST /connectors/data`, and rows come back. Actions go the same way and really do
mutate the in-memory dataset.

**The stage bundles** stand in for the build service. `stages-plugin.ts` compiles every
`src/demos/<demo>/stages/<NN-name>/index.tsx` with esbuild at build time and serves the
lot as the virtual module `virtual:demo-stages`. `POST /bundle/:id` hands back the
current stage's output. The preview document itself is the package's default, which
loads Tailwind from a CDN - the one thing in this example that wants the network. A
deployment under a strict CSP passes its own `previewHead` instead.

## How a demo is written

A demo is a directory under `src/demos/` with four parts:

- **`data.ts`** - the mocked tables and the action handlers. Literals only: the numbers
  the agent quotes in the chat have to be true of the rows.
- **`script.ts`** - the `DemoDefinition` (welcome turn, the turns, the fallback), the
  landing-card copy, the composer placeholder, and the probes `npm run check` uses to
  exercise the actions. DOM-free, so the check can import it under Node.
- **`demo.tsx`** - the brand: a name, a mark, and the link back to the other demos.
  The only part of a demo that renders anything.
- **`stages/`** - one directory per version of the app, named `0-start`, `1-...`,
  in play order.

A turn is short:

```ts
{
  before: 'What I am about to build, and why.',
  toStage: 1,
  after: 'What just happened, and what it means.',
  choices: [{ id: 'next', label: 'The next thing you would ask' }],
}
```

`toStage` is what makes files appear. The backend diffs the current stage's file map
against the target's: changed and added paths become `write_file` calls carrying
`path` and `content`, removed paths become `delete_file` calls, and those are what
stream as real tool events and land in the explorer. So the diff between two stage
directories *is* the turn - if the narration says "I added a filter", the diff has to
be exactly that.

Adding a fourth vertical is: copy a demo directory, rewrite its four parts, and add one
import to `src/demos/registry.tsx`. Nothing else keeps a list.

## What is not real

- **No model.** The turns are written by hand. Typing something of your own gets the
  next scripted turn, not an answer.
- **No build service.** Stage apps are compiled at build time instead of on demand, so
  nothing here proves a bundler works.
- **No database and no persistence.** The datasets are literals in `data.ts` and live
  in memory; reloading the page restarts every demo.
- **No identity.** `auth.getHeaders` returns `{}`, because there is nobody to be.

For the full stack - a real agent, a real model, a real build service, a real store -
see [`../minimal`](../minimal).

## `npm run check`

```bash
npm run check
```

`scripts/check.mjs` bundles `scripts/check-entry.ts` into a temporary directory and
imports it. The check builds the stage registry itself - **compiling every stage with
esbuild**, so a stage that does not build fails here - mounts the mock on top of it, and
then behaves like the client. For each demo it asserts:

- `/capabilities` carries the protocol header and the exact advertised document;
- a fresh project opens on stage 0 with a welcome message whose `harness-choices` fence
  parses;
- every scripted turn streams `user-message` first and `done` last; the concatenated
  `text-delta`s equal the rendered turn text byte-for-byte; each tool's concatenated
  argument deltas parse and deep-equal its `tool-call` input; every `write_file` carries
  `path` and `content`; every result reports `ok`;
- after each turn the project holds the target stage, the transcript grew by the user
  message, one assistant message per streamed bubble and one tool message per call, the
  choices fence is on the *last* message, and exactly one `pre-turn` snapshot was
  captured;
- tool call ids are unique across every turn of every demo, and every persisted result
  resolves to exactly one call;
- turn shape: the welcome offers a choice, build turns offer one or two, the closing
  turn offers none, and every stage change touches between one and eight files;
- the bundle carries code and a shim that registers a connector;
- every table answers a query with rows, an unknown action is an in-band error, and each
  demo's action visibly changes its table;
- rollback restores files, transcript and script position, and is itself undoable;
- every date in every dataset is a real date in 2026, and no source file draws a random
  number.

`npm test` runs `typecheck`, `build` and `check` together, which is what the
repository-wide `npm test --workspaces` picks up.

## Files

- `src/main.tsx` / `src/App.tsx` - entry point and a two-route hash router.
- `src/Landing.tsx` / `src/landing.css` - the landing page. All card copy comes from
  the registry.
- `src/DemoPage.tsx` - the embed: one provider, one `<Builder>`.
- `src/mock/` - types, SSE framing, the request handler, the `fetch` patch, the shim.
- `src/demos/` - the three verticals and their stages.
- `stages-plugin.ts` - stage scanning and compilation, as pure Node helpers plus a Vite
  plugin. The conformance check reuses the helpers.
- `scripts/` - the conformance check.
