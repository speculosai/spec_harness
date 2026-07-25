# Configuration

The company-wide settings a backend administrator sets once, in the
`HarnessAgent(...)` constructor, so every user and every build inherits them.
This is the backend counterpart to [Embedding](./embedding.md). To replace a
whole subsystem - your own storage, model layer, or auth - see
[Adapters](./adapters.md); to give the agent live data, see
[Connectors](./connectors.md).

Everything here is a constructor argument:

```python
agent = HarnessAgent(
    store=...,          # required - where projects live
    llm=...,            # required - the model layer
    auth=...,           # optional - defaults to single-user
    connectors=[...],   # optional - data sources
    instructions="...", # optional - the org-wide build brief
    bundler_url="...",  # the build-service sidecar
    namespace="app",    # the runtime namespace (must match the frontend)
    tools=[...],        # optional - extra agent tools
    telemetry=...,      # optional - metering / analytics
)
app.include_router(agent.router, prefix="/api/builder")
```

## Models

The two settings teams ask about first are the company-wide default model and
the set of models a user may switch to from the in-chat picker. Both live on the
reference `LiteLLMProvider`. Inference is billed by your provider, on your keys,
with no markup.

```python
import os
from speculos_harness.llm import LiteLLMProvider

agent = HarnessAgent(
    llm=LiteLLMProvider(
        model="anthropic/claude-fable-5",       # the company-wide default
        allowed_models=[                        # what the in-chat picker offers
            "anthropic/claude-fable-5",
            "openai/gpt-5.6-sol",
            "zai/glm-5.2",                      # open weights
        ],
        api_key=os.environ["ANTHROPIC_API_KEY"],
        supports_prompt_cache=True,             # place prompt-cache breakpoints
    ),
    ...
)
```

- **`model`** is the default every turn uses unless the user picks another.
- **`allowed_models`** is the picker's menu, surfaced to the client through
  `GET /capabilities`. Leave it empty (or set only the default) and the picker
  hides itself. A per-turn `model` override is honored only if it is in this
  set, so an omitted list also means "no overrides".
- **`supports_prompt_cache`** tells the loop whether to place cache breakpoints,
  which makes repeat turns cheaper and faster on models that support it.

Because `LiteLLMProvider` speaks whatever LiteLLM speaks, switching between
Anthropic, OpenAI, Bedrock, open-weights models, or a LiteLLM proxy is a config
change, not a code change. Adding a model is a config change too.

