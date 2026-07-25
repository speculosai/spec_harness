# @speculos-harness/protocol

The versioned wire contract and adapter interfaces for [Speculos Harness](https://speculos.ai) - the single source of truth both the React client (`@speculos-harness/react`) and the Python agent kit (`speculos-harness` on PyPI) implement. This package depends on nothing; every other package depends on it.

## What is in here

- **The seven chat SSE events.** `user-message`, `text-delta`, `tool-call-delta`, `tool-call`, `tool-result`, `error`, `done` - a closed set, hand-rolled as `event: <name>` + `data: <json>`.
- **The adapter interfaces.** `AuthProvider`, `LLMProvider`, `Bundler`, `PackageInstaller`, `ProjectStore`, `AgentTool`, `ConnectorProvider`, `TelemetrySink` - the seams every deployment fills, each with a shipped default.
- **The data types.** `Principal`, `Project`, `Snapshot`, `ChatMessage` (OpenAI shape plus the custom `attachment_csv` content part), `Capabilities`, `ConnectorSummary`, and the bundle / package / rollback / bridge shapes.
- **The constants.** `PROTOCOL_VERSION`, `PROTOCOL_HEADER`, `SANDBOX_ATTRIBUTES` (the normative iframe sandbox string), `DEFAULT_NAMESPACE`, `BUILTIN_TOOLS`, `MUTATING_TOOLS`, and the CSV / plan-choices tag aliases.

## Versioning

The protocol is versioned as an integer and travels in a `Harness-Protocol: 1` header. Additive changes bump the spec minor; breaking changes bump the integer. A version mismatch fails loud rather than silently returning no preview data.

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
    // user-message MUST be ignored - the client already rendered it optimistically.
  }
}
```

## Models

`LLMProvider.configFor` resolves the model for a call; `allowedModels` is what the in-chat picker offers. The reference implementation is LiteLLM-backed, so any LiteLLM-supported provider works from configuration alone. Inference is billed by your provider, on your keys - no markup.

```ts
const models = [
  'anthropic/claude-fable-5',
  'openai/gpt-5.6-sol',
  'zai/glm-5.2',        // open weights
]
```

## The routing seam

`LLMProvider.routeFor` is optional and open: implement it and the agent asks it which model to use per task, `/capabilities` reports `routing: true`, and an explicit per-turn model pick still wins. The hook is yours to implement. Speculos's ready-made routing policy is a [closed-beta module](https://speculos.ai/enterprise).

## Cross-language parity

The wire **data** types (SSE payloads, `Project`, `Snapshot`, `Capabilities`, `ConnectorSummary`) are generated from one source - zod to JSON Schema to pydantic - so they cannot drift between the two languages. The **behavioral** interfaces (methods, `AsyncIterable`s, `AbortSignal`s, things JSON Schema cannot express) are hand-maintained 1:1 in both languages, guarded by a CI signature-drift check plus a shared conformance suite of golden SSE transcripts that both the TypeScript client and the Python kit replay.

## License

Apache-2.0.
