# Quickstart

Two ways to go from nothing to a running workspace.

- **[Path A: run the reference stack](#path-a-run-the-reference-stack)** with one
  command, then describe an app to it in your browser. Start here if you are
  evaluating.
- **[Path B: embed it in your product](#path-b-embed-it-in-your-product)**: one
  React component and one mounted router. Start here once you know you want it.

---

## Path A: run the reference stack

The reference stack is three services: the **web** workspace, the **agent**
router, and the **bundler** build service. One compose file wires them together.

### One key, one command

```bash
git clone https://github.com/speculosai/spec_harness
cd spec_harness/examples/minimal
export ANTHROPIC_API_KEY=sk-ant-...   # any LiteLLM-supported provider works
docker compose up
```

The default model is `anthropic/claude-fable-5`. Set `HARNESS_MODEL` to run a
different one - `openai/gpt-5.6-sol`, or `zai/glm-5.2` for open weights - and
provide that provider's key instead. Inference is billed by your provider, on
your keys, with no markup. See [Configuration](./configuration.md) for the
default model, the in-chat picker, and metering.

Three services come up:

| Service | What it is | Port |
|---|---|---|
| `web` | the React workspace (`<Builder>`) | `5173` |
| `agent` | the mountable FastAPI router (`speculos-harness`) | `8000` |
| `bundler` | the build service - `{files, deps}` in, `{code, css}` out | `8081` |

The `web` service talks to `agent` over the wire protocol; `agent` calls
`bundler` every time a file changes to turn the project into a running app.

### Open it

Go to **http://localhost:5173** and type a request. For the running example that
means something a **Northwind Property Group** operator would ask, like "show me
arrears by building, worst first". The generated app renders beside the
conversation and rebuilds as the agent works. There is no run button: every file
change re-bundles and refreshes.

### What just happened

1. Your message went to `POST /api/builder/chat`, which streamed the agent's
   work back as [server-sent events](../spec/chat-protocol.md).
2. Each time the agent wrote a file, the client asked the bundler to rebuild and
   refreshed the [null-origin preview iframe](../spec/preview-bridge.md).
3. If the app had crashed, you would have seen a readable fallback and the agent
   would have repaired it - once, so it can never loop.
4. Every turn was captured as a version you can inspect and restore.

### Adding real data

Path A with no connectors builds file-only apps. To let the generated app query
a live database or an MCP server, add connectors to the backend - see
[Connectors](./connectors.md). The `instructions` brief, the model picker, and
metering are backend configuration; see [Configuration](./configuration.md).

---

## Path B: embed it in your product

The same workspace, inside your product, on your infrastructure, with your login
and your data. One component on the frontend, one router on the backend.

### 1. Install the frontend package

```bash
npm install @speculosai/spec_harness
```

One package covers the whole frontend: the workspace, the preview host
(`/preview`), the wire-protocol types (`/protocol`), the MCP connector
(`/connectors-mcp`), and the stylesheet (`/styles.css`).

### 2. Render the workspace

One provider tells the workspace where the backend lives and how to prove who is
asking; one component is the workspace itself.

```tsx
import { HarnessProvider, Builder } from '@speculosai/spec_harness'
import '@speculosai/spec_harness/styles.css'

export function BuilderPage({ projectId }: { projectId: string }) {
  return (
    <HarnessProvider
      baseUrl="/api/builder"          // where the agent router is mounted
      namespace="app"                 // window.app.* + app-* bridge messages; must match the server
      auth={{
        // Runs on EVERY request the workspace makes: chat, bundle, file reads,
        // and the preview's data fetches. Return whatever proves identity.
        getHeaders: async () => ({ Authorization: `Bearer ${await getToken()}` }),
        canEdit: true,                // false => a read-only viewer
      }}
    >
      <Builder
        projectId={projectId}
        layout="preview-left"         // or "chat-left"
        filePanel="explorer"          // or "hidden"
      />
    </HarnessProvider>
  )
}
```

That is the whole frontend. The full set of props, the standalone panes, the
headless hooks, styling, and white-labeling are in [Embedding](./embedding.md).

### 3. Install and mount the backend

```bash
pip install speculos-harness
```

The backend is a single router you mount on an existing FastAPI application, or
run standalone as a sidecar beside Flask, Rails, or any other stack - it speaks
the protocol over HTTP regardless of what serves your product.

```python
import os
from fastapi import FastAPI
from speculos_harness import HarnessAgent
from speculos_harness.stores import SQLiteProjectStore
from speculos_harness.llm import LiteLLMProvider

app = FastAPI()

agent = HarnessAgent(
    store=SQLiteProjectStore("./projects.db"),   # swap for your own storage
    llm=LiteLLMProvider(
        model="anthropic/claude-fable-5",
        api_key=os.environ["ANTHROPIC_API_KEY"],
    ),
    bundler_url="http://bundler:8081",           # the build-service sidecar
    namespace="app",                             # MUST match the frontend
)

app.include_router(agent.router, prefix="/api/builder")
```

The router mounts `/chat` (SSE), `/bundle/{id}`, `/projects` (with
`/projects/{id}/snapshots` and `/projects/{id}/rollback`), `/capabilities`, and
`/connectors/{kind}` under your prefix.

### 4. Run the build service

The bundler is not code you write - you run it. It is published as a locked-down
container: non-root, ephemeral build directories, installs always with
`--ignore-scripts`.

```yaml
# docker-compose.yml
services:
  bundler:
    image: speculosai/harness-bundler
    ports: ["8081:8081"]
```

### That is the whole integration

One React component, one mounted router, one sidecar. The reference
[`examples/minimal`](../examples/minimal/) is exactly this, wired together. From
here:

- **[Configuration](./configuration.md)** - your default model, the picker's
  menu, the instructions brief, and metering.
- **[Embedding](./embedding.md)** - cross-origin embedding, read-only viewers,
  styling, and white-labeling.
- **[Connectors](./connectors.md)** - give the agent live data.
- **[Adapters](./adapters.md)** - replace storage, auth, the model layer, or the
  bundler with your own.

## Troubleshooting

- **The preview loads but shows no data.** The most common integration bug is a
  `namespace` mismatch. The value passed to `<HarnessProvider namespace>` must
  equal the `namespace` on `HarnessAgent`. It is bound in three places - the
  prompt, the generated code, and the bridge - that must agree. See the
  [preview bridge spec](../spec/preview-bridge.md).
- **Cross-origin requests fail in the browser.** You are probably in cookie mode
  with a wildcard CORS origin, which the browser refuses for credentialed
  requests, and which the server refuses to start with by design. Use bearer
  mode, or set an explicit per-origin allowlist. See the cross-origin recipe in
  [Embedding](./embedding.md) and [`spec/security.md`](../spec/security.md).
- **The model picker is missing.** The client hides it when the server
  advertises no `allowed_models` through `GET /capabilities`. Set the list on
  your `LLMProvider`; see [Configuration](./configuration.md#models).
