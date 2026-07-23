<div align="center">

# Speculos Harness

### The open-source AI builder platform - a chat panel beside a live, sandboxed preview, embedded in your own product.

A user describes the tool they need in plain language - "show me arrears by building, worst first" - and the agent builds it against their real data, in place, without leaving your application.

<img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue" />
<img alt="Protocol: v1" src="https://img.shields.io/badge/wire%20protocol-v1-8A2BE2" />

**[Quickstart](#quickstart)** · **[What is in the box](#what-is-in-the-box)** · **[Drop it into your product](#drop-it-into-your-product)** · **[Configuration](#configuration)** · **[Security](#security)** · **[Modules in closed beta](#modules-in-closed-beta)** · **[Contributing](#contributing-security-and-license)**

</div>

<!-- demo: 20-30s GIF of the builder building the arrears dashboard goes here.
     This is the highest-leverage asset in the README - record it before launch. -->

---

Speculos Harness puts a chat panel beside a live preview inside your own product. A user types a request; the generated app renders next to the conversation and updates as the agent works. It is the production engine behind [Speculos](https://speculos.ai), open-sourced as one loop, in one language, on the revenue path - not a second implementation that can rot.

It ships as three pieces you assemble: an npm frontend, a Python backend router, and a build-service container. Each has a working default, so a builder stands up before any customization - then every default swaps for your own storage, auth, models, and design system.

---

## Quickstart

One key, one command, a running builder:

```bash
git clone https://github.com/speculosai/spec_harness
cd spec_harness/examples/minimal
export ANTHROPIC_API_KEY=sk-ant-...   # any LiteLLM-supported provider works
docker compose up
```

Three services come up - the example web app, the agent, and the bundler. Open the printed URL and describe an app. The example that runs through these docs: **Northwind Property Group**, a property-management SaaS, whose operators build an arrears dashboard by asking for one.

---

## What is in the box

The builder is made of a few moving parts, each of which a user can see and trust:

- **Chat beside a live preview.** A resizable two-pane builder: describe an app, watch it get built and run. There is no run button - every file change re-bundles and refreshes, so the preview always reflects the latest turn.
- **A self-healing preview.** If the generated app fails to build or crashes at runtime, the user sees a readable fallback, never a blank white screen - and the agent is asked to read the code and repair it automatically, exactly once per build so it can never loop.
- **A read-only file explorer and a version timeline.** Every turn is captured as a version. Selecting one shows the files it produced and what changed; any of the last ~30 versions can be restored, and un-restored. That is a reliable undo and an auditable answer to the question every operator eventually asks: what did the agent actually change in my app?
- **Plan mode.** For larger changes the agent can propose an approach with clickable choices *before* it writes any code.
- **CSV and screenshot starts.** A user can drop in a spreadsheet ("build a dashboard around this") or paste a screenshot ("make it look like this") as the starting point for a build.

A chat panel talking to an LLM with an iframe beside it is a month of work. The product is the year hiding under the month, and that year ships in this loop: generation kept fast enough to feel interactive while the app rebuilds every turn, raw tool calls turned into a step log a user can follow, full context restored when someone returns a week later, and prompt-cache placement plus context trimming so cost per build falls on a version bump instead of climbing with every component.

---

## Drop it into your product

### 1. Frontend - `@speculos-harness/react`

One provider, one component. The provider tells the builder where the backend lives and how to prove who is asking; the component is the builder itself.

```tsx
import { HarnessProvider, Builder } from '@speculos-harness/react'
import '@speculos-harness/react/styles.css'

<HarnessProvider baseUrl="/api/builder" namespace="app" auth={{ getHeaders }}>
  <Builder
    projectId={project.id}
    layout="preview-left"   // "preview-left" | "chat-left" - pane order is a prop
    filePanel="explorer"    // "explorer" | "hidden" - read-only tree + per-turn diffs + version timeline
  />
</HarnessProvider>
```

The pieces `<Builder>` is made of - `<ChatPane>`, `<PreviewPane>`, `<FileExplorer>`, `<VersionTimeline>` - are exported on their own, so you can put the chat in a drawer and the preview in a modal and they keep talking to each other. For full control, the headless hooks - `useHarnessChat`, `useHarnessPreview`, `useHarnessFiles` - own the protocol, state, and streaming while you bring the layout. `brand={{ name, Logo }}` and a `strings` bag rename every label, and the stylesheet is CSS custom properties throughout - override the tokens and the whole builder adopts your design system.

### 2. Backend - `speculos-harness` (pip)

A single router you mount on an existing FastAPI application, or run standalone as a sidecar beside Flask, Rails, or whatever else your stack uses.

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

### 3. Build service - `speculos/harness-bundler`

A container that takes your project's files and dependencies and returns bundled, browser-ready code and CSS - `{files, deps}` in, `{code, css}` out. The builder calls it on every file change, which is what makes the preview feel live.

```yaml
# docker-compose.yml
bundler:
  image: speculos/harness-bundler
```

That is the whole integration: one React component, one mounted router, one sidecar.

---

## Configuration

### Models

A company-wide default, and the set of models a user may switch to from the in-chat picker. Inference is billed by your provider, on your keys - the harness adds no markup - and adding a model is a configuration change, because the provider layer speaks whatever LiteLLM speaks.

```python
llm=LiteLLMProvider(
    model="anthropic/claude-fable-5",        # company-wide default
    allowed_models=[                          # what the in-chat picker offers
        "anthropic/claude-fable-5",
        "openai/gpt-5.6-sol",
        "zai/glm-5.2",                        # open weights - self-host it if you like
    ],
)
```

Already run a LiteLLM proxy? Point `api_base` at it and your existing keys, budgets, rate limits, and spend dashboards cover builder traffic like any other workload. For your own metering, a `TelemetrySink` hook fires after every generation with the model, the principal who ran it, and the token counts - cache reads reported separately, because providers bill them differently.

### The instructions brief

Included on every build, so a standing rule is set once by an administrator rather than restated by every user on every request. Your design system goes here too, so every generated app comes out on-brand.

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

On the frontend you supply a header factory that runs on every request; on the backend you turn that token back into a `Principal`, which follows the request everywhere - it scopes which projects a user sees, tags their usage in telemetry, and decides what their connectors may touch.

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

Connectors are a list you hand the agent at boot - each bundles the tools the agent can call, the lines it adds to the system prompt, and the runtime bridge the generated app fetches through.

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

Connectors resolve per-request against the `Principal` scope, so two tenants pointed at the same connector list still only ever see their own data - multi-tenant hosts pass a resolver instead of a fixed DSN: `postgres_connector(dsn=lambda p: dsn_for(p.scope["tenant"]))`. Credentials stay in the connector, server-side; the generated app asks the bridge for rows, never for a password. Postgres and MCP reference connectors ship in this repo; the wider governed catalog is a closed-beta module ([below](#modules-in-closed-beta)).

---

## Security

Generated code executes in a sealed sandbox that cannot access your page, your cookies, or your session. When an app needs data, the request passes through a bridge you control, and the credentials never leave your server. A customer's dashboard can query their live Postgres data without the generated code ever handling a password.

The design is deliberate, and a startup self-check refuses to run if any of these invariants is misconfigured away:

- **Null-origin sandbox (normative).** The preview iframe is a null-origin `srcdoc` document with a fixed sandbox attribute. `allow-same-origin` **must never** be added - that omission is *why* the data bridge exists.
- **`postMessage` bridge.** Because the frame is null-origin, relative `fetch` cannot reach your API. All data access is proxied through the parent page over a correlated `postMessage` envelope - every request checked, scoped to the `Principal`, and timed out.
- **Hardened installs.** Dependency installs always run with `--ignore-scripts`, so a package cannot execute install-time scripts on the build server.
- **Two safe auth modes.** Bearer (the default for cross-origin embeds) or cookie. `Access-Control-Allow-Origin: *` combined with credentials is refused at startup rather than shipping a broken, insecure embed.

Full details, including the cross-origin embed recipe, are in [`spec/security.md`](./spec/security.md) and [`SECURITY.md`](./SECURITY.md).

---

## Modules in closed beta

The open core is the loop: the builder, the agent, the bundler - Apache-2.0, complete on its own. Around it, Speculos runs commercial modules that wire into the same three-part deployment. That is the business model, stated plainly: open core, with the whole loop in the open part. The modules are in closed beta:

- **Prompt log.** Every prompt recorded and replayable, so an admin can answer who asked for what - and what the agent did about it.
- **Connector catalog.** Governed connectors beyond the Postgres and MCP references - warehouses, CRMs, and internal systems, granted per person by an admin.
- **Dynamic model routing.** The agent picks the model per task; an explicit user pick always wins.

Share links and a background-jobs stack (schedules, checkpoint-and-resume, durable storage) are next in line.

Modules are how we work with design partners: our AI-native engineers implement them for you and wire them into your deployment, on your servers. [Talk to the team](https://speculos.ai/demo).

---

## Repo map

A pnpm-workspace monorepo with the Python package under `py/`. Strict one-way layering: `@speculos-harness/protocol` depends on nothing; adapters are leaves that depend only on the protocol; the React UI and the agent kit depend on the protocol and on adapters they are handed.

```
spec_harness/
├── spec/                      # the product spine - versioned, language-neutral wire contract
│   ├── chat-protocol.md       #   the seven SSE events + request body
│   ├── preview-bridge.md      #   postMessage envelope, sandbox attributes, shim contract
│   ├── bundle.md              #   {files, deps} -> {code, css} contract
│   ├── message-format.md      #   OpenAI chat shape + the attachment_csv content part
│   ├── security.md            #   null-origin iframe, --ignore-scripts, auth modes, CORS, CSP
│   └── schema/                #   JSON Schema for the wire types
│
├── packages/                  # TypeScript / npm
│   ├── protocol/              #   @speculos-harness/protocol - types + JSON schema + conformance kit (no deps)
│   ├── react/                 #   @speculos-harness/react - <Builder>, panes, hooks
│   ├── preview/               #   @speculos-harness/preview - framework-agnostic iframe host + bridge
│   ├── bundler/               #   @speculos-harness/bundler - the build-service sidecar
│   ├── sandbox-browser/       #   @speculos-harness/sandbox-browser - optional in-browser bundler
│   └── connectors-mcp/        #   @speculos-harness/connectors-mcp - reference connector (bridge + shim half)
│
├── py/
│   └── speculos_harness/      # pip: speculos-harness - the mountable FastAPI router (the loop Speculos runs)
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
- **[SECURITY.md](./SECURITY.md)** - report vulnerabilities privately to security@speculos.ai. Includes the non-negotiable safety invariants.
- **[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)** - Contributor Covenant v2.1.
- **License** - [Apache-2.0](./LICENSE). Chosen for the explicit patent grant and NOTICE clause, and because the whole point is embedding into other companies' products - copyleft would poison exactly the adopters this is for. See [`NOTICE`](./NOTICE).
