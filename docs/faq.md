# FAQ

Honest answers to the questions people actually ask. Where a question has a
detailed answer elsewhere, this points there.

## Is this usable today?

No — not yet. This repository is published spec-first. What is here today is the
structure, the versioned wire protocol, the decided public interfaces, the docs,
and fully-typed stubs. Every code stub throws or raises `not yet implemented` on
purpose. The implementation — the workspace, the agent kit, and the bundler —
arrives with the **v0.1 code drop**.

You can do real work now, though: read the [wire protocol](../spec/) and the
[interfaces](../packages/protocol/), stand up the example to inspect the surface
(it boots and answers `GET /api/builder/capabilities`; working routes return
`501` until v0.1), and — most useful of all — give feedback on the contract while
it is still soft. Watch or star the repository to be notified when v0.1 lands.

## What ships in v0.1?

The three deliverables under Apache-2.0, plus a one-command demo:

- **The workspace** — `@speculos-harness/react` and `@speculos-harness/preview`:
  `<Builder>` with its panes and hooks, the read-only file explorer, the version
  timeline, plan mode, CSV and screenshot starts, and the self-healing preview.
- **The agent kit** — `speculos-harness` on PyPI: the mountable router and the
  production agent loop (moved, not reimplemented) with its history-management and
  token-efficiency logic intact, plus the reference `SQLiteProjectStore` /
  `FsProjectStore`, `LiteLLMProvider`, and single-user auth.
- **The bundler** — `@speculos-harness/bundler`: the locked-down build container,
  plus the reference **MCP and Postgres connectors** so the first demo fetches real
  data.

Shipped with it: a `docker compose up` demo, a `.env.example`, both `examples/`, a
docs site, and golden conformance fixtures the client and the Python kit replay in
CI. The full roadmap — including what comes after v0.1 — is in
[`ROADMAP.md`](../ROADMAP.md).

## Why is the backend Python and the bundler Bun? Why two processes?

Because the two hard parts have different homes, and pretending otherwise would
mean rewriting one of them.

The agent loop is the crown jewel — the token-management transforms, the
context-window retry, the orphaned-tool-call repair, the cache-breakpoint
placement. Its value is in hard-won details that a rewrite re-derives and
regresses on silently. So it ships as the exact Python package the production
engine behind Speculos already runs — moved, not rewritten. There is deliberately
no second implementation to keep in sync.

The bundler uses `Bun.build`, which runs only under Bun. So Bun is
non-negotiable regardless of what language the agent is in; the Python agent is
one more container beside it. That is two processes behind one `docker compose up`
— more moving parts than a single-binary JS app, and we say so plainly. It is how
most embeddable infrastructure already ships: a service you run, not necessarily
code in your language. In return you get the thing that actually matters — one
agent loop, on the revenue path, with no second brain to maintain.

If your app is frontend-only, the coming [browser-only mode](#when-does-the-browser-only-mode-arrive)
removes the Bun sidecar entirely.

## Why is there no code editor?

By design. The workspace is chat-first: you talk, it builds, you watch. The file
explorer, the per-turn diffs, and the version timeline are **read-only** — they
answer "what did the agent actually change in my app?" without pretending to be an
IDE. Edits go through the conversation, not a text buffer.

This is a real limitation and worth naming: if you want a hand-editable editor
beside the chat, this is not that. The trade is deliberate. A read-only trust view
plus a reliable version timeline covers the thing operators actually need — an
auditable, restorable history — without the complexity and the "now the human and
the agent are both editing the same file" problems that a live editor brings.

## When does the browser-only mode arrive?

After v0.1, as a fast-follow. It is an optional in-browser bundler
(`@speculos-harness/sandbox-browser`, esbuild-wasm) that lets frontend-only apps
run without the build-service sidecar — a zero-backend-bundler path.

It is a fast-follow rather than a launch item on purpose: real parity with the Bun
bundler is a project of its own (CDN import resolution instead of `node_modules`, a
pinned supported-dependency set, the JSX runtime wired to match). It ships only
once a shared bundler conformance suite proves the two produce equivalent output —
until then `/capabilities` advertises server bundling only, so nothing claims a
parity that does not exist. When it lands, the client negotiates it automatically:
against a browser bundler it advertises `supportsInstall: false` and hides
on-demand installs.

## What is the relationship to Speculos?

Speculos Harness is the production engine behind [Speculos](https://speculos.ai),
open-sourced. The agent loop published here is the same code Speculos runs — not a
fork, not a reference reimplementation, the same package consumed as a dependency.
That is a structural guarantee that the open-source code cannot quietly rot into a
demo: the vendor's revenue path runs through the repository you are reading.

The split is open-core, not license tricks. The open core is fully useful
standalone; the commercial value lives in optional proprietary adapters — hosted
SaaS, org and team management, billing, broad business-app integration suites,
data-warehouse connectors, hosted job sandboxes — all of which plug in through the
same interfaces documented here. See [`ROADMAP.md`](../ROADMAP.md) for the
open/commercial line.

## What is the license?

Apache-2.0, for the whole repository and every published package. The permissive
license is chosen *because* the whole point is embedding into other companies'
closed products — copyleft would poison exactly the adopters this is for.
Apache-2.0 over MIT specifically for the explicit patent grant and the NOTICE
clause, which matter for a company-backed SDK shipping non-trivial techniques. See
[`LICENSE`](../LICENSE) and [`NOTICE`](../NOTICE).

## Can I bring my own model, storage, or auth?

Yes — that is the whole point of the adapter interfaces, and every one has a
shipped default so the core boots with zero configuration. Bring any model LiteLLM
speaks (OpenAI, Anthropic, Bedrock, a local Ollama model, or a LiteLLM proxy) via
config, or wrap a different gateway with an `LLMProvider`. Swap SQLite for your own
`ProjectStore`. Put it behind your real sessions with an `AuthProvider`. Add live
data with a `ConnectorProvider`. Meter it with a `TelemetrySink`. The authoring
guide is [Adapters](./adapters.md).

## How do generated apps use real data without holding a credential?

The generated app runs in a null-origin sandbox and cannot fetch anything
directly. When it needs data it calls its `window.<ns>` API, which crosses the
preview bridge to the parent page, which forwards the request to
`/connectors/{kind}`, where a connector runs the query with a **server-held**
credential and returns only the rows. The DSN, token, or password never enters the
sandbox, the generated code, or the browser. This is the thing browser-only
builders structurally cannot match. See [Connectors](./connectors.md) and
[`spec/security.md`](../spec/security.md).

## Is it safe to run code an AI wrote?

The design has a deliberate answer rather than an accidental one: the generated
code is isolated in a null-origin iframe (never `allow-same-origin`), the bridge
that feeds it data is checked and scoped and timed out, package installs always run
with `--ignore-scripts`, and the bundler ships only as a non-root, ephemeral
container — with a startup self-check that refuses to run if any of those
invariants is weakened. The one residual risk that is contained but not eliminated
— prompt injection through untrusted connector and tool content — is documented
honestly, with its deterministic backstops (a dependency allowlist, a write
validator, `--ignore-scripts`), rather than hidden. The full threat model is
[`spec/security.md`](../spec/security.md), and the trust story is in
[Architecture](./architecture.md#the-sandbox-trust-story).

## Where do I ask a question or report a bug?

Issues, discussions, and spec feedback are open now; code contributions open with
v0.1. See [`CONTRIBUTING.md`](../CONTRIBUTING.md). Security issues go through the
private channel in [`SECURITY.md`](../SECURITY.md), never a public issue.
