# Minimal example — Northwind Property Group

The smallest complete Speculos Harness deployment: one React page, one FastAPI
backend, one bundler sidecar. Clone, add a key, and run — an operator at
Northwind Property Group opens the workspace, types "show me arrears by
building, worst first", and watches the dashboard get built and run against
their data.

> [!IMPORTANT]
> **Pre-release — code lands with v0.1.** Every file here is real, against the
> decided public API, and safe to read and copy today. But the packages are
> published spec-first: boot the backend now and it answers `/capabilities`
> while every working route returns `501 not yet implemented`; the frontend
> components throw. The three commands below produce a working builder with the
> **v0.1 code drop**. Watch or star the repo to follow.

## What you get

- **A branded workspace.** The chat panel sits beside a live preview, wearing
  Northwind's name and logo (`brand={{ name, Logo }}`) and its wording
  (`strings`). Nothing is forked to rebrand it.
- **A house build brief.** `main.py` sets an `instructions` brief once — amounts
  in USD, a fiscal year that runs April to March, a "Export CSV" button on every
  table — so every generated app follows the rules without the user restating
  them.
- **A live, self-healing preview.** Each file the agent writes re-bundles and
  refreshes the sandbox; a build or runtime failure shows a readable fallback
  and asks the agent to repair it, once.
- **A file explorer and version timeline.** Every turn is a restorable version,
  so an operator can see and undo exactly what changed.

This example ships **no connectors**, so the agent has file and package tools
only — enough to build a dashboard from a pasted CSV. To point it at a live
database, see [`../with-connectors`](../with-connectors), which adds Postgres
and MCP.

## The three commands (at v0.1)

```bash
cp backend/.env.example backend/.env    # 1. add your key
# edit backend/.env — set OPENAI_API_KEY

docker compose up                       # 2. bring up web + agent + bundler

open http://localhost:5173              # 3. build a tool by asking for one
```

That is the whole thing: one React component, one mounted router, one sidecar.
See [`docker-compose.yml`](./docker-compose.yml) for the topology.

## Layout

```
minimal/
├── backend/
│   ├── main.py             # the whole server: LiteLLMProvider + SQLiteProjectStore + HarnessAgent
│   ├── requirements.txt    # speculos-harness + an ASGI server
│   └── .env.example        # placeholder key + model + bundler URL
├── web/
│   ├── BuilderPage.tsx     # <HarnessProvider> + <Builder> — the whole embed
│   ├── NorthwindLogo.tsx   # placeholder logo for the brand slot
│   ├── package.json        # @speculos-harness/react + react
│   └── README.md
└── docker-compose.yml      # web + agent + bundler, one command
```

## Environment

Set these in `backend/.env` (copy from `backend/.env.example`). Every value
shown is an obvious placeholder — never commit a real key.

| Variable | Required | Example (placeholder) | What it does |
|---|---|---|---|
| `OPENAI_API_KEY` | yes | `sk-your-key-here` | The provider key the default model reads. Swap the model and key together for Anthropic, Bedrock, or a local model. |
| `HARNESS_MODEL` | no | `openai/gpt-4.1` | Company-wide default model, in LiteLLM notation. Defaults to `openai/gpt-4.1`. |
| `LITELLM_PROXY` | no | `http://your-litellm-proxy:4000` | Route through an existing LiteLLM proxy to inherit its budgets, keys, and spend logs. Unset = call the provider directly. |
| `BUNDLER_URL` | no | `http://bundler:8081` | Where the build-service sidecar is reachable. Defaults to the compose `bundler` service. |

The in-chat model picker offers `openai/gpt-4.1`, `anthropic/claude-sonnet-5`,
and `ollama/llama3.3` (a free local option) — edit `allowed_models` in
`backend/main.py` to change the menu.

## Turning on real auth

The example runs single-user: every request resolves to an editing local user.
`backend/main.py` carries a commented-out `MyAuth` showing the three outcomes
the interface supports — allow (return a `Principal`), plain 401 (return
`None`), and a typed in-band denial for an authenticated-but-blocked caller
(return `AuthDenied(status=402, message="upgrade required")`, which your
frontend can turn into an upgrade prompt). Uncomment it, wire your session
lookup, and pass `auth=MyAuth()` to `HarnessAgent`.
