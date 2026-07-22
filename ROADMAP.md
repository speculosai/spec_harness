# Roadmap

This is the honest state of Speculos Harness and where it is going. It matches the roadmap section of the [README](./README.md).

> [!IMPORTANT]
> **Pre-release.** The repository is published spec-first. The structure, the versioned wire protocol, the public interfaces, and typed stubs are here today; the implementation arrives with the v0.1 code drop. Watch or star to follow.

## Now — spec and interfaces published

The contract is public and reviewable, so that the shape of v0.1 can be shaped by feedback before the code is frozen. What is here:

- **The wire protocol (v1).** A hand-rolled SSE chat stream of exactly seven events, the `{files, deps} -> {code, css}` bundle contract, the `postMessage` preview bridge, the message format, and capability negotiation — all in [`spec/`](./spec), versioned behind a `Harness-Protocol: 1` header.
- **The public interfaces.** The adapter surface — `LLMProvider`, `ProjectStore`, `AuthProvider`, `ConnectorProvider`, `Bundler`, `PackageInstaller`, `AgentTool`, `TelemetrySink` — as TypeScript in [`packages/protocol`](./packages/protocol) and 1:1 Python protocols in the agent kit.
- **The public API.** `<HarnessProvider>` / `<Builder>` and the hooks on the frontend; `HarnessAgent(...)` and the router mount on the backend. Fully typed, documented, stubbed.
- **Docs and examples** scaffolded so the quickstart, protocol reference, and security guide land ready.

No implementation ships in this phase. Every stub raises `not yet implemented`.

## Next — the v0.1 code drop

The implementation, under Apache-2.0, in three deliverables:

- **The workspace** — `@speculos-harness/react` and `@speculos-harness/preview`: `<Builder>` with its panes and hooks, the read-only file explorer, the version timeline, plan mode, CSV and screenshot starts, and the self-healing preview.
- **The agent kit** — `speculos-harness` on PyPI: the mountable FastAPI router and the production agent loop, moved rather than reimplemented, with its history-management and token-efficiency logic intact, the reference `SQLiteProjectStore` / `FsProjectStore`, `LiteLLMProvider`, and single-user auth.
- **The bundler** — `@speculos-harness/bundler`: the locked-down build-service container, plus the reference **MCP + Postgres connectors** so the first demo fetches real data.

Shipped with it: a one-command `docker compose up` that opens a working builder, a `.env.example` and both `examples/`, a docs site, and golden conformance fixtures the client and the Python kit replay in CI.

## Later

- **In-browser bundler** — `@speculos-harness/sandbox-browser`, an optional build path for frontend-only apps that drops the build-service sidecar. It ships only once a shared bundler conformance suite proves parity; until then `/capabilities` advertises server bundling only, so nothing claims a parity that does not exist.
- **Dynamic model routing** — the agent picks the model per task (a deeper model for planning, a fast cheap one for crunching a CSV) when the user has not chosen one. An explicit per-turn pick always wins, and a routed choice must come from `allowed_models`.
- **Sharing and background jobs** — read-only share links (a scoped token that authorizes exactly what a viewer may do, never edit rights), and the server-side jobs stack: long runs, scheduled runs, checkpoint-and-resume, durable storage, and swappable sandboxes. These survive the browser tab — the thing a browser-only sandbox structurally cannot do.

Beyond that: code export and one-click deploy, a prompt queue, a cost/token meter, a curated dependency allowlist for hosted deployments, click-to-edit visual editing, and a model-swap eval harness built on the conformance fixtures.

## How to influence it

The most useful contribution right now is feedback on the protocol and the interfaces, while they are still soft. Open a discussion or an issue. See [CONTRIBUTING.md](./CONTRIBUTING.md).
