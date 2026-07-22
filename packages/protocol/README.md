# @speculos-harness/protocol

The versioned wire contract and adapter interfaces for [Speculos Harness](https://speculos.ai) — the single source of truth that both the React client (`@speculos-harness/react`) and the Python agent kit (`speculos-harness` on PyPI) implement. This package depends on nothing; every other package is a leaf that depends on it.

> **Pre-release — code lands with v0.1.** The type definitions in this package are published in full today: they are the one thing that is real before the code drop, so you can read and give feedback on the contract while it is still soft. The runtime helpers a complete protocol package also ships — the zod schemas, JSON-Schema emission, and the golden-fixture conformance kit — arrive with **v0.1**. Watch or star to follow.

## What is in here

- **The seven chat SSE events.** `user-message`, `text-delta`, `tool-call-delta`, `tool-call`, `tool-result`, `error`, `done` — a closed set, hand-rolled as `event: <name>` + `data: <json>`.
- **The adapter interfaces.** `AuthProvider`, `LLMProvider`, `Bundler`, `PackageInstaller`, `ProjectStore`, `AgentTool`, `ConnectorProvider`, `TelemetrySink` — the seams every deployment fills, each with a shipped default.
- **The data types.** `Principal`, `Project`, `Snapshot`, `ChatMessage` (OpenAI shape plus the custom `attachment_csv` content part), `Capabilities`, `ConnectorSummary`, and the bundle / package / rollback / bridge shapes.
- **The constants.** `PROTOCOL_VERSION`, `PROTOCOL_HEADER`, `SANDBOX_ATTRIBUTES` (the normative iframe sandbox string), `DEFAULT_NAMESPACE`, `BUILTIN_TOOLS`, `MUTATING_TOOLS`, and the CSV / plan-choices tag aliases.

## Versioning

The protocol is versioned as an integer and travels in a `Harness-Protocol: 1` header. Additive changes bump the spec minor; breaking changes bump the integer. A version mismatch is meant to fail loud rather than silently return no preview data.

## Usage

Import the types and constants directly. Nothing here has a runtime dependency.

```ts
import {
  PROTOCOL_VERSION,
  SANDBOX_ATTRIBUTES,
  type WireEvent,
  type Capabilities,
  type ProjectStore,
} from '@speculos-harness/protocol'

// The one closed set of chat events a conforming server may emit.
function onEvent(e: WireEvent) {
  switch (e.event) {
    case 'text-delta':
      appendAssistantText(e.data.text)
      break
    case 'tool-result':
      if (e.data.output.ok !== false && isMutating(e.data.name)) rebuildPreview()
      break
    // user-message MUST be ignored — the client already rendered it optimistically.
  }
}
```

## The single-source-of-truth pipeline (arrives with v0.1)

The wire **data** types (SSE payloads, `Project`, `Snapshot`, `Capabilities`, `ConnectorSummary`) will be generated from one source — zod → JSON Schema → pydantic — so they genuinely cannot drift between the two languages. The **behavioral** interfaces above (methods, `AsyncIterable`s, `AbortSignal`s — things JSON Schema cannot express) are hand-maintained 1:1 in both languages, guarded by a CI signature-drift check plus a shared conformance suite of golden SSE transcripts that both the TS client and the Python kit replay.

## License

Apache-2.0.
