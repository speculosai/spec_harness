<div align="center">

# Speculos Harness

### An embeddable AI app-building workspace — a chat panel beside a live, sandboxed preview, dropped into your own product.

A user describes the tool they need in plain language — "show me arrears by building, worst first" — and the agent builds it against their real data, in place, without leaving your application.

<img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue" />
<img alt="Status: pre-release" src="https://img.shields.io/badge/status-pre--release-orange" />
<img alt="Protocol: v1" src="https://img.shields.io/badge/wire%20protocol-v1-8A2BE2" />

**[What it is](#what-it-is)** · **[Integration](#integration)** · **[Configuration](#configuration)** · **[Security](#security)** · **[Repo map](#repo-map)** · **[Roadmap](#roadmap)**

</div>

---

> [!IMPORTANT]
> **Pre-release — code lands with v0.1.**
> This repository is published spec-first. What is here today is the structure, the versioned wire protocol, the decided public interfaces, docs, and fully-typed stubs. The implementation — the workspace, the agent kit, and the bundler — arrives with the **v0.1 code drop**. Every stub throws or raises `not yet implemented` on purpose. **Watch or star to follow**, and read the [protocol spec](./spec) and [interfaces](./packages/protocol) now to shape v0.1 while it is still soft. Feedback on the contract is the most useful thing you can give us before the code is frozen.

---

## What it is

Speculos Harness places a chat panel beside a live preview inside your own product. A user types a request; the generated app renders next to the conversation and updates as the agent works. It is the production engine behind [Speculos](https://speculos.ai), being open-sourced as one loop, in one language, on the revenue path — not a second implementation that can rot.

The workspace is made of a few moving parts, each of which a user can see and trust:

- **Chat beside a live preview.** A resizable two-pane workspace: describe an app, watch it get built and run. There is no "run" button — every file change re-bundles and refreshes, so the preview always reflects the latest turn.
- **A self-healing preview.** If the generated app fails to build or crashes at runtime, the user sees a readable fallback, never a blank white screen — and the agent is asked to read the code and repair it automatically, exactly once per build so it can never loop.
- **A read-only file explorer and a version timeline.** Every turn is captured as a version. Selecting one shows the files it produced and what changed; any of the last ~30 versions can be restored, and un-restored. That is a reliable undo and an auditable answer to the question every operator eventually asks: what did the agent actually change in my app?
- **Plan mode.** For larger changes the agent can propose an approach with clickable choices *before* it writes any code.
- **CSV and screenshot starts.** A user can drop in a spreadsheet ("build a dashboard around this") or paste a screenshot ("make it look like this") as the starting point for a build.

The example that runs through these docs: **Northwind Property Group**, a property-management SaaS, whose operators build an arrears dashboard by asking for one.

---

## Integration

Harness ships as three pieces you assemble: an **npm frontend**, a **Python backend router**, and a **build-service container**. Each ships with a working default, so a functioning workspace stands up before any customization.

### 1. Frontend — `@speculos-harness/react`

One provider, one component. The provider tells the workspace where the backend lives and how to prove who is asking; the component is the workspace itself.

```tsx
import { HarnessProvider, Builder } from '@speculos-harness/react'
import '@speculos-harness/react/styles.css'

<HarnessProvider baseUrl="/api/builder" namespace="app" auth={{ getHeaders }}>
  <Builder
    projectId={project.id}
    layout="preview-left"   // "preview-left" | "chat-left" — pane order is a prop
    filePanel="explorer"    // "explorer" | "hidden" — read-only tree + per-turn diffs + version timeline
  />
</HarnessProvider>
```

The pieces `<Builder>` is made of — `<ChatPane>`, `<PreviewPane>`, `<FileExplorer>`, `<VersionTimeline>` — are exported on their own, so you can put the chat in a drawer and the preview in a modal and they keep talking to each other. For full control there are headless hooks — `useHarnessChat`, `useHarnessPreview`, `useHarnessFiles` — that own the protocol, state, and streaming, so you can bring your own layout and chrome.

### 2. Backend — `speculos-harness` (pip)

The backend is a single router you mount on an existing FastAPI application, or run standalone as a sidecar beside Flask, Rails, or whatever else your stack uses.

```python
import os
from speculos_harness import HarnessAgent
from speculos_harness.stores import SQLiteProjectStore
from speculos_harness.llm import LiteLLMProvider

agent = HarnessAgent(
    store=SQLiteProjectStore("./projects.db"),
    llm=LiteLLMProvider(model="openai/gpt-4.1", api_key=os.environ["OPENAI_API_KEY"]),
    bundler_url="http://bundler:8081",
)
app.include_router(agent.router, prefix="/api/builder")
```

The router mounts `/chat` (SSE), `/bundle/{id}`, `/projects` (with `/projects/{id}/snapshots` and `/projects/{id}/rollback`), `/capabilities`, and `/connectors/{kind}`. Every component is a standalone module with a working default: substitute SQLite for your own storage, the OpenAI key for Anthropic or a local model, and the built-in single-user auth for your real session handling.

### 3. Build service — `speculos/harness-bundler`

The build service is a container that takes your project's files and dependencies and returns bundled, browser-ready code and CSS — `{files, deps}` in, `{code, css}` out. The workspace calls it every time a file changes, which is what makes the preview feel live: the agent writes, the service rebuilds, the sandbox refreshes.

```yaml
# docker-compose.yml
bundler:
  image: speculos/harness-bundler
```

That is the whole integration: one React component, one mounted router, one sidecar. See [`docker-compose.yml`](./docker-compose.yml) for the three-service stack.

---

## Configuration

### Models

The constructor exposes the settings teams ask about first: the company-wide default model, and the set of models a user may switch to from the in-chat picker.

```python
agent = HarnessAgent(
    llm=LiteLLMProvider(
        model="anthropic/claude-sonnet-5",       # company-wide default
        allowed_models=[                          # what the in-chat picker offers
            "anthropic/claude-sonnet-5",
            "openai/gpt-4.1",
            "ollama/llama3.3",                    # a free local option
        ],
    ),
    ...
)
```

### The instructions brief

The `instructions` brief is included on every build, so a standing rule is set once by an administrator rather than restated by every user on every request. Your design system can go here too, so all generated apps follow the required look.

```python
agent = HarnessAgent(
    instructions="""
        We are Northwind Property Group.
        Amounts are in USD. The fiscal year runs April to March.
        Every table needs a CSV export button.
    """,
    ...
)
```

### Identity — `Principal`

Identity flows in from both sides. On the frontend you supply a header factory that runs on every request the workspace makes; on the backend you turn that token back into a person.

```python
from speculos_harness import AuthProvider, AuthDenied, Principal

class MyAuth(AuthProvider):
    async def resolve(self, request):
        user = await verify_token(request.headers.get("authorization"))
        if not user:
            return None                                   # -> plain 401
        if user.plan_expired:
            return AuthDenied(status=402, message="upgrade required")   # authed but blocked, in-band
        return Principal(user_id=user.id, can_edit=True,
                         scope={"tenant": user.org_id})
```

`Principal` follows the request everywhere. It scopes which projects a user sees, tags their token usage in the telemetry hook, and decides what their data connectors are allowed to touch.

### Connectors

Connectors are a list you hand the agent at boot. Each one bundles everything a data source needs — the tools the agent can call, the lines it adds to the system prompt, and the runtime bridge the generated app fetches through.

```python
from speculos_harness.connectors import postgres_connector, mcp_connector

agent = HarnessAgent(
    auth=MyAuth(),
    connectors=[
        postgres_connector(dsn=os.environ["DATABASE_URL"]),
        mcp_connector(url="https://your-mcp-host.example/notion"),
    ],
    ...
)
```

Connectors resolve per-request against the `Principal` scope, so two tenants pointed at the same connector list still only ever see their own data. Multi-tenant hosts with a database per tenant pass a resolver instead of a fixed DSN: `postgres_connector(dsn=lambda p: dsn_for(p.scope["tenant"]))`. Credentials stay in the connector, server-side — the generated app asks the bridge for rows, never for a password.

### Metering — proxy and `TelemetrySink`

If you already run a LiteLLM proxy, point the provider at it. Your existing keys, budgets, rate limits, and spend dashboards then cover builder traffic like any other workload.

```python
llm = LiteLLMProvider(
    model="openai/gpt-4.1",
    api_base="http://your-litellm-proxy:4000",   # route via an existing proxy
    api_key=os.environ["LITELLM_KEY"],
)
```

For your own metering — per-seat billing, team caps, a usage graph — a telemetry hook fires after every generation with the model, the principal who ran it, and the token counts. Cache reads are reported separately, because providers bill them differently.

```python
from speculos_harness import TelemetrySink

class Metering(TelemetrySink):
    def on_generation(self, e):
        usage.record(
            user=e.principal.user_id,
            model=e.model,
            tokens_in=e.usage.input_tokens,
            tokens_out=e.usage.output_tokens,
            cache_read=e.usage.cache_read_tokens,
        )

agent = HarnessAgent(..., telemetry=Metering())
```

### Branding and strings

`brand={{ name, Logo }}` and a `strings` bag override every label in the UI, so the workspace speaks your product's language without a fork. The default stylesheet is built on CSS custom properties — override the tokens (colors, radii, type) and the whole workspace adopts your design system.

---

## Security

Generated code executes in a sealed sandbox that cannot access your page, your cookies, or your session. When an app needs data, the request passes through a bridge you control, and the credentials never leave your server. A customer's dashboard can query their live Postgres data without the generated code ever handling a password.

The design is deliberate, and a startup self-check refuses to run if any of these invariants is misconfigured away:

- **Null-origin sandbox (normative).** The preview iframe is a null-origin `srcdoc` document with a fixed sandbox attribute: `allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-top-navigation-by-user-activation`. `allow-same-origin` **must never** be added — that omission is *why* the data bridge exists.
- **`postMessage` bridge.** Because the frame is null-origin, relative `fetch` cannot reach your API. All data access is proxied through the parent page over a correlated `postMessage` envelope, with a 60-second per-request timeout and never-throwing stubs for unknown connectors. Every request is checked, scoped to the `Principal`, and timed out.
- **Hardened installs.** Dependency installs always run with `--ignore-scripts`, so a package cannot execute install-time scripts on the build server.
- **Two safe auth modes.** Bearer (the default for cross-origin embeds; `credentials: 'omit'`) or cookie (`credentials: 'include'`, which cross-origin also requires `SameSite=None` plus a per-origin CORS allowlist). `Access-Control-Allow-Origin: *` combined with credentials is refused at startup rather than shipping a broken, insecure embed.

Full details, including the cross-origin embed recipe, are in [`spec/security.md`](./spec/security.md) and [`SECURITY.md`](./SECURITY.md).

---

## Why not build it yourself

A chat panel talking to an LLM with an iframe beside it is a month of work. The product is the year hiding under the month — and it is the reason to embed this rather than grow your own:

- **Latency.** Keeping generation fast enough to feel interactive while the app rebuilds every turn.
- **Legible agent output.** Turning raw tool calls into the plain-language step log a user can actually follow.
- **Plan mode.** Letting the agent propose a plan before it writes code, for larger changes.
- **Session continuity.** Restoring full context when a user returns to a project a week later.
- **LLM cost control.** Prompt-cache placement, and trimming stale tool output and dead code from context — the difference between a build that stays cheap and one whose bill climbs with every component.

All of it lives inside one engine that improves without integration work on your side. The token-efficiency logic ships in the loop, so cost per build falls on a version bump. New models are a configuration change, because the provider layer speaks whatever LiteLLM speaks. You run `pip install --upgrade` and `npm update` and you are on the newest standards.

---

## Repo map

This repository is a pnpm-workspace monorepo with the Python package under `py/`. Strict one-way layering: `@speculos-harness/protocol` depends on nothing; adapters are leaves that depend only on the protocol; the React UI and the agent kit depend on the protocol and on adapters they are handed.

```
speculos-harness/
├── spec/                      # the product spine — versioned, language-neutral wire contract
│   ├── chat-protocol.md       #   the seven SSE events + request body
│   ├── preview-bridge.md      #   postMessage envelope, sandbox attributes, shim contract
│   ├── bundle.md              #   {files, deps} -> {code, css} contract
│   ├── message-format.md      #   OpenAI chat shape + the attachment_csv content part
│   ├── security.md            #   null-origin iframe, --ignore-scripts, auth modes, CORS, CSP
│   └── schema/                #   JSON Schema for the wire types
│
├── packages/                  # TypeScript / npm
│   ├── protocol/              #   @speculos-harness/protocol — types + JSON schema + conformance kit (no deps)
│   ├── react/                 #   @speculos-harness/react — <Builder>, panes, hooks
│   ├── preview/               #   @speculos-harness/preview — framework-agnostic iframe host + bridge
│   ├── bundler/               #   @speculos-harness/bundler — the build-service sidecar
│   ├── sandbox-browser/       #   @speculos-harness/sandbox-browser — optional in-browser bundler (post-v0.1)
│   └── connectors-mcp/        #   @speculos-harness/connectors-mcp — reference connector (bridge + shim half)
│
├── py/
│   └── speculos_harness/      # pip: speculos-harness — the mountable FastAPI router (the loop Speculos runs)
│
├── examples/
│   ├── minimal/               #   web + FastAPI + compose — clone and run, one key
│   └── with-connectors/       #   adds MCP + Postgres reference connectors
│
├── docs/                      # quickstart, protocol reference, adapter authoring, security
├── docker-compose.yml         # agent + bundler + example web, one command (runnable at v0.1)
├── README.md
├── LICENSE                    # Apache-2.0
├── NOTICE
├── CONTRIBUTING.md
├── SECURITY.md
├── CODE_OF_CONDUCT.md
└── ROADMAP.md
```

---

## Roadmap

See [`ROADMAP.md`](./ROADMAP.md) for the full version.

- **Now** — the spec and the public interfaces are published. The wire protocol (a seven-event SSE stream, the `{files, deps} -> {code, css}` bundle contract, the `postMessage` preview bridge), the adapter interfaces, docs, and typed stubs are all here to read and give feedback on. No implementation yet.
- **Next — the v0.1 code drop.** The workspace (`@speculos-harness/react` + `@speculos-harness/preview`), the agent kit (`speculos-harness` on PyPI — the moved-not-rewritten Python loop), and the bundler (`@speculos-harness/bundler`), all under Apache-2.0, with a one-command `docker compose up` demo, MCP + Postgres reference connectors, a docs site, and golden conformance fixtures.
- **Later** — the in-browser bundler for a Bun-less frontend-only path, dynamic model routing (the agent picks the model per task; an explicit user pick always wins), and the plugin wave: read-only share links and the server-side background-jobs stack (schedules, checkpoint-and-resume, durable storage, swappable sandboxes).

---

## Contributing, security, and license

- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — how to help before and after the code drop. Issues, discussions, and spec feedback are open now; code contributions open with v0.1. Commits carry a DCO sign-off.
- **[SECURITY.md](./SECURITY.md)** — report vulnerabilities privately to security@speculos.ai. Includes the non-negotiable safety invariants.
- **[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)** — Contributor Covenant v2.1.
- **License** — [Apache-2.0](./LICENSE). Chosen for the explicit patent grant and NOTICE clause, and because the whole point is embedding into other companies' products — copyleft would poison exactly the adopters this is for. See [`NOTICE`](./NOTICE).