To wrap a different gateway entirely, write an `LLMProvider`; see
[Adapters](./adapters.md#llmprovider). That interface also carries the optional
`route_for` hook, the seam a per-task routing policy plugs into - yours to
implement, and the one Speculos ships is a
[closed-beta module](./faq.md#what-is-open-source-and-what-is-a-closed-beta-module).

## The instructions brief

`instructions` is a standing brief injected into the system prompt on **every**
turn. It is where an administrator sets house rules once, instead of every user
restating them on every request.

```python
agent = HarnessAgent(
    instructions="""
        We are Northwind Property Group, a property-management company.
        - All monetary amounts are in US dollars (USD). Format them like $1,234.56.
        - The fiscal year runs April 1 to March 31; quarter labels follow it.
        - Use the Northwind design system for every app.
        - Every table must have an "Export CSV" button that downloads the visible rows.
        - Prefer clear, dense operator dashboards over marketing-style layouts.
    """,
    ...
)
```

### Your design system belongs here

The design system your generated apps must follow goes in this same brief, so
every app comes out looking like it belongs in your product. Describe the
tokens, the components, and the patterns: "use our `Card` and `Table`
components", "headings are Inter semibold", "accent is `#0b7285`", "tables are
dense with zebra striping".

One piece of advice, because it saves real money: **a big token set belongs in a
template, not in `instructions`.** The brief is prepended to every turn, so a
thousand-line design-system dump is paid for on every request, forever. Put the
bulk of a large design system in a starter template's files, which the agent
reads only when relevant and which prompt caching handles efficiently, and keep
`instructions` to the short, always-true rules. A tight brief plus a rich
template is cheaper and sharper than a giant brief.

## The namespace

`namespace` is the runtime namespace bound into three places that must agree:
the system prompt (what the agent is told to emit), the generated app code
(`window.<ns>.*`), and the preview bridge (`<ns>-*` messages). It defaults to
`"app"`.

```python
agent = HarnessAgent(namespace="app", ...)   # must equal <HarnessProvider namespace="app">
```

The one rule: **the value here must match `<HarnessProvider namespace>` on the
frontend.** When they disagree, the preview loads fine but silently returns no
data, the single most common integration failure. It is one config constant
precisely so it cannot drift across the three sites. You rarely need to change
the default; if you do - say, to avoid a collision with an existing `window`
global on your page - change it in both places at once. The full triple-binding
rationale is in [`spec/preview-bridge.md`](../spec/preview-bridge.md).

## The bundler

`bundler_url` points at the build-service sidecar (`speculos/harness-bundler`).
The agent calls it whenever a file changes to turn the project into a running
app.

```python
agent = HarnessAgent(bundler_url="http://bundler:8081", ...)
```

In the shipped `docker-compose`, `http://bundler:8081` resolves to the `bundler`
service. The bundler ships only as a locked-down container - non-root, ephemeral
build directories, installs always with `--ignore-scripts` - and it refuses to
start if any of those invariants is misconfigured away. Its full contract, the
baked base dependency set (react, recharts, `@tanstack/react-table`, date-fns,
lucide-react), and the strict-CSP inlined-CSS option are in
[`spec/bundle.md`](../spec/bundle.md). To swap the server bundler for something
else, implement a `Bundler`; see [Adapters](./adapters.md#bundler).

## Metering

There are two independent ways to meter, and they compose.

### Route through a LiteLLM proxy

If you already run a LiteLLM proxy, point the provider at it with `api_base`.
Your existing keys, budgets, rate limits, and spend dashboards then cover
builder traffic like any other workload - no new billing surface to build.

```python
llm = LiteLLMProvider(
    model="anthropic/claude-fable-5",
    api_base="http://your-litellm-proxy:4000",   # route through your existing proxy
    api_key=os.environ["ANTHROPIC_API_KEY"],
)
```

### A `TelemetrySink` for your own metering

For per-seat billing, team caps, or a usage graph you own, a telemetry hook
fires after every generation with the model, the `Principal` who ran it, and the
token counts. Cache reads and writes are reported separately from fresh input
tokens, because providers bill them differently.

```python
from speculos_harness import TelemetrySink

class Metering(TelemetrySink):
    def on_generation(self, e):
        usage.record(
            user=e.principal.user_id,
            model=e.model,
            tokens_in=e.usage.input_tokens,
            tokens_out=e.usage.output_tokens,
            cache_read=e.usage.cache_read_tokens,     # billed cheaply - keep it separate
            cache_write=e.usage.cache_write_tokens,
            latency_ms=e.latency_ms,
        )

agent = HarnessAgent(..., telemetry=Metering())
```

The default sink is a no-op, so metering is entirely opt-in. The full interface,
including the generic `on_event(name, props)` hook, is in
[Adapters](./adapters.md#telemetrysink).

## Auth

The default is single-user: every request resolves to an editing local user,
which is what you want on a laptop or a single-tenant deploy. To put the
workspace behind your real sessions - and to express "authenticated but not
entitled", a `402` upgrade gate - pass an `AuthProvider`:

```python
agent = HarnessAgent(auth=MyAuth(), ...)
```

The `Principal` it returns follows the request everywhere: it scopes which
projects a user sees, tags their token usage in the telemetry hook, and decides
what their connectors may touch. Writing one, including the three outcomes
(allow, plain `401`, typed `AuthDenied`), is in
[Adapters](./adapters.md#authprovider).

## Extra tools

`tools=[...]` appends your own `AgentTool`s to the built-ins (`write_file`,
`edit_file`, `read_file`, `delete_file`, `install_package`). Each tool
co-locates its schema, its availability rule, its system-prompt lines, and its
executor, so a tool and the prompt text that describes it move as one unit. See
[Adapters](./adapters.md#agenttool). Connectors contribute their own tools
automatically - you do not list a connector's tools here; see
[Connectors](./connectors.md).

## A complete backend

The common settings together - essentially
[`examples/minimal/backend/main.py`](../examples/minimal/backend/main.py):

```python
import os
from fastapi import FastAPI
from speculos_harness import HarnessAgent
from speculos_harness.stores import SQLiteProjectStore
from speculos_harness.llm import LiteLLMProvider

app = FastAPI()

agent = HarnessAgent(
    store=SQLiteProjectStore("./projects.db"),
    llm=LiteLLMProvider(
        model="anthropic/claude-fable-5",
        api_key=os.environ["ANTHROPIC_API_KEY"],
        api_base=os.environ.get("LITELLM_PROXY"),   # optional proxy
        allowed_models=[
            "anthropic/claude-fable-5",
            "openai/gpt-5.6-sol",
            "zai/glm-5.2",                          # open weights
        ],
    ),
    instructions=(
        "We are Northwind Property Group. Amounts are in USD. "
        "The fiscal year runs April to March. "
        "Use the Northwind design system for every app."
    ),
    bundler_url="http://bundler:8081",
    namespace="app",
)

app.include_router(agent.router, prefix="/api/builder")
```

Nothing above is secret in the source - every value comes from the environment,
which is why the file is safe to commit. Use obvious placeholders like
`sk-ant-...` in your example env files, and keep real keys out of git.
