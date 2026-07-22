# Documentation

The guides for embedding, configuring, and extending Speculos Harness — a chat
panel beside a live, sandboxed preview that a user drives in plain language to
build a real tool against their real data.

> [!IMPORTANT]
> **Pre-release — the code lands with v0.1.** This repository is published
> spec-first. What is here today is the structure, the versioned wire protocol,
> the decided public interfaces, these docs, and fully-typed stubs. The
> implementation — the workspace, the agent kit, and the bundler — arrives with
> the **v0.1 code drop**. Every code stub throws or raises `not yet implemented`
> on purpose. These guides describe how the system behaves in the present tense
> because the contract they document is frozen; the behavior is real the day the
> code lands. **Watch or star the repository to follow along.** Feedback on the
> contract, while it is still soft, is the most useful thing you can give us.

## Where to start

If you have five minutes, read the [top-level README](../README.md): it is the
whole product in one page, with the three integration snippets. Then pick your
path below.

| I want to… | Read |
|---|---|
| Stand the whole thing up and see it run | [Quickstart](./quickstart.md) |
| Drop `<Builder>` into my own React product | [Embedding](./embedding.md) |
| Set company-wide defaults — model, house rules, metering | [Configuration](./configuration.md) |
| Give the agent live data (Postgres, MCP) | [Connectors](./connectors.md) |
| Swap in my own storage, auth, model, bundler, or tools | [Adapters](./adapters.md) |
| Understand how the pieces talk and where code runs | [Architecture](./architecture.md) |
| Get straight answers about scope, timing, and licensing | [FAQ](./faq.md) |

## The guides

- **[Quickstart](./quickstart.md)** — two paths from nothing to a running
  workspace: the one-command `docker compose up` path, and the embed-it-in-your-app
  path. Each step annotated.
- **[Embedding](./embedding.md)** — the full frontend integration guide:
  `<HarnessProvider>` and `<Builder>` props, the standalone panes, the headless
  hooks, styling with CSS custom properties, white-labeling with `brand` and
  `strings`, cross-origin embedding (bearer vs. cookie), and read-only viewers.
- **[Configuration](./configuration.md)** — the backend settings teams ask about
  first: the default model and the picker's menu, the instructions brief (house
  rules and your design system), the runtime namespace, and metering through a
  LiteLLM proxy and a `TelemetrySink`.
- **[Connectors](./connectors.md)** — the connector model (tools, prompt lines,
  and a runtime bridge in one plugin), the Postgres and MCP factories, per-`Principal`
  scoping, per-tenant DSN resolvers, and why credentials stay server-side.
- **[Adapters](./adapters.md)** — the authoring guide for every interface:
  `AuthProvider` (including a `402` gate), `LLMProvider` (including `routeFor`
  rules), `ProjectStore` (full-replace `putFiles`, optional snapshots), `Bundler`
  caps, `AgentTool` co-location, and `TelemetrySink`.
- **[Architecture](./architecture.md)** — a diagram of how the client, the agent,
  the bundler, and your adapters talk; what runs where; and the sandbox trust
  story.
- **[FAQ](./faq.md)** — honest answers: is this usable today (no — v0.1), why the
  Python-plus-Bun split, why no code editor, when the browser-only mode arrives,
  the relationship to Speculos, and the license.

## The contract itself

These guides are the *how*. The normative *what* lives one level up:

- **[`spec/`](../spec/)** — the language-neutral wire protocol: the seven SSE
  chat events, the preview bridge, the bundle contract, the message format,
  capability negotiation, and the security invariants.
- **[`packages/protocol`](../packages/protocol/)** — the same contract as
  TypeScript types and adapter interfaces (mirrored 1:1 as Python `Protocol`s in
  the agent kit). Read this to see exact signatures.

When a guide and the spec disagree, the spec wins. If you find a disagreement,
that is a bug worth reporting.
