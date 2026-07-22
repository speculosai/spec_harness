# Chat protocol

The chat call is the heart of the workspace. The client sends a user's message
for a project; the server streams back the agent's work — text, tool calls, tool
results — as a sequence of server-sent events. When a file-mutating tool
succeeds, the client rebuilds the preview. That loop is the whole product.

- **Endpoint:** `POST {base}/chat`
- **Request body:** JSON (below)
- **Response:** a hand-rolled server-sent-event stream (below), **not** the
  Vercel AI SDK data-stream protocol
- **Header:** every response carries `Harness-Protocol: 1`

`{base}` is wherever the agent router is mounted — `/api/builder` in the
defaults, but any prefix the host chooses.

## Request body

```jsonc
{
  "projectId": "proj_northwind_arrears",   // required — the project to build in
  "message": "show arrears by building, worst first",  // required — the user's turn

  "planMode": true,        // optional — omit when false; see "Plan mode" below
  "model": "openai/gpt-4.1",   // optional — per-turn model override, honored only if allowed
  "lang": "en",            // optional — UI/response language hint

  "attachments": [         // optional — image and/or CSV attachments for this turn
    { "kind": "image", "name": "mockup.png", "dataUrl": "data:image/png;base64,iVBORw0KG..." },
    { "kind": "csv",   "name": "arrears.csv", "text": "unit,balance\n12A,1450.00\n...", "rows": 812 }
  ]
}
```

Field notes:

- **`projectId`** identifies an existing project. The server loads that project's
  files and message history before the turn.
- **`message`** is the user's plain-language request.
- **`planMode`** is a boolean. Omit it (or send `false`) for a normal build turn.
  When `true`, the agent proposes an approach instead of writing code — see
  [Plan mode](#plan-mode).
- **`model`** is a per-turn override. The server honors it **only** if the model
  is in the server's allowed set (advertised in
  [`/capabilities`](./capabilities.md)); otherwise the server falls back to its
  configured default. An explicit `model` always wins over any server-side
  routing.
