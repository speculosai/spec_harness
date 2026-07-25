# Minimal example - Northwind Property Group

The smallest complete Speculos Harness deployment: one React page, one FastAPI
backend, one bundler sidecar. An operator at Northwind Property Group opens the
workspace, types "show me arrears by building, worst first", and watches the
dashboard get built and run.

## Quickstart

One key, one command:

```bash
git clone https://github.com/speculosai/spec_harness
cd spec_harness/examples/minimal
export ANTHROPIC_API_KEY=sk-ant-...   # any LiteLLM-supported provider works
docker compose up
```

Three services come up: the example web app, the agent, and the bundler. Open
http://localhost:5173 and describe an app.

## What you see when it comes up

- **A branded workspace.** The chat panel sits beside a live preview, wearing
  Northwind's name and logo (`brand={{ name, Logo }}`) and its wording
  (`strings`). Nothing is forked to rebrand it.
- **A house build brief.** `backend/main.py` sets `instructions` once - amounts
  in USD, a fiscal year that runs April to March, the Northwind design system, a
  CSV export button on every table - so every generated app follows the rules
  without the user restating them.
- **A live, self-healing preview.** Each file the agent writes re-bundles and
  refreshes the sandbox; a failed build shows a readable fallback and the agent
  repairs it, once per build.
- **A file explorer and version timeline.** Every turn is a restorable version,
  so an operator sees and undoes exactly what changed.

This example ships **no connectors**, so the agent has file and package tools
only - enough to build a dashboard from a pasted CSV. To point it at a live
database, see [`../with-connectors`](../with-connectors), which adds Postgres
and MCP.

## Layout

```
minimal/
├── backend/
│   ├── main.py             # the whole server: LiteLLMProvider + SQLiteProjectStore + HarnessAgent
│   ├── requirements.txt    # speculos-harness + an ASGI server
│   ├── Dockerfile          # the agent service
│   └── .env.example        # placeholder key + model + bundler URL
├── web/
│   ├── BuilderPage.tsx     # <HarnessProvider> + <Builder> - the whole embed
│   ├── NorthwindLogo.tsx   # placeholder logo for the brand slot
│   ├── main.tsx            # Vite entry: mounts BuilderPage
│   ├── index.html
│   ├── vite.config.ts      # proxies /api/builder to the agent
│   ├── Dockerfile          # the web service
│   ├── package.json        # @speculos-harness/react + react
│   └── README.md
└── docker-compose.yml      # web + agent + bundler, one command
```

One React component, one mounted router, one sidecar. See
[`docker-compose.yml`](./docker-compose.yml) for the topology.

## Environment

`docker compose up` reads `ANTHROPIC_API_KEY` from your shell. Running the
backend on its own, copy `backend/.env.example` to `backend/.env` instead. Every
value shown is an obvious placeholder - never commit a real key.

| Variable | Required | Example (placeholder) | What it does |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | `sk-ant-...` | The provider key the default model reads. Swap the model and the key together for any other provider. |
| `HARNESS_MODEL` | no | `anthropic/claude-fable-5` | Company-wide default model, in LiteLLM notation. Defaults to `anthropic/claude-fable-5`. |
| `LITELLM_PROXY` | no | `http://your-litellm-proxy:4000` | Route through an existing LiteLLM proxy to inherit its budgets, keys, and spend logs. Unset = call the provider directly. |
| `BUNDLER_URL` | no | `http://bundler:8081` | Where the build-service sidecar is reachable. Defaults to the compose `bundler` service. |

The in-chat model picker offers `anthropic/claude-fable-5`,
`openai/gpt-5.6-sol`, and `zai/glm-5.2` (open weights) - edit `allowed_models`
in `backend/main.py` to change the menu. Inference is billed by your provider,
on your keys - no markup.

## Turning on real auth

The example runs single-user: every request resolves to an editing local user.
`backend/main.py` carries a commented-out `MyAuth` showing the three outcomes
the interface supports - allow (return a `Principal`), plain 401 (return
`None`), and a typed in-band denial for an authenticated-but-blocked caller
(return `AuthDenied(status=402, message="upgrade required")`, which your
frontend turns into an upgrade prompt). Uncomment it, wire your session lookup,
and pass `auth=MyAuth()` to `HarnessAgent`.
