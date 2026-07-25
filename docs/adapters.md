# Adapters

Every subsystem the agent depends on - storage, the model layer, auth, data
connectors, the bundler, extra tools, telemetry - is an interface with a shipped
default. This page is the authoring guide: what each interface means, the
semantics that matter, and the ones you can get subtly wrong.

The interfaces are defined once, in TypeScript, in
[`packages/protocol`](../packages/protocol/), and mirrored 1:1 as Python
`Protocol`s in the agent kit (`speculos_harness.interfaces`). The wire *data*
shapes are generated from a single source so they cannot drift; the *behavioral*
interfaces here are hand-maintained in both languages and guarded by a
signature-drift check plus the conformance suite every reference adapter passes.
This page uses the Python names, since adapters run server-side.

Because every interface has a default, the core boots with zero configuration.
You implement an interface only when you want to replace what ships.

| Interface | Replaces | Default |
|---|---|---|
| [`AuthProvider`](#authprovider) | your session/auth gate | single-user (always allows) |
| [`LLMProvider`](#llmprovider) | your model gateway | `LiteLLMProvider` |
| [`ProjectStore`](#projectstore) | your persistence | `SQLiteProjectStore` / `FsProjectStore` |
| [`Bundler`](#bundler) | the build service | the Bun.build sidecar |
| [`AgentTool`](#agenttool) | nothing (additive) | five built-in file tools |
| [`ConnectorProvider`](#connectorprovider) | a data source | Postgres, MCP (see [Connectors](./connectors.md)) |
| [`TelemetrySink`](#telemetrysink) | your metering | no-op |

---

## AuthProvider

Turns an inbound request into a caller. One method, three outcomes.

```python
from speculos_harness import AuthProvider, AuthDenied, Principal

class MyAuth(AuthProvider):
    async def resolve(self, request):
        user = await my_session_lookup(request.headers.get("authorization"))
        if user is None:
            return None                                    # -> plain 401
        if user.plan_expired:
            return AuthDenied(status=402, message="upgrade required")   # authed but blocked
        return Principal(
            user_id=user.id,
            can_edit=True,
            scope={"tenant": user.org_id},                 # scopes projects + connector data
        )
```

### The three return values

- **`Principal`** - allow. It carries `user_id`, `can_edit`, and an opaque
  `scope`. The `Principal` then follows the request everywhere: it scopes which
  projects the caller sees, tags their token usage in telemetry, and decides
  what their connectors may touch.
- **`None`** - a plain `401`. Unauthenticated; we do not know who this is.
- **`AuthDenied(status, message)`** - a typed, in-band denial for someone we
  *do* know but who cannot proceed. Status is `401`, `402`, or `403`. This is
  what lets a billing gate return `402` cleanly instead of raising an exception
  around the abstraction: "we know who you are, but you need to upgrade."

The `402` case is the one people miss and the reason the return type is a union
rather than "principal or throw". Model an entitlement gate as `AuthDenied`, and
the frontend turns it into an upgrade prompt instead of a stack trace.

### `can_edit` is the real boundary

`Principal.can_edit=False` is enforced by the router: a viewer cannot mutate a
project even if they call the API directly. The frontend's `auth.canEdit` only
hides the composer - a convenience, not the boundary. Set both; trust the server
one. (See [Embedding](./embedding.md#read-only-viewers-canedit).)

### The default

`single_user()` - always allows, returns `Principal(user_id="local",
can_edit=True)`. Right for a laptop or a single-tenant deploy; replace it the
moment real sessions matter.

---

## LLMProvider

The model layer. The reference `LiteLLMProvider` covers Anthropic, OpenAI,
Bedrock, open-weights models, and a LiteLLM proxy through config alone, so most
teams never write one. Implement `LLMProvider` to wrap a different gateway, or
to route the model per task.

```python
class LiteLLMProvider(LLMProvider):
    def config_for(self, ctx): ...            # -> {model, api_key?, api_base?, supports_prompt_cache?, extra?}
    def allowed_models(self, principal): ...  # optional -> the picker's menu
    def stream(self, messages, tools, cfg, signal): ...   # -> AsyncIterable[LLMDelta]
    def is_context_window_error(self, err): ...
    def route_for(self, ctx): ...             # optional -> the per-task routing seam
```

### The methods

- **`config_for(ctx)`** resolves the config for one call. `ctx` carries an
  optional `requested_model` (a per-turn override) and the `principal`. Returns
  at least a `model`, plus optional `api_key`, `api_base`,
  `supports_prompt_cache`, and provider `extra`.
- **`allowed_models(principal)`** (optional) is the model picker's menu,
  surfaced through `/capabilities`. Omit it, or return only the default, to hide
  the picker.
- **`stream(messages, tools, cfg, signal)`** streams the completion as
  `LLMDelta` items (text deltas and tool-call deltas). `signal` aborts it.
- **`is_context_window_error(err)`** tells the loop whether an error is a
  context-window overflow, which drives the shrink-and-retry path: on `True` the
  loop trims history and retries rather than surfacing an error.

### Two rules that bite reimplementers

- **`tools` MUST be `None` in plan mode - never `[]`.** Plan mode strips all
  tools so the agent proposes an approach before writing code. Some providers
  (Bedrock) reject an empty tools array; the type is `list[ToolSchema] | None`
  precisely to encode this. Pass `None`, not `[]`.
- **Respect `supports_prompt_cache`.** When true, place prompt-cache breakpoints
  so repeat turns are cheaper; when false, do not. Per-model quirks like this
  are the provider's job to honor for whichever model it serves.

### `route_for`: the model-routing seam

`route_for(ctx)` is the optional hook for picking a model per task - a
deeper-thinking model for `plan`, a fast cheap one for `analyze` (crunching a
CSV). The hook is part of the open-source interface and yours to implement with
whatever policy you want. The ready-made routing policy Speculos ships is a
[closed-beta module](./faq.md#what-is-open-source-and-what-is-a-closed-beta-module),
not part of the core.

The rules are strict either way, because a surprising model switch is worse than
none:

- It is **consulted only when the user has not explicitly picked a model.** An
  explicit per-turn `model` always wins.
- The routed choice **must come from `allowed_models`.** Routing never reaches
  for a model the picker would not offer.
- When a provider implements it, `/capabilities` advertises `routing: true`, and
  the provider still honors each routed model's quirks (`tools=None`,
  prompt-cache support).

Leave `route_for` unimplemented and every turn uses the configured default.

---

## ProjectStore

Project, file, history, and snapshot persistence. Replaces a remote-storage hop
with a local interface. Reference impls: `SQLiteProjectStore` (one file) and
`FsProjectStore` (a directory).

```python
class MyStore(ProjectStore):
    async def get_project(self, id): ...
    async def create_project(self, input): ...
    async def patch_project(self, id, patch): ...
    async def get_files(self, id): ...
    async def put_files(self, id, files): ...          # FULL REPLACE, transactional
    async def get_messages(self, id): ...
    async def save_messages(self, id, messages): ...
    # optional snapshot surface:
    async def create_snapshot(self, id, s): ...
    async def list_snapshots(self, id): ...
    async def get_snapshot(self, id, snapshot_id): ...
```

### `put_files` is full-replace and transactional

This is the semantics to get right. `put_files(id, files)` **replaces the entire
file map atomically.** It is not a merge, not a patch - the whole set is
swapped, and a partial write must never be observable. If your storage cannot do
the swap atomically, wrap it in a transaction; a half-applied file map is a
corrupted project.

The agent works this way on purpose: it reads the whole map, computes the new
whole map, and writes it back. There is no per-file diff at the persistence
layer. Which means the safety net for a bad write is not a merge algorithm - it
is snapshots.

### `save_messages` is called often

The conversation is persisted at several points: before the stream starts, after
each tool runs, at `done`, and in the loop's `finally`. That frequency is what
lets a stopped or dropped turn reappear intact on reload, and keeps an
interrupted turn from corrupting the next one. Persist the full list each time;
do not try to be clever about appending only deltas.

### Snapshots are optional, and owned by the agent

The three snapshot methods (`create_snapshot`, `list_snapshots`,
`get_snapshot`) are optional. Omit them and the core degrades gracefully:
`/capabilities` reports no snapshot support and the version timeline and
rollback UI hide themselves. The rest of the workspace works unchanged. Both
reference stores implement them, so the version timeline works out of the box.

Two semantics when you do implement them:

- **The agent decides when to snapshot, not the store.** The loop takes a
  pre-turn snapshot before it starts writing; the store just persists what it is
  handed. Do not snapshot on your own schedule.
- **Keep about 30 pre-turn snapshots**, pruning the oldest. That is the depth
  the version timeline exposes as restorable.

A snapshot record is `{id, messageIndex, createdAt, kind}` where `kind` is
`"pre-turn"` or `"undo"` (a rollback captures an undo snapshot first, so a
rollback is itself undoable). `get_snapshot` additionally returns the captured
`files` and `messages`.

---

## Bundler

Turns `{files, deps}` into browser-ready `{code, css}`. Usually a thin client
for the `@speculos-harness/bundler` sidecar. A browser-side (esbuild-wasm)
implementation, `@speculos-harness/sandbox-browser`, is on the core roadmap: it
ships once a shared bundler conformance suite proves it produces equivalent
output, and until then `/capabilities` advertises server bundling.

```python
class MyBundler(Bundler):
    async def bundle(self, files, deps, signal=None): ...   # -> {code, css} | {error}
    @property
    def caps(self): ...                                     # BundlerCaps
```

- **`bundle(...)`** returns `{code, css}` on success or `{error}` on a build
  failure. The client renders the readable fallback and asks the agent to repair
  the code on `{error}`.
- **`caps`** is a static descriptor the client negotiates against: `location`
  (`"server"` or `"browser"`), `supports_install` (whether `install_package` is
  meaningful), and `jsx_runtime` (`"automatic"` or `"classic"`).

`caps` is how a single client adapts to different bundlers: against a browser
bundler it advertises `supports_install: false`, so the client hides on-demand
installs and the app resolves dependencies from a CDN instead. When
`supports_install` is true, the paired `PackageInstaller.install(name, version)`
does the work - and it **must** keep `--ignore-scripts`, so an installed package
can never run install-time scripts on the build host. That is a security
invariant, not a preference; the reference bundler's startup self-check refuses
to run if it is dropped. Full contract in [`spec/bundle.md`](../spec/bundle.md).

---

## AgentTool

A tool the agent can call, with everything it needs in one place: the schema,
the availability rule, the system-prompt lines, and the executor. This
co-location is deliberate - historically a tool's schema, its executor, and the
prompt text describing it lived in three files and drifted apart. Here they move
as one unit.

```python
class ExportPdfTool(AgentTool):
    name = "export_pdf"
    schema = {"type": "function", "function": {"name": "export_pdf", "parameters": {...}}}
    mutates_files = False

    def available(self, ctx): return "pdf" in ctx.get("scope", {})   # optional
    def prompt_fragment(self, ctx): return "Call export_pdf to render the current view as a PDF."  # optional

    async def execute(self, args, ctx):
        ...
        return {"ok": True, "url": pdf_url}       # ok is not False => success
```

- **`name` / `schema`** - the tool name the model calls and its OpenAI
  function-tool schema.
- **`mutates_files`** - set `True` for tools that change files. A successful
  result from a mutating tool makes the client bump the rebuild key and refresh
  the preview (the same mechanism as the built-in `write_file`).
- **`available(ctx)`** (optional) - return `False` and the tool is pruned from
  the set offered to the model for that context. Use it to gate a tool on scope
  or capability.
- **`prompt_fragment(ctx)`** (optional) - text injected into the system prompt,
  so the tool carries its own instructions.
- **`execute(args, ctx)`** - run it. Success is `result["ok"] is not False`; a
  result with no `ok` key counts as success. Extra keys pass through to the
  `tool-result` event's output.

The five built-ins are `write_file`, `edit_file` (which must match its target
exactly once, so a file cannot be silently corrupted), `read_file`,
`delete_file`, and `install_package`. Pass your own via
`HarnessAgent(tools=[...])`; connectors contribute their tools automatically.

---

## ConnectorProvider

A data source bundled as one plugin - tools, prompt lines, and a runtime bridge.
This one has its own guide, [Connectors](./connectors.md), because configuring
the reference Postgres and MCP connectors is the common case and authoring a new
one is the rare one. The interface, in brief:

```python
class MyConnector(ConnectorProvider):
    async def list(self, scope=None): ...          # chip UI + prompt context, scoped
    def detect_used(self, files): ...              # optional: static scan of file contents
    def tools(self): ...                           # optional: the agent tools it adds
    async def handle(self, kind, payload, ctx): ...# parent side of the window.<ns> RPC
    def shim(self, summary, ns): ...               # optional: in-iframe resolver JS
```

The one rule worth repeating here: connectors resolve **per request against the
`Principal` scope**, and the credential stays inside the connector, server-side.
The generated app asks the bridge for rows; it never sees a password. See
[Connectors](./connectors.md) and [`spec/security.md`](../spec/security.md).

---

## TelemetrySink

Metering and analytics. Default: no-op, so telemetry is entirely opt-in.

```python
class Metering(TelemetrySink):
    def on_generation(self, e):
        # e.model, e.usage.{input_tokens, output_tokens, cache_read_tokens, cache_write_tokens},
        # e.principal, e.latency_ms
        usage.record(user=e.principal.user_id, model=e.model,
                     tokens_in=e.usage.input_tokens, cache_read=e.usage.cache_read_tokens)

    def on_event(self, name, props):     # optional generic hook
        analytics.track(name, props)
```

- **`on_generation(e)`** fires after every generation with the model, the token
  usage, the `Principal`, and the latency. Cache reads and writes are separate
  buckets from fresh input tokens because providers bill them differently - a
  cost meter that lumps them together will misreport.
- **`on_event(name, props)`** (optional) is a generic named-event hook for your
  own analytics.

Both methods are optional; implement only the ones you need. See
[Configuration](./configuration.md#metering) for how this pairs with routing
through a LiteLLM proxy.
