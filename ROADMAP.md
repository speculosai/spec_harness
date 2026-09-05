# Roadmap

What ships today: the builder workspace, the agent and its mountable FastAPI router, the build service, the versioned wire protocol, and the reference Postgres and MCP connectors. That is a complete product. Clone it, add one key, and a user can describe an app and get one.

This file is the longer version of the "Coming next" line in the [README](./README.md).

## Coming to the core

Open source, Apache-2.0, same as everything else here.

- **Read-only share links.** A scoped token that authorizes exactly what a viewer may do. Viewing, never edit rights.
- **Background jobs.** Schedules, resumable runs, and durable state, so an app keeps working with the tab closed. Long runs checkpoint and resume, and the sandbox behind them is swappable.
- **In-browser bundler.** `@speculosai/spec_harness/sandbox-browser`, an optional build path for frontend-only apps that drops the build-service sidecar. It ships once a shared bundler conformance suite proves parity with the server bundler. Until then `/capabilities` advertises server bundling only, so nothing claims a parity that does not exist.
- **Code export and one-click deploy.** Take a generated app out of the workspace and run it yourself.
- **Prompt queue.** Stack the next instruction while a build is still running.
- **Cost and token meter.** Per-project spend in the UI, from the numbers `TelemetrySink` already emits. Inference is billed by your provider, on your keys - no markup.
- **A curated default dependency allowlist.** `HarnessAgent(package_allowlist=[...])` already constrains `install_package` to a host-supplied set; what is still to come is a reviewed default list to start from, for hosted deployments that want one.
- **Machine-readable spec artifacts.** JSON Schemas for the wire types under [`spec/schema/`](./spec/schema/), and a set of golden conformance fixtures - recorded SSE transcripts and request/response pairs - that both reference sides replay. Today the prose spec plus the `@speculosai/spec_harness/protocol` types are the source of truth; these make the contract machine-checkable.

## Modules in closed beta

The open-source core is complete on its own. Speculos also runs commercial modules that plug into the same deployment:

- **Prompt log.** Every prompt recorded and replayable.
- **Connector catalog.** Governed connectors beyond the Postgres and MCP references - warehouses, CRMs, and internal systems, granted per person by an admin.
- **Dynamic model routing.** The agent picks the model per task; an explicit user pick wins. The `route_for` / `routeFor` hook on `LLMProvider` is open source and documented, so you can implement your own policy against it. What is commercial is the routing module we ship and run.

Modules are how we work with design partners: our AI-native engineers implement them for you and wire them into your deployment, on your servers. [Talk to our team](https://speculos.ai/enterprise).

## How to influence it

Issues, discussions, and pull requests are open. Feedback on the protocol and the interfaces carries the most weight, because the wire contract is versioned and everyone downstream pays for a migration. See [CONTRIBUTING.md](./CONTRIBUTING.md).
