<div align="center">

# Speculos Harness

### The open-source AI builder platform - a chat panel beside a live preview, embedded in your own product.

Users describe the tool they need. The agent builds it against their real data, in place, without leaving your application.

<img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue" />
<img alt="Protocol: v1" src="https://img.shields.io/badge/wire%20protocol-v1-8A2BE2" />

**[Quickstart](#quickstart)** · **[What's included](#whats-included)** · **[Drop it into your product](#drop-it-into-your-product)** · **[Configuration](#configuration)** · **[Security](#security)** · **[Modules in closed beta](#modules-in-closed-beta)** · **[Contributing](#contributing-security-and-license)**

</div>

<!-- demo: 20-30s GIF of the builder in action goes here. Record it before launch. -->

---

This is the engine behind [Speculos](https://speculos.ai/cloud-demo), running in production today. Same code, open source.

It ships as three pieces: one npm frontend package, a Python backend router, and a build-service container. Each has a working default, so a builder stands up before any customization. Every default swaps for your own storage, auth, models, and design system.

---

## Quickstart

One key, one command:

```bash
git clone https://github.com/speculosai/spec_harness
cd spec_harness/examples/minimal
export ANTHROPIC_API_KEY=sk-ant-...   # any LiteLLM-supported provider works
docker compose up
```

Three services come up: the example web app, the agent, and the bundler. Open the printed URL and describe an app.

---

## What's included

The builder is a few moving parts:

- **Chat beside a live preview.** Describe an app; watch it build and run. Every file change re-bundles and refreshes the preview - there is no run button.
- **A self-healing preview.** A failed build shows a readable fallback, never a blank screen. The agent reads the error and repairs it, once per build.
- **Versions.** Every turn is captured. See what changed, restore any of the last ~30 versions, un-restore if needed. A reliable undo, and a record of what the agent changed.
- **Plan mode.** For larger changes, the agent proposes an approach with clickable choices before it writes code.
- **CSV and screenshot starts.** Start a build from a spreadsheet or a screenshot.

Also: fast rebuilds, a readable step log, context that survives between sessions, and prompt caching that keeps cost per build flat.

**Coming next:** sandboxes for background jobs, shareable public links that don't require company authentication

The rest of the list is in [ROADMAP.md](./ROADMAP.md).

---

## Drop it into your product

### 1. Frontend - `@speculosai/spec_harness`

One provider, one component.

```tsx
import { HarnessProvider, Builder } from '@speculosai/spec_harness'
import '@speculosai/spec_harness/styles.css'

<HarnessProvider baseUrl="/api/builder" namespace="app" auth={{ getHeaders }}>
  <Builder
    projectId={project.id}
    layout="preview-left"   // "preview-left" | "chat-left"
    filePanel="explorer"    // "explorer" | "hidden"
  />
</HarnessProvider>
```

`<ChatPane>`, `<PreviewPane>`, `<FileExplorer>`, and `<VersionTimeline>` are exported on their own - put the chat in a drawer and the preview in a modal, and they keep talking to each other. Headless hooks (`useHarnessChat`, `useHarnessPreview`, `useHarnessFiles`) own the protocol, state, and streaming if you bring your own layout. `brand` and `strings` props rename every label; the stylesheet is CSS custom properties, so your tokens restyle the whole builder.

One install covers the whole frontend. The rest of it hangs off subpath entry points of the same package: `/protocol` for the wire types and adapter interfaces, `/preview` for the framework-agnostic iframe host if you are not on React, `/connectors-mcp` for the browser half of the MCP connector, and `/styles.css` for the default stylesheet.

### 2. Backend - `speculos-harness` (pip)

A single router. Mount it on an existing FastAPI application, or run it standalone beside Flask, Rails, or whatever else you use.

```python
import os
from speculos_harness import HarnessAgent
from speculos_harness.stores import SQLiteProjectStore
from speculos_harness.llm import LiteLLMProvider

agent = HarnessAgent(
    store=SQLiteProjectStore("./projects.db"),
    llm=LiteLLMProvider(model="anthropic/claude-fable-5", api_key=os.environ["ANTHROPIC_API_KEY"]),
    bundler_url="http://bundler:8081",
)
app.include_router(agent.router, prefix="/api/builder")
```

The router mounts `/chat` (SSE), `/bundle/{id}`, `/projects` (with snapshots and rollback), `/capabilities`, and `/connectors/{kind}`.

### 3. Build service - `speculosai/harness-bundler`

A container: `{files, deps}` in, bundled `{code, css}` out. The builder calls it on every file change; that is what makes the preview live. It is a service you run, not a package you import.

```yaml
# docker-compose.yml
bundler:
  image: speculosai/harness-bundler
```

One React component, one mounted router, one sidecar. That is the whole integration.

---

## Configuration

### Models

A company-wide default, plus what users may pick in the chat. Inference is billed by your provider, on your keys - no markup. Adding a model is a configuration change.

```python
llm=LiteLLMProvider(
    model="anthropic/claude-fable-5",        # company-wide default
    allowed_models=[                          # what the in-chat picker offers
        "anthropic/claude-fable-5",
        "openai/gpt-5.6-sol",
        "zai/glm-5.2",                        # open weights
    ],
)
```

Run a LiteLLM proxy already? Point `api_base` at it - your keys, budgets, and rate limits cover builder traffic too. For your own metering, a `TelemetrySink` hook fires after every generation with the model, the principal, and the token counts, cache reads separate.

### Instructions

Set once by an admin, included on every build. The design system goes here too, so every generated app comes out on-brand.

```python
agent = HarnessAgent(
    instructions="""
        We are Northwind Property Group.
        Amounts are in USD. The fiscal year runs April to March.
        Use the Northwind design system for every app.
        Every table needs a CSV export button.
    """,
    ...
)
```

### Identity and connectors

A header factory proves who is asking on the frontend; an `AuthProvider` turns the token back into a `Principal` on the backend. The `Principal` scopes projects, tags usage, and decides what connectors may touch.

```python
from speculos_harness import AuthProvider, AuthDenied, Principal

class MyAuth(AuthProvider):
    async def resolve(self, request):
        user = await verify_token(request.headers.get("authorization"))
        if not user:
            return None                                   # -> plain 401
        if user.plan_expired:
            return AuthDenied(status=402, message="upgrade required")
        return Principal(user_id=user.id, can_edit=True,
                         scope={"tenant": user.org_id})
```

Connectors are a list you hand the agent at boot. Each bundles the agent tools, the system-prompt lines, and the runtime bridge the generated app fetches through.

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

Connectors resolve per request against the `Principal` scope: two tenants on the same connector list only ever see their own data. Multi-tenant hosts pass a resolver instead of a fixed DSN: `postgres_connector(dsn=lambda p: dsn_for(p.scope["tenant"]))`. Credentials stay server-side - the generated app asks the bridge for rows, never for a password. Postgres and MCP references ship in this repo; the wider catalog is a closed-beta module ([below](#modules-in-closed-beta)).

---

## Security

Generated code runs in a sealed sandbox. It cannot reach your page, your cookies, or your session. Data requests pass through a bridge you control; credentials never leave your server.

A startup self-check refuses to run if any of these is misconfigured:

- **Null-origin sandbox.** The preview iframe is a null-origin `srcdoc` document with a fixed sandbox attribute. `allow-same-origin` is never added.
- **`postMessage` bridge.** The null-origin frame cannot `fetch` your API directly. All data access goes through the parent page over a correlated `postMessage` envelope - checked, scoped to the `Principal`, and timed out.
- **Hardened installs.** Dependency installs run with `--ignore-scripts`.
- **Two auth modes.** Bearer (default for cross-origin embeds) or cookie. `Access-Control-Allow-Origin: *` with credentials is refused at startup.

Details, including the cross-origin embed recipe: [`spec/security.md`](./spec/security.md) and [`SECURITY.md`](./SECURITY.md).

---

## Modules in closed beta

The open-source core is complete on its own: the builder, the agent, the bundler. Speculos also runs commercial modules that plug into the same deployment. They are in closed beta:

- **Prompt log.** Every prompt recorded and replayable.
- **Connector catalog.** Governed connectors beyond the Postgres and MCP references - warehouses, CRMs, and internal systems, granted per person by an admin.
- **Dynamic model routing.** The agent picks the model per task; an explicit user pick wins.

Modules are how we work with design partners: our AI-native engineers implement them for you and wire them into your deployment, on your servers. [Talk to our team](https://speculos.ai/enterprise).

---

## Repo map

A pnpm-workspace monorepo with the Python package under `py/`. The whole frontend is one npm package, `@speculosai/spec_harness`, with subpath entry points. Layering inside it runs one way: the `/protocol` entry depends on nothing, the adapter entries (`/preview`, `/connectors-mcp`, `/sandbox-browser`) depend only on the protocol, and the React workspace depends on the protocol and the preview host. The agent kit depends on the protocol as its Python mirror.

```
spec_harness/
├── spec/                      # the versioned, language-neutral wire contract
│   ├── chat-protocol.md       #   the seven SSE events + request body
│   ├── preview-bridge.md      #   postMessage envelope, sandbox attributes, shim contract
│   ├── bundle.md              #   {files, deps} -> {code, css} contract
│   ├── message-format.md      #   OpenAI chat shape + the attachment_csv content part
│   ├── security.md            #   null-origin iframe, --ignore-scripts, auth modes, CORS, CSP
│   └── schema/                #   JSON Schema for the wire types
│
├── packages/                  # TypeScript
│   ├── spec_harness/          #   @speculosai/spec_harness - the one npm package
│   │                          #     .                 <Builder>, panes, hooks
│   │                          #     /protocol         types + JSON schema + conformance kit
│   │                          #     /preview          iframe host + bridge
│   │                          #     /connectors-mcp   reference connector
│   │                          #     /sandbox-browser  optional in-browser bundler
│   │                          #     /styles.css       the default stylesheet
│   └── bundler/               #   the build service - ships as the container image
│                              #   speculosai/harness-bundler, not published to npm
│
├── py/
│   └── speculos_harness/      # pip: speculos-harness - the FastAPI router
│
├── examples/
│   ├── minimal/               #   web + FastAPI + compose - clone and run, one key
│   └── with-connectors/       #   adds MCP + Postgres reference connectors
│
├── docs/                      # quickstart, protocol reference, adapter authoring, security
└── docker-compose.yml         # agent + bundler + example web, one command
```

---

## Contributing, security, and license

- **[CONTRIBUTING.md](./CONTRIBUTING.md)** - issues, discussions, and pull requests are open. Commits carry a DCO sign-off.
- **[SECURITY.md](./SECURITY.md)** - report vulnerabilities privately to security@speculos.ai.
- **[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)** - Contributor Covenant v2.1.
- **License** - [Apache-2.0](./LICENSE): permissive, with an explicit patent grant, so you can embed it in a commercial product. See [`NOTICE`](./NOTICE).
