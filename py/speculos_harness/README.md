# speculos-harness (Python backend kit)

The mountable backend for [Speculos Harness](https://speculos.ai) - an
embeddable AI app-building workspace. You hand `HarnessAgent` your LLM,
storage, auth, and data connectors, and mount one FastAPI router. It speaks
the versioned Harness wire protocol (a seven-event SSE chat stream, a
`{files} -> {code,css}` bundle call, and a `postMessage` preview bridge), so a
single `@speculosai/spec_harness` frontend talks to it unchanged.

This is the same agent loop that runs behind Speculos in production - moved,
not rewritten. One loop, in one language, on the revenue path.

## Install

```bash
pip install speculos-harness
```

Requires Python 3.11+.

## Mount the agent

The reference backend is Python. You mount a router on any FastAPI/ASGI app
and hand it adapters; non-Python or WSGI stacks run it standalone as a sidecar
speaking the same protocol.

```python
# main.py - a complete Speculos Harness backend
import os
from fastapi import FastAPI, Request
from speculos_harness import HarnessAgent, AuthProvider, AuthDenied, Principal
from speculos_harness.stores import SQLiteProjectStore
from speculos_harness.llm import LiteLLMProvider
from speculos_harness.connectors import postgres_connector, mcp_connector

app = FastAPI()


class MyAuth(AuthProvider):
    async def resolve(self, request: Request):
        user = await my_session_lookup(request.cookies.get("session"))
        if not user:
            return None                                   # -> plain 401
        if user.blocked:                                  # authed but blocked
            return AuthDenied(status=402, message="upgrade required")
        return Principal(user_id=user.id, can_edit=True,
                         scope={"tenant": user.org_id})


agent = HarnessAgent(
    store=SQLiteProjectStore("./harness.db"),             # or your own ProjectStore
    llm=LiteLLMProvider(                                  # any LiteLLM-supported provider
        model="anthropic/claude-fable-5",                 # company-wide default
        api_key=os.environ["ANTHROPIC_API_KEY"],
        allowed_models=[                                  # the in-chat model picker's menu
            "anthropic/claude-fable-5",
            "openai/gpt-5.6-sol",
            "zai/glm-5.2",                                # open weights
        ],
        supports_prompt_cache=True,
    ),
    auth=MyAuth(),                                        # default: single-user, always allowed
    instructions="""
        We are Northwind Property Group.
        Amounts are USD. The fiscal year runs April to March.
        Every table needs a CSV export button.
    """,
    bundler_url="http://bundler:8081",                    # the speculosai/harness-bundler (the build-service image) sidecar
    namespace="app",                                      # MUST match the frontend + generated apps
    connectors=[                                          # optional; omit => file/package tools only
        postgres_connector(dsn=os.environ["DATABASE_URL"]),
        mcp_connector(url="https://your-mcp-host.example/notion"),
    ],
    # telemetry=Metering(),                               # optional; see below
)

app.include_router(agent.router, prefix="/api/builder")
```

That mounts the full route surface under the prefix:

| Route | Method | Behavior |
|---|---|---|
| `/chat` | POST | hand-rolled SSE agent stream (the seven Harness events) |
| `/bundle/{id}` | POST | proxy to the bundler sidecar + connector scoping |
| `/projects[/{id}]` | GET/POST/PATCH | the minimal `Project` store surface |
| `/projects/{id}/snapshots`, `/projects/{id}/rollback` | GET/POST | version timeline + rollback |
| `/capabilities` | GET | capability negotiation for the frontend |
| `/connectors/{kind}` | POST | the mounted `ConnectorProvider.handle` |

## Adapters

Every interface has a shipped default, so the core boots with zero
configuration. Swap any one out without touching the others.

- **`ProjectStore`** - `SQLiteProjectStore` / `FsProjectStore`, or your own.
  `put_files` is a full-replace transactional write; snapshots are owned by
  the agent, not the store. Snapshot methods are optional; when a store omits
  them, `/capabilities` hides the version timeline.
- **`LLMProvider`** - `LiteLLMProvider` speaks whatever LiteLLM speaks, so
  adding a model is a configuration change. Inference is billed by your
  provider, on your keys - no markup. Point `api_base` at an existing LiteLLM
  proxy to inherit its keys, budgets, and spend logs. The optional `route_for`
  hook is the seam a per-task routing policy plugs into; write your own, or
  use the closed-beta dynamic routing module.
- **`AuthProvider`** - `resolve(request)` returns a `Principal`, an
  `AuthDenied(status=401|402|403, message=...)` for the authed-but-blocked
  case, or `None` for a plain 401. Default: single-user, always allowed.
- **`ConnectorProvider`** - reference `postgres_connector(dsn=...)` and
  `mcp_connector(url=...)`. Each bundles agent tools, its own system-prompt
  lines, and the runtime bridge the generated app fetches through. Connectors
  resolve per-request against the `Principal` scope; credentials stay
  server-side. The wider governed catalog is a closed-beta module.
- **`TelemetrySink`** - `on_generation(e)` fires after every generation with
  `e.model`, `e.principal`, and `e.usage` (input/output/cache-read/cache-write
  tokens reported separately, because providers bill them differently).

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
```

## The bundler is not code you write

You run it. It is a locked-down container that takes `{files, deps}` and
returns `{code, css}`, called every time a file changes:

```yaml
# docker-compose.yml (shipped)
services:
  bundler: { image: speculosai/harness-bundler, ports: ["8081:8081"] }
```

## Modules in closed beta

The open-source core is complete on its own. Speculos also runs commercial
modules that plug into the same deployment: the prompt log, the governed
connector catalog, and dynamic model routing. They are delivered with design
partners and deployed on your own servers -
[talk to our team](https://speculos.ai/enterprise).

## License

Apache-2.0. See [LICENSE](../../LICENSE).