- **`lang`** is an advisory language hint (BCP-47 style, e.g. `"en"`).
- **`attachments`** carries images and CSVs. See
  [Attachments](#attachments-imagecsv).

### Attachments (image / CSV)

Two attachment kinds are defined in protocol v1. The set of accepted kinds is
also advertised per-server in [`/capabilities`](./capabilities.md).

```jsonc
// image — a screenshot or mockup to build from ("make it look like this")
{ "kind": "image", "name": "dashboard-mockup.png",
  "dataUrl": "data:image/png;base64,<base64 bytes>" }

// csv — a spreadsheet to build around ("here's the data, build me a dashboard")
{ "kind": "csv", "name": "rent-roll.csv",
  "text": "unit,tenant,balance\n12A,Acme LLC,1450.00\n...",
  "rows": 812 }
```

- An **image** carries its bytes inline as a `data:` URL. The agent may look at it
  directly.
- A **CSV** carries its content as raw `text`, plus a `rows` count the UI shows
  before the file is parsed. On persistence a CSV attachment becomes an
  `attachment_csv` content part on the stored message — see
  [message-format.md](./message-format.md), including the legacy-alias read rule.

## Auth is a mode, not a pin

The client attaches credentials to **every** call it makes — the chat SSE, the
bundle call, project and snapshot reads, and every preview bridge-proxy fetch —
in one of two modes. The mode is a deployment choice; the wire is the same.

### Bearer mode (default for cross-origin embeds)

The client calls the host-supplied `getHeaders()` on every request and attaches
its headers (typically `Authorization: Bearer <token>`), and sends
`credentials: 'omit'`. Nothing rides on cookies. This is the recommended mode
for dropping `<Builder>` into a product served from a different origin than the
agent, because it sidesteps third-party-cookie problems entirely.

```tsx
auth={{ getHeaders: async () => ({ Authorization: `Bearer ${await getToken()}` }) }}
```

### Cookie mode

The client sends `credentials: 'include'` and relies on the browser's cookies.
This works transparently same-origin. **Cross-origin, cookie mode has two hard
requirements**, and a conforming server MUST enforce them:

1. Cookies must be `SameSite=None; Secure`.
2. CORS must use a **per-origin allowlist** that echoes the caller's origin in
   `Access-Control-Allow-Origin` and sets `Access-Control-Allow-Credentials: true`.

`Access-Control-Allow-Origin: *` is incompatible with credentialed requests —
the browser rejects the combination. A conforming server configured for cookie
mode with a wildcard origin MUST **refuse to start** rather than ship an embed
that silently fails in production. (See the cross-origin recipe in
[security.md](./security.md).)

The `examples/minimal` deployment is same-origin and works under either mode.

## Response: the seven SSE events

The response is a hand-rolled SSE stream: each event is `event: <name>\n`
followed by `data: <json>\n\n`. There are **exactly seven** event names in
protocol v1. A client MUST ignore any event name it does not recognize (this is
what keeps additive minor versions safe).

| `event:` | `data` | Client action / normative rule |
|---|---|---|
| `user-message` | `{ text }` | **Client MUST ignore.** The user's bubble was already rendered optimistically when the request was sent. A client that renders this event double-renders the user's message. |
| `text-delta` | `{ text }` | Append `text` to the trailing assistant bubble. |
| `tool-call-delta` | `{ index, argsDelta }` | Stream `argsDelta` into a pending tool card keyed by `index`. The tool's id and name are not known yet. |
| `tool-call` | `{ toolCallId, name, input }` | Finalize the tool card: pair it to a pending card and mark it running. See [pairing](#pairing-tool-call-delta-to-tool-call). |
| `tool-result` | `{ toolCallId, name, output }` | Success is `output.ok !== false`. If successful **and** `name` is in the mutating-tool set, trigger a preview rebuild. See [the rebuild trigger](#the-mutating-tool-rebuild-trigger). |
| `error` | `{ message }` | Render a friendly error bubble. Never a stack trace. |
| `done` | `{}` | Advisory end-of-turn marker. The stream truly ends on reader EOF. |

### Exact payloads

```jsonc
// event: user-message
{ "text": "show arrears by building, worst first" }

// event: text-delta
{ "text": "I'll add a grouped table sorted by balance descending." }

// event: tool-call-delta
{ "index": 0, "argsDelta": "{\"path\":\"/App" }

// event: tool-call
{ "toolCallId": "call_a1b2c3", "name": "write_file",
  "input": { "path": "/App.tsx", "content": "export default function App() { ... }" } }

// event: tool-result
{ "toolCallId": "call_a1b2c3", "name": "write_file",
  "output": { "ok": true, "path": "/App.tsx", "bytes": 2048 } }

// event: error
{ "message": "The model is temporarily unavailable. Please try again." }

// event: done
{}
```

## Normative client rules

### Ignore `user-message`

The client renders the user's bubble the instant it sends the request
(optimistic rendering). The server still emits `user-message` so that a
non-optimistic or replay client has the canonical text, but the reference client
MUST discard it. Echoing it produces a duplicate bubble on every turn.

### Pairing `tool-call-delta` to `tool-call`

Argument text arrives before the tool is identified. A `tool-call-delta` carries
an `index` and a chunk of the arguments JSON (`argsDelta`); the client keys a
pending card by `index` and concatenates the deltas. When the matching
`tool-call` arrives with the real `toolCallId`, `name`, and parsed `input`, the
client finalizes that card. Pairing is by canonicalized-argument equality first,
then by first-pending fallback — a `tool-call` whose reconstructed input matches
a pending card's accumulated args attaches to that card; otherwise it attaches to
the earliest still-pending card. Once finalized, the card is marked running
(`pending`) until its `tool-result` arrives.

### The `ok !== false` success convention

A tool result is a success when `output.ok !== false`. This is deliberately not
`output.ok === true`: **a result object with no `ok` key at all counts as
success.** Only an explicit `{ "ok": false, ... }` is a failure. A conforming
client MUST use the `!== false` test, not truthiness of `ok`.

### The mutating-tool rebuild trigger

Four built-in tools mutate the project's files:

```
write_file   edit_file   delete_file   install_package
```

When a `tool-result` for one of these arrives **and** it succeeded
(`output.ok !== false`), the client bumps its rebuild key (the `fileSig`
contract) and the preview re-bundles from scratch. `read_file` never triggers a
rebuild. This is the entire mechanism behind "the preview feels live": the agent
writes, the file-mutation result lands, the sig bumps, the sandbox refreshes.
There is no separate "run" signal.

The rebuild key is a monotonic string. Bumping it — and only bumping it — drives
the preview build effect, which is keyed on `${projectId}:${rebuildKey}`. The
crash-to-auto-fix loop rides the same key: the preview fires its `onError`
handler at most once per rebuild key, so a broken build asks the agent to repair
itself exactly once and can never enter a fix loop.

## Built-in tools

Protocol v1 defines five built-in tools. A server may offer more (a connector can
contribute its own), but these five are always present unless a capability or
availability rule prunes them.

| Tool | Mutates files | Notes |
|---|---|---|
| `write_file` | yes | Create or fully replace a file at `path`. |
| `edit_file` | yes | Replace an exact substring. The search string **must match exactly once**; zero or multiple matches is an error result. This is what stops a file being silently corrupted by an ambiguous edit. |
| `read_file` | no | Read a file's current contents. |
| `delete_file` | yes | Remove a file. |
| `install_package` | yes | Add an npm dependency. Only meaningful when the bundler advertises `supportsInstall: true` (see [bundle.md](./bundle.md)); the install always runs with `--ignore-scripts`. |

## Plan mode

When the request sets `planMode: true`, the agent proposes an approach before
touching code. The one hard rule sits on the wire between the server and its
model provider, and it is encoded in the `LLMProvider` interface:

> In plan mode the server offers **`tools: null`**, never `tools: []`.

Several model providers reject an empty tools array outright; passing `null`
(no tools) is the portable way to say "answer without calling anything." A
conforming server MUST pass `null` and MUST NOT pass `[]` in plan mode. This is
subtle enough that the interface types it (`tools: ToolSchema[] | null`) so a
reimplementer cannot pass the wrong empty value by accident.

Plan mode's output includes clickable choices for the user. These ride inside the
assistant's text as a fenced ` ```harness-choices``` ` JSON block, which the
default `<ChatPane>` renders as chips. The block format and its legacy-alias read
rule are specified in [message-format.md](./message-format.md).

## No-capabilities fallback

A client should call [`GET {base}/capabilities`](./capabilities.md) to learn what
a server supports. If that endpoint **404s**, or the `Harness-Protocol` header is
absent, the client MUST assume **protocol-1 defaults** and proceed:

| Assumed capability | Default |
|---|---|
| Bundling location | `server` |
| `supportsInstall` | `true` |
| Plan mode | on |
| Attachments | `["image", "csv"]` |
| Model routing | off |
| Model list | none (hide the picker) |

These defaults describe a straightforward protocol-1 server, so a client that
falls back this way still works against any conforming backend that predates the
capabilities endpoint. The conformance kit ships a no-capabilities fixture that
pins this behavior.
