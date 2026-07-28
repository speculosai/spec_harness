# FAQ

Straight answers to the questions people actually ask. Where a question has a
detailed answer elsewhere, this points there.

## What is Speculos Harness?

An AI builder platform you embed in your own product: a chat panel beside a
live, sandboxed preview. A user describes the tool they need, the agent builds
it against their real data, and it runs in place. It is the engine behind
[Speculos](https://speculos.ai/cloud-demo), open source under Apache-2.0 - the
same code, not a reference reimplementation.

It ships as three pieces: one npm frontend package (`@speculosai/spec_harness`),
a Python backend router (`speculos-harness` on PyPI), and a build-service
container (`speculosai/harness-bundler`). Start with the
[Quickstart](./quickstart.md).

## What does it cost to run?

The software is free. Inference is billed by your provider, on your keys, with
no markup - Speculos never sits in that path. Beyond the model bill you run
three containers on your own infrastructure.

Two things keep the model bill flat: prompt caching (cache reads and writes are
reported separately from fresh input tokens, so your meter tells the truth), and
a model picker you control - set a cheap default and let users opt up, or pin
one model for everyone. See [Configuration](./configuration.md#models).

## Why is the backend Python and the bundler Bun? Why two processes?

Because the two hard parts have different homes, and pretending otherwise would
mean rewriting one of them.

The agent loop is the crown jewel: the token-management transforms, the
context-window retry, the orphaned-tool-call repair, the cache-breakpoint
placement. Its value is in hard-won details that a rewrite re-derives and
regresses on silently. So it ships as the exact Python package the production
engine behind Speculos already runs - moved, not rewritten. There is
deliberately no second implementation to keep in sync.

The bundler uses `Bun.build`, which runs only under Bun. So Bun is
non-negotiable regardless of what language the agent is in; the Python agent is
one more container beside it. That is two processes behind one
`docker compose up` - more moving parts than a single-binary JS app, and we say
so plainly. It is how most embeddable infrastructure already ships: a service
you run, not necessarily code in your language. In return you get the thing that
matters - one agent loop, on the revenue path, with no second brain to maintain.

If your app is frontend-only, the
[browser-only mode](#when-does-the-browser-only-mode-arrive) removes the Bun
sidecar entirely.

## Why is there no code editor?

By design. The workspace is chat-first: you talk, it builds, you watch. The file
explorer, the per-turn diffs, and the version timeline are **read-only** - they
answer "what did the agent actually change in my app?" without pretending to be
an IDE. Edits go through the conversation, not a text buffer.

This is a real limitation and worth naming: if you want a hand-editable editor
beside the chat, this is not that. The trade is deliberate. A read-only trust
view plus a reliable version timeline covers what operators actually need - an
auditable, restorable history - without the "now the human and the agent are
both editing the same file" problems a live editor brings.

## When does the browser-only mode arrive?

It is on the core roadmap. `@speculosai/spec_harness/sandbox-browser` is the
entry point for an optional in-browser bundler (esbuild-wasm) that lets
frontend-only apps run without the build-service sidecar.

Real parity with the Bun bundler is a project of its own: CDN import resolution
instead of `node_modules`, a pinned supported-dependency set, the JSX runtime
wired to match. So it ships only once a shared bundler conformance suite proves
the two produce equivalent output - until then `/capabilities` advertises server
bundling, so nothing claims a parity that does not exist. When it lands, the
client negotiates it automatically: against a browser bundler it advertises
`supportsInstall: false` and hides on-demand installs.

## What is open source and what is a closed-beta module?

Open source, Apache-2.0, in this repository: the workspace and its panes and
hooks, the agent kit and its loop, the build service, the wire protocol, every
adapter interface, and the reference adapters - `SQLiteProjectStore` /
`FsProjectStore`, `LiteLLMProvider`, single-user auth, and the Postgres and MCP
connectors. The core is complete on its own.

Three modules are commercial and in closed beta:

- **Prompt log** - every prompt recorded and replayable.
- **Connector catalog** - governed connectors beyond the Postgres and MCP
  references (warehouses, CRMs, internal systems), granted per person by an
  admin.
- **Dynamic model routing** - the agent picks the model per task; an explicit
  user pick wins.

The seams they use are open. The `route_for` hook on `LLMProvider` is part of
the open-source interface, so you can write your own routing policy; what is
commercial is the policy Speculos ships. The same goes for connectors: the
`ConnectorProvider` interface is yours, and a connector you write is a
first-class citizen. See [Adapters](./adapters.md#llmprovider) and
[Connectors](./connectors.md).

## What is coming to the core?

Read-only share links, and background jobs - schedules, resumable runs, and
durable state, so an app keeps working with the tab closed. Both are open
source, near-term, and land in this repository. The in-browser bundler is on the
same list. The rest is in [`ROADMAP.md`](../ROADMAP.md).

## What is the relationship to Speculos?

Speculos Harness is the production engine behind
[Speculos](https://speculos.ai), open-sourced. The agent loop published here is
the same code Speculos runs - not a fork, not a reference reimplementation, the
same package consumed as a dependency. That is a structural guarantee the
open-source code cannot quietly rot into a demo: the vendor's revenue path runs
through the repository you are reading.

The split is open core, not license tricks. The core is fully useful standalone;
the commercial value lives in the modules and in the work of deploying them with
design partners.

## What is the license?

Apache-2.0, for the whole repository and every published package. The permissive
license is chosen *because* the whole point is embedding into other companies'
closed products - copyleft would poison exactly the adopters this is for.
Apache-2.0 over MIT specifically for the explicit patent grant and the NOTICE
clause, which matter for a company-backed SDK shipping non-trivial techniques.
See [`LICENSE`](../LICENSE) and [`NOTICE`](../NOTICE).

## Can I bring my own model, storage, or auth?

Yes - that is the point of the adapter interfaces, and every one has a shipped
default so the core boots with zero configuration. Bring any model LiteLLM
speaks (Anthropic, OpenAI, Bedrock, open-weights models, or a LiteLLM proxy) via
config, or wrap a different gateway with an `LLMProvider`. Swap SQLite for your
own `ProjectStore`. Put it behind your real sessions with an `AuthProvider`. Add
live data with a `ConnectorProvider`. Meter it with a `TelemetrySink`. The
authoring guide is [Adapters](./adapters.md).

## How do generated apps use real data without holding a credential?

The generated app runs in a null-origin sandbox and cannot fetch anything
directly. When it needs data it calls its `window.<ns>` API, which crosses the
preview bridge to the parent page, which forwards the request to
`/connectors/{kind}`, where a connector runs the query with a **server-held**
credential and returns only the rows. The DSN, token, or password never enters
the sandbox, the generated code, or the browser. This is the thing browser-only
builders structurally cannot match. See [Connectors](./connectors.md) and
[`spec/security.md`](../spec/security.md).

## Is it safe to run code an AI wrote?

The design has a deliberate answer rather than an accidental one: the generated
code is isolated in a null-origin iframe (never `allow-same-origin`), the bridge
that feeds it data is checked and scoped and timed out, package installs always
run with `--ignore-scripts`, and the bundler ships only as a non-root, ephemeral
container - with a startup self-check that refuses to run if any of those
invariants is weakened. The one residual risk that is contained but not
eliminated - prompt injection through untrusted connector and tool content - is
documented honestly, with its deterministic backstops (a dependency allowlist, a
write validator, `--ignore-scripts`), rather than hidden. The full threat model
is [`spec/security.md`](../spec/security.md), and the trust story is in
[Architecture](./architecture.md#the-sandbox-trust-story).

## How do I get the modules?

Modules are delivered with design partners: our engineers implement them for you
and wire them into your deployment, on your servers.
[Talk to our team](https://speculos.ai/enterprise).

## Where do I ask a question or report a bug?

Issues, discussions, and pull requests are open - see
[`CONTRIBUTING.md`](../CONTRIBUTING.md). Security issues go through the private
channel in [`SECURITY.md`](../SECURITY.md), never a public issue.
