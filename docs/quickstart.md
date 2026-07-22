# Quickstart

Two ways to go from nothing to a running workspace. Read the one that matches
what you are trying to do.

- **[Path A — run the reference stack](#path-a--run-the-reference-stack)** with
  one command, to see a builder in your browser and describe an app to it. Start
  here if you are evaluating.
- **[Path B — embed it in your product](#path-b--embed-it-in-your-product)**: one
  React component and one mounted router. Start here once you know you want it.

> [!IMPORTANT]
> **Pre-release — the code lands with v0.1.** The commands below are the real,
> intended commands, and the files they reference exist in this repository today.
> But the npm packages, the PyPI package, and the bundler image do not ship until
> the **v0.1 code drop**. Run the stack now and it comes up and answers
> `GET /api/builder/capabilities`, while every working route returns
> `501 {"error": "not yet implemented — v0.1"}` and the reference adapters raise
> `NotImplementedError`. It becomes a working builder with v0.1. **Watch or star
> the repository to be notified.** Everything on this page is written to be
> correct the day that code lands.

---

## Path A — run the reference stack

The reference stack is three services: the **web** workspace, the **agent**
router, and the **bundler** build service. One compose file wires them together.

### 1. Get the repository

```bash
git clone https://github.com/speculosai/spec_harness
cd speculos-harness
```

### 2. Provide one model key

The agent needs one LLM key to call a model. Copy the example environment file
and edit in your own key:

```bash
cp examples/minimal/backend/.env.example examples/minimal/backend/.env
# then open the file and set OPENAI_API_KEY=sk-your-real-key
```

The value in `.env.example` is a placeholder (`sk-your-key-here`). The source
never contains a real secret — everything comes from the environment, which is
why these files are safe to commit and share. If you would rather run a free,
local model, point `HARNESS_MODEL` at `ollama/llama3.3` and you need no key at
all (see [Configuration](./configuration.md)).

### 3. Bring it up

```bash
docker compose up
```

That builds and starts all three services:

| Service | What it is | Port |
|---|---|---|
| `web` | the React workspace (`<Builder>`) | `5173` |
| `agent` | the mountable FastAPI router (`speculos-harness`) | `8000` |
| `bundler` | the build service — `{files, deps}` in, `{code, css}` out | `8081` |

The `web` service talks to `agent` over the wire protocol; `agent` calls
`bundler` every time a file changes to turn the project into a running app.

### 4. Open it

Go to **http://localhost:5173**. Type a request — for the running example that
means something a **Northwind Property Group** operator would ask, like "show me
arrears by building, worst first" — and watch the generated app render beside the
conversation and rebuild as the agent works. There is no "run" button: every file
change re-bundles and refreshes.

### What just happened

1. Your message went to `POST /api/builder/chat`, which streamed the agent's
   work back as [server-sent events](../spec/chat-protocol.md).
2. Each time the agent wrote a file, the client asked the bundler to rebuild and
   refreshed the [null-origin preview iframe](../spec/preview-bridge.md).
3. If the app had crashed, you would have seen a readable fallback and the agent
   would have been asked to repair it — once, so it can never loop.
4. Every turn was captured as a version you can inspect and restore.

### Adding real data

Path A with no connectors builds file-only apps. To let the generated app query a
live database or an MCP server, add connectors to the backend — see
[Connectors](./connectors.md). The `instructions` brief, the model picker, and
metering are all backend configuration; see [Configuration](./configuration.md).

---

## Path B — embed it in your product

Embedding is the headline use case: the same workspace, inside your product, on
your infrastructure, with your login and your data. It is one component on the
frontend and one router on the backend.

### 1. Install the frontend package

```bash
npm install @speculos-harness/react
```

### 2. Render the workspace

One provider tells the workspace where the backend lives and how to prove who is
asking; one component is the workspace itself.

```tsx
import { HarnessProvider, Builder } from '@speculos-harness/react'
import '@speculos-harness/react/styles.css'

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

The backend is a single router you mount on an existing FastAPI application (or
run standalone as a sidecar beside Flask, Rails, or any other stack — it speaks
the protocol over HTTP regardless of what serves your product).

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
        model="openai/gpt-4.1",
        api_key=os.environ["OPENAI_API_KEY"],
    ),
    bundler_url="http://bundler:8081",           # the build-service sidecar
    namespace="app",                             # MUST match the frontend
)

app.include_router(agent.router, prefix="/api/builder")
```

The router mounts `/chat` (SSE), `/bundle/{id}`, `/projects` (with `/projects/{id}/snapshots` and `/projects/{id}/rollback`),
`/capabilities`, and `/connectors/{kind}` under your prefix.

### 4. Run the build service

The bundler is not code you write — you run it. It is published as a locked-down
container (non-root, ephemeral build directories, installs always run with
`--ignore-scripts`):

```yaml
# docker-compose.yml
services:
  bundler:
    image: speculos/harness-bundler
    ports: ["8081:8081"]
```

### That is the whole integration

One React component, one mounted router, one sidecar. The reference
[`examples/minimal`](../examples/minimal/) is exactly this, wired together — read
it top to bottom. From here:

- **[Configuration](./configuration.md)** — set your default model, the picker's
  menu, the instructions brief, and metering.
- **[Embedding](./embedding.md)** — cross-origin embedding, read-only viewers,
  styling, and white-labeling.
- **[Connectors](./connectors.md)** — give the agent live data.
- **[Adapters](./adapters.md)** — replace storage, auth, the model layer, or the
  bundler with your own.

## Troubleshooting

- **The preview loads but shows no data.** The most common integration bug is a
  `namespace` mismatch. The value passed to `<HarnessProvider namespace>` must
  equal the `namespace` on `HarnessAgent`. It is bound in three places (the
  prompt, the generated code, and the bridge) that must agree — see the
  [preview bridge spec](../spec/preview-bridge.md).
- **Cross-origin requests fail in the browser.** You are probably in cookie mode
  with a wildcard CORS origin, which the browser refuses for credentialed
  requests — and which the server refuses to start with, by design. Use bearer
  mode, or set an explicit per-origin allowlist. See the cross-origin recipe in
  [Embedding](./embedding.md) and [`spec/security.md`](../spec/security.md).
- **`501 not yet implemented`.** Expected before v0.1 — see the pre-release note
  at the top of this page.
