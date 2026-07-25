# Documentation

The guides for embedding, configuring, and extending Speculos Harness - a chat
panel beside a live, sandboxed preview that a user drives in plain language to
build a real tool against their real data.

## Where to start

If you have five minutes, read the [top-level README](../README.md): the whole
product in one page, with the three integration snippets. Then pick your path.

| I want to | Read |
|---|---|
| Stand the whole thing up and see it run | [Quickstart](./quickstart.md) |
| Drop `<Builder>` into my own React product | [Embedding](./embedding.md) |
| Set company-wide defaults - model, house rules, metering | [Configuration](./configuration.md) |
| Give the agent live data (Postgres, MCP) | [Connectors](./connectors.md) |
| Swap in my own storage, auth, model, bundler, or tools | [Adapters](./adapters.md) |
| Understand how the pieces talk and where code runs | [Architecture](./architecture.md) |
| Get straight answers about scope, cost, and licensing | [FAQ](./faq.md) |

## The guides

- **[Quickstart](./quickstart.md)** - two paths from nothing to a running
  workspace: the one-command `docker compose up` path, and the
  embed-it-in-your-app path.
- **[Embedding](./embedding.md)** - the frontend integration guide:
  `<HarnessProvider>` and `<Builder>` props, the standalone panes, the headless
  hooks, styling with CSS custom properties, white-labeling with `brand` and
  `strings`, cross-origin embedding (bearer vs. cookie), and read-only viewers.
- **[Configuration](./configuration.md)** - the backend settings teams ask about
  first: the default model and the picker's menu, the instructions brief (house
  rules and your design system), the runtime namespace, and metering through a
  LiteLLM proxy and a `TelemetrySink`.
- **[Connectors](./connectors.md)** - the connector model (tools, prompt lines,
  and a runtime bridge in one plugin), the Postgres and MCP factories,
  per-`Principal` scoping, per-tenant DSN resolvers, and why credentials stay
  server-side.
- **[Adapters](./adapters.md)** - the authoring guide for every interface:
  `AuthProvider` (including a `402` gate), `LLMProvider` (including the
  `route_for` routing seam), `ProjectStore` (full-replace `put_files`, optional
  snapshots), `Bundler` caps, `AgentTool` co-location, and `TelemetrySink`.
- **[Architecture](./architecture.md)** - a diagram of how the client, the agent,
  the bundler, and your adapters talk; what runs where; and the sandbox trust
  story.
- **[FAQ](./faq.md)** - what it costs to run, why the Python-plus-Bun split, why
  no code editor, when the browser-only mode arrives, what is open source and
  what is a closed-beta module, and the license.

## The contract itself

These guides are the *how*. The normative *what* lives one level up:

- **[`spec/`](../spec/)** - the language-neutral wire protocol: the seven SSE
  chat events, the preview bridge, the bundle contract, the message format,
  capability negotiation, and the security invariants.
- **[`packages/protocol`](../packages/protocol/)** - the same contract as
  TypeScript types and adapter interfaces, mirrored 1:1 as Python `Protocol`s in
  the agent kit. Read this for exact signatures.

When a guide and the spec disagree, the spec wins. That is a bug worth
reporting.
