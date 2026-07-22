# Message format

Conversation history is persisted and rehydrated in the standard OpenAI chat
shape, with two small, deliberately-neutral additions: a custom content part for
CSV attachments, and a fenced JSON block for plan-mode choices. Both additions
carry a **legacy-alias read rule**, because there is already persisted history in
the wild that uses the pre-neutral names, and a reader that only knows the new
name would silently drop that content on reload.

## The chat shape

A stored message is an OpenAI-style chat message: a `role`
(`system` | `user` | `assistant` | `tool`), a `content` that is either a string
or an array of content parts, and — for assistant turns that call tools —
`tool_calls`, matched by `tool` messages carrying a `tool_call_id`.

```jsonc
{ "role": "user",
  "content": [
    { "type": "text", "text": "build me an arrears dashboard from this" },
    { "type": "attachment_csv", "name": "rent-roll.csv",
      "text": "unit,tenant,balance\n12A,Acme LLC,1450.00\n…", "rows": 812 }
  ] }
```

Everything a reader needs beyond plain OpenAI chat is the two extensions below.

## The `attachment_csv` content part

A CSV attachment is persisted as a content part of type `attachment_csv`:

```jsonc
{ "type": "attachment_csv",
  "name": "rent-roll.csv",
  "text": "unit,tenant,balance\n12A,Acme LLC,1450.00\n…",
  "rows": 812 }
```

- `name` — the original filename, shown in the UI.
- `text` — the raw CSV content.
- `rows` — the row count, shown before the file is parsed.

### Legacy alias read rule (normative)

An earlier build of the production engine behind Speculos persisted this part
under the name `speculos_csv`. That name is baked into every conversation created
before the rename. Therefore:

- **On read**, both the client rehydrator and the server normalizer MUST accept
  **either** `attachment_csv` **or** `speculos_csv` — indefinitely. Treat them as
  the same part.
- **On write**, emit **only** `attachment_csv`.

A reader that recognizes only `attachment_csv` would silently drop every CSV
attachment from every pre-rename conversation on reload. The conformance kit ships
a golden fixture containing a legacy `speculos_csv` message so this can never
regress.

## The `harness-choices` fenced block

In plan mode the agent offers the user clickable choices. They ride **inside the
assistant message's text** as a fenced code block tagged `harness-choices`,
containing a JSON array of choices. The default `<ChatPane>` parses the block out
of the text and renders it as chips; the raw fenced form is what is persisted.

````markdown
Here's how I'd approach this. Which sort order do you want?

```harness-choices
[
  { "id": "by-building", "label": "Group by building, worst arrears first" },
  { "id": "by-tenant",   "label": "Flat list by tenant, highest balance first" }
]
```
````

### Legacy alias read rule (normative)

As with the CSV part, an earlier build fenced these choices as
`speculos-choices`. Therefore:

- **On read**, the client MUST accept **either** the `harness-choices` **or** the
  `speculos-choices` fence — indefinitely.
- **On write**, emit **only** `harness-choices`.

A legacy golden fixture pins this, and the default `<ChatPane>` ships the chips
renderer for the new fence.

## Persistence expectations

History is saved often enough that a dropped connection, a stop, or a crash never
loses more than the in-flight token. A conforming server persists messages at
three points during a turn:

1. **Before the stream starts** — the user's message (with its attachments) is
   saved before the first token, so a turn that dies immediately is still
   recorded.
2. **Per tool** — after each tool call and its result, so partial work survives an
   interruption mid-turn.
3. **At `done`** — the final assistant message is saved when the turn completes,
   and a `finally`-style guard ensures a save even on an aborted or errored turn.

This is why "never lose a partial turn" and "history survives reload" are
properties of the system rather than best-effort behavior. The store contract
that backs this (`saveMessages`, called at each of these points) is part of the
`ProjectStore` interface; a store that saves only at `done` violates the durability
expectation even though it satisfies the type signature.
