/**
 * @speculos-harness/protocol
 *
 * The single source of truth for the Speculos Harness wire contract and the
 * adapter interfaces both the React client and the Python agent kit implement.
 *
 * Unlike every other package in this repository, the contents of this file are
 * NOT stubs. Types are the one thing published in full pre-release: a third
 * party can read them today to shape the v0.1 code drop while the contract is
 * still soft. The runtime helpers a full protocol package will also ship —
 * zod schemas, JSON-Schema emission, and the golden-fixture conformance kit —
 * arrive with v0.1; this file carries the frozen TypeScript shapes.
 *
 * Layering: this package depends on nothing. Adapters depend only on it.
 *
 * Wire protocol version: 1. Requests and responses carry a `Harness-Protocol: 1`
 * header; additive changes bump the spec minor, breaking changes bump the integer.
 */

/* ------------------------------------------------------------------------- *
 * Constants
 * ------------------------------------------------------------------------- */

/** The wire protocol integer. Sent and expected in the `Harness-Protocol` header. */
export const PROTOCOL_VERSION = 1 as const;

/** The HTTP header carrying the protocol version on every request and response. */
export const PROTOCOL_HEADER = 'Harness-Protocol' as const;

/**
 * The iframe `sandbox` attribute for the preview — normative, security-load-bearing,
 * and non-configurable. The frame is null-origin: `allow-same-origin` MUST NOT be
 * added (that omission is *why* the postMessage data bridge exists), and ungated
 * `allow-top-navigation` MUST NOT be added. A startup self-check refuses to run if
 * this string is ever altered to include `allow-same-origin`.
 */
export const SANDBOX_ATTRIBUTES =
  'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-top-navigation-by-user-activation' as const;

/**
 * The default runtime namespace. Bound in three places that MUST agree or the
 * preview loads fine but silently returns no data: the system prompt, the
 * generated app code, and the preview bridge. Overridable per deployment; when
 * overridden, generated apps see `window.<ns>` and `<ns>-*` postMessages.
 */
export const DEFAULT_NAMESPACE = 'app' as const;

/**
 * The built-in agent tools. `write_file`, `edit_file`, `read_file`,
 * `delete_file`, `install_package`. Connectors contribute more.
 */
export const BUILTIN_TOOLS = [
  'write_file',
  'edit_file',
  'read_file',
  'delete_file',
  'install_package',
] as const;

/**
 * The subset of built-in tools whose successful `tool-result` triggers a preview
 * rebuild on the client (the `fileSig`-bump contract). A result for any of these,
 * with `output.ok !== false`, bumps the rebuild key.
 */
export const MUTATING_TOOLS = [
  'write_file',
  'edit_file',
  'delete_file',
  'install_package',
] as const;

/** Per-request timeout for a preview bridge round-trip, in milliseconds. */
export const BRIDGE_TIMEOUT_MS = 60_000 as const;

/**
 * The neutral CSV attachment content-part tag emitted on write. Readers MUST also
 * accept the legacy alias (see {@link LEGACY_CSV_PART}) indefinitely, because it is
 * baked into already-persisted conversation history.
 */
export const CSV_PART = 'attachment_csv' as const;

/** The legacy CSV content-part alias. Accepted on read forever; never emitted. */
export const LEGACY_CSV_PART = 'speculos_csv' as const;

/**
 * The fenced code-block language that carries plan-mode clickable choices inside
 * assistant text. Emitted on write; readers MUST also accept the legacy fence.
 */
export const CHOICES_FENCE = 'harness-choices' as const;

/** The legacy plan-choices fence. Accepted on read forever; never emitted. */
export const LEGACY_CHOICES_FENCE = 'speculos-choices' as const;

/* ------------------------------------------------------------------------- *
 * Identity / auth
 * ------------------------------------------------------------------------- */

/**
 * A resolved caller. Produced by {@link AuthProvider.resolve} and threaded through
 * every request: it scopes which projects a caller sees, tags token usage in the
 * telemetry hook, and decides what a caller's connectors are allowed to touch.
 */
export interface Principal {
  /** Stable identifier for the caller. Used for project ownership and telemetry. */
  userId: string;
  /** Whether the caller may mutate the project. `false` yields a read-only workspace. */
  canEdit: boolean;
  /** Opaque host-defined scope (e.g. `{ tenant: '...' }`); connectors resolve against it. */
  scope?: Record<string, string>;
  /** Marks a caller who can view but not own the project (share/staff read-only). */
  isViewer?: boolean;
}

/**
 * An authenticated-but-denied result. Lets "authed but blocked" be expressed
 * in-band (e.g. a billing gate returning `402`) instead of raising around the
 * abstraction. Returned by {@link AuthProvider.resolve}.
 */
export interface AuthDenied {
  /** Discriminant. Always `true`. */
  deny: true;
  /** The HTTP status the router should return. */
  status: 401 | 402 | 403;
  /** Optional human-readable reason surfaced to the client. */
  message?: string;
}

/**
 * The minimal request shape an {@link AuthProvider} needs. The Python kit maps its
 * framework request onto this; hosts read headers/cookies to identify the caller.
 */
export interface HttpRequest {
  /** Request headers, lowercased keys recommended. */
  headers: Record<string, string | undefined>;
  /** Parsed cookies, when the host uses cookie-mode auth. */
  cookies?: Record<string, string | undefined>;
  /** Parsed query string (e.g. the optional share `token`). */
  query?: Record<string, string | undefined>;
}

/**
 * SERVER adapter. Turns an incoming request into a {@link Principal}, an
 * {@link AuthDenied}, or `null`. The default implementation is single-user
 * (`{ userId: 'local', canEdit: true }`).
 */
export interface AuthProvider {
  /**
   * Resolve the caller.
   * @returns a {@link Principal} to allow; an {@link AuthDenied} to reject with a
   *   typed status; or `null` for a plain `401`.
   */
  resolve(req: HttpRequest): Promise<Principal | AuthDenied | null>;
}

/* ------------------------------------------------------------------------- *
 * Messages (OpenAI chat shape + one custom content part)
 * ------------------------------------------------------------------------- */

/** Roles in the persisted OpenAI-shaped message log. */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** A plain-text content part. */
export interface TextPart {
  /** Discriminant. */
  type: 'text';
  /** The text. */
  text: string;
}

/** An image content part (OpenAI shape). Carries a data URL for attachments. */
export interface ImagePart {
  /** Discriminant. */
  type: 'image_url';
  /** The image reference; `url` is typically a `data:` URL for uploads. */
  image_url: { url: string };
}

/**
 * The one custom content part: a CSV attachment. Emitted with `type:
 * 'attachment_csv'`; readers MUST also accept the legacy `speculos_csv` tag
 * indefinitely (it lives in already-persisted history) — see {@link LEGACY_CSV_PART}.
 */
export interface AttachmentCsvPart {
  /** Discriminant on write. Readers also accept `'speculos_csv'`. */
  type: typeof CSV_PART | typeof LEGACY_CSV_PART;
  /** Original filename. */
  name: string;
  /** The CSV text. */
  text: string;
  /** Optional row count, for display and prompt context. */
  rows?: number;
}

/** A message content part. */
export type ContentPart = TextPart | ImagePart | AttachmentCsvPart;

/** A function/tool call requested by the assistant (OpenAI shape). */
export interface ToolCall {
  /** Correlates the call with its {@link ChatMessage} tool result. */
  id: string;
  /** Always `'function'` in the OpenAI tool-call shape. */
  type: 'function';
  /** The invoked function's name and JSON-encoded arguments. */
  function: { name: string; arguments: string };
}

/**
 * A persisted message. Standard OpenAI chat shape plus the custom
 * {@link AttachmentCsvPart}. Content may be a string, an array of parts, or `null`
 * (assistant turns that only carry `tool_calls`).
 */
export interface ChatMessage {
  /** Who authored the message. */
  role: ChatRole;
  /** Text, structured parts, or `null` for a tool-call-only assistant turn. */
  content: string | ContentPart[] | null;
  /** Present on assistant turns that call tools. */
  tool_calls?: ToolCall[];
  /** Present on `role: 'tool'` messages; matches a {@link ToolCall.id}. */
  tool_call_id?: string;
  /** Optional tool/function name on `role: 'tool'` messages. */
  name?: string;
}

/* ------------------------------------------------------------------------- *
 * Chat request (POST {base}/chat)
 * ------------------------------------------------------------------------- */

/** An image attachment on a chat request. */
export interface ImageAttachment {
  /** Discriminant. */
  kind: 'image';
  /** Original filename. */
  name: string;
  /** A `data:image/...;base64,...` URL. */
  dataUrl: string;
}

/** A CSV attachment on a chat request. */
export interface CsvAttachment {
  /** Discriminant. */
  kind: 'csv';
  /** Original filename. */
  name: string;
  /** The CSV text. */
  text: string;
  /** Optional row count. */
  rows?: number;
}

/** An attachment supplied with a chat request. */
export type Attachment = ImageAttachment | CsvAttachment;

/** The JSON body of `POST {base}/chat`. */
export interface ChatRequest {
  /** The project being edited. */
  projectId: string;
  /** The user's message. Rendered optimistically by the client before sending. */
  message: string;
  /** Request plan mode. Omit when false. Strips all tools server-side (`tools: null`). */
  planMode?: boolean;
  /** Optional per-turn model override; honored only if it is in the allowed set. */
  model?: string;
  /** Optional UI language hint. */
  lang?: string;
  /** Optional image/CSV attachments seeding the build. */
  attachments?: Attachment[];
}

/* ------------------------------------------------------------------------- *
 * Chat response — the seven SSE events
 * ------------------------------------------------------------------------- */

/**
 * The output shape of a tool. Success convention: `ok !== false` (a result with no
 * `ok` key counts as success). Mutating tools additionally trigger a preview rebuild.
 */
export interface ToolResultOutput {
  /** Success flag; absence or `true` means success, `false` means failure. */
  ok?: boolean;
  /** Tool-specific fields. */
  [key: string]: unknown;
}

/**
 * `user-message` — the server echoes the user's text. Client MUST ignore it: the
 * user bubble was already rendered optimistically. Reimplementers who echo it
 * double-render.
 */
export interface UserMessageEvent {
  /** SSE `event:` name. */
  event: 'user-message';
  /** The echoed user text. */
  data: { text: string };
}

/** `text-delta` — append `text` to the trailing assistant bubble. */
export interface TextDeltaEvent {
  /** SSE `event:` name. */
  event: 'text-delta';
  /** The incremental assistant text. */
  data: { text: string };
}

/**
 * `tool-call-delta` — stream argument text into a pending tool card keyed by
 * `index` (the id and name are not yet known at this point).
 */
export interface ToolCallDeltaEvent {
  /** SSE `event:` name. */
  event: 'tool-call-delta';
  /** Which pending tool card the args belong to, plus the incremental JSON. */
  data: { index: number; argsDelta: string };
}

/**
 * `tool-call` — finalize/pair the card. The client pairs by canonicalized-args
 * equality, then first-pending, and sets it `pending`.
 */
export interface ToolCallEvent {
  /** SSE `event:` name. */
  event: 'tool-call';
  /** The resolved call: id, tool name, and parsed input. */
  data: { toolCallId: string; name: string; input: unknown };
}

/**
 * `tool-result` — resolve the card. `ok = output.ok !== false`. If `ok` and `name`
 * is a mutating tool ({@link MUTATING_TOOLS}), the client bumps `fileSig` and the
 * preview rebuilds.
 */
export interface ToolResultEvent {
  /** SSE `event:` name. */
  event: 'tool-result';
  /** The resolved call's id, tool name, and output. */
  data: { toolCallId: string; name: string; output: ToolResultOutput };
}

/** `error` — render a friendly error bubble. */
export interface ErrorEvent {
  /** SSE `event:` name. */
  event: 'error';
  /** The error message. */
  data: { message: string };
}

/**
 * `done` — advisory end marker. The stream actually ends on reader EOF; clients
 * must not depend on receiving this event.
 */
export interface DoneEvent {
  /** SSE `event:` name. */
  event: 'done';
  /** Empty payload. */
  data: Record<string, never>;
}

/**
 * The complete, closed set of chat SSE events. Exactly seven — a conforming server
 * emits only these, hand-rolled as `event: <name>\n` + `data: <json>\n\n` (not the
 * Vercel AI SDK data-stream protocol).
 */
export type WireEvent =
  | UserMessageEvent
  | TextDeltaEvent
  | ToolCallDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | ErrorEvent
  | DoneEvent;

/** The literal `event:` names of every {@link WireEvent}. */
export type WireEventName = WireEvent['event'];

/* ------------------------------------------------------------------------- *
 * LLM provider
 * ------------------------------------------------------------------------- */

/** An OpenAI function-tool schema offered to the model. */
export interface ToolSchema {
  /** The tool name the model calls. */
  name: string;
  /** Human/model-facing description. */
  description?: string;
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>;
}

/** A single streamed increment from an {@link LLMProvider.stream} call. */
export type LLMDelta =
  | { textDelta: string }
  | {
      toolCallDelta: {
        /** Index of the tool call within the turn. */
        index: number;
        /** Present once known. */
        id?: string;
        /** Present once known. */
        name?: string;
        /** Incremental JSON argument text. */
        argsDelta?: string;
      };
    };

/** Resolved per-call configuration produced by {@link LLMProvider.configFor}. */
export interface LLMCallConfig {
  /** The concrete model id to call. */
  model: string;
  /** Optional API key for this call. */
  apiKey?: string;
  /** Optional API base (e.g. a LiteLLM proxy). */
  apiBase?: string;
  /** Whether prompt-cache breakpoints should be placed for this model. */
  supportsPromptCache?: boolean;
  /** Provider-specific passthrough. */
  extra?: Record<string, unknown>;
}

/** The task an optional model router is choosing a model for. */
export type RouteTask = 'plan' | 'build' | 'analyze';

/**
 * SERVER adapter. Wraps whatever LLM/gateway the host uses. The default reference
 * implementation is LiteLLM-backed (OpenAI/Anthropic/Bedrock/Ollama via config).
 */
export interface LLMProvider {
  /**
   * Resolve the config for a call, honoring an optional requested model (validated
   * against the allowed set) and the calling {@link Principal}.
   */
  configFor(ctx: { requestedModel?: string; principal: Principal }): LLMCallConfig;

  /** The models the in-chat picker offers this caller; surfaced via `/capabilities`. */
  allowedModels?(principal: Principal): string[];

  /**
   * Stream a completion.
   * @param tools the offered tools, or `null` in plan mode — MUST be `null`, never
   *   `[]` (Bedrock rejects an empty tools array).
   * @param signal aborts the stream.
   */
  stream(
    messages: ChatMessage[],
    tools: ToolSchema[] | null,
    cfg: LLMCallConfig,
    signal: AbortSignal,
  ): AsyncIterable<LLMDelta>;

  /** Whether an error is a context-window-exceeded error; drives shrink-and-retry. */
  isContextWindowError(err: unknown): boolean;

  /**
   * OPTIONAL, post-v0.1 fast-follow: dynamic model routing. Consulted only when the
   * user has not explicitly picked a model; an explicit per-turn `model` always wins,
   * the routed choice must come from {@link allowedModels}, and `/capabilities`
   * advertises `routing: true`.
   */
  routeFor?(ctx: { task: RouteTask; principal: Principal }): string | undefined;
}

/* ------------------------------------------------------------------------- *
 * Sandbox / bundler
 * ------------------------------------------------------------------------- */

/** A project's files: absolute-in-project path → source. e.g. `"/index.tsx" → "..."`. */
export type FileMap = Record<string, string>;

/** The result of a bundle: `{code, css}` on success (200) or `{error}` (422). */
export type BundleResult = { code: string; css: string } | { error: string };

/** Descriptor of a bundler's capabilities; advertised through `/capabilities`. */
export interface BundlerCaps {
  /** Where bundling runs. */
  location: 'server' | 'browser';
  /** Whether `install_package` is meaningful (server bundlers) or not (browser/CDN). */
  supportsInstall: boolean;
  /** Which JSX transform the output assumes. */
  jsxRuntime: 'automatic' | 'classic';
}

/**
 * SERVER or browser adapter. Turns `{files, deps}` into browser-ready `{code, css}`.
 * The default is the locked-down Bun.build sidecar (`@speculos-harness/bundler`);
 * the optional browser bundler is `@speculos-harness/sandbox-browser`.
 */
export interface Bundler {
  /** Bundle the project's files and dependencies. */
  bundle(files: FileMap, deps: Record<string, string>, signal?: AbortSignal): Promise<BundleResult>;
  /** This bundler's capabilities. */
  readonly caps: BundlerCaps;
}

/** Only meaningful when {@link BundlerCaps.supportsInstall}. Installs a dependency. */
export interface PackageInstaller {
  /**
   * Install one package. MUST keep `--ignore-scripts`, so a package cannot run
   * install-time scripts on the build server.
   */
  install(name: string, version?: string): Promise<{ ok: boolean; error?: string }>;
}

/* ------------------------------------------------------------------------- *
 * Persistence
 * ------------------------------------------------------------------------- */

/** A project record. Host-owned extras (visibility, org, tokens) live in `meta`. */
export interface Project {
  /** Stable project id. */
  id: string;
  /** Display name. */
  name: string;
  /** The starter template this project was created from. */
  template: string;
  /** The current file map; may be omitted from list responses. */
  files?: FileMap;
  /** Declared dependencies: name → version range. */
  dependencies: Record<string, string>;
  /** The persisted conversation. */
  messages: ChatMessage[];
  /** Optional creator id. */
  createdBy?: string;
  /** ISO timestamp of the last write; part of the `fileSig` rebuild key. */
  updatedAt: string;
  /** Optional connector connection state. */
  connections?: unknown;
  /** Opaque host-owned fields NOT part of the wire contract. */
  meta?: Record<string, unknown>;
}

/** The input to {@link ProjectStore.createProject}. */
export interface NewProject {
  /** Display name. */
  name: string;
  /** The starter template id. */
  template: string;
  /** Optional initial files. */
  files?: FileMap;
  /** Optional initial dependencies. */
  dependencies?: Record<string, string>;
  /** Optional creator id. */
  createdBy?: string;
  /** Opaque host-owned fields. */
  meta?: Record<string, unknown>;
}

/** A version-history entry. Pre-turn snapshots power the version timeline. */
export interface Snapshot {
  /** Snapshot id. */
  id: string;
  /** Index into the message log this snapshot was taken at. */
  messageIndex: number;
  /** ISO creation timestamp. */
  createdAt: string;
  /** Whether taken before a turn or as an undo checkpoint. */
  kind: 'pre-turn' | 'undo';
}

/**
 * SERVER adapter. The project/file/history/snapshot store. The snapshot methods are
 * OPTIONAL: when a store omits them, `/capabilities` omits snapshot support and the
 * version timeline / rollback UI hides itself. Both reference stores implement them.
 *
 * Landmine encoded in the signatures: {@link putFiles} is FULL-REPLACE and
 * transactional, and snapshots are owned by the *agent*, not the store — so a naive
 * adapter cannot silently corrupt a project.
 */
export interface ProjectStore {
  /** Fetch a project by id, or `null`. */
  getProject(id: string): Promise<Project | null>;
  /** Create a project. */
  createProject(input: NewProject): Promise<Project>;
  /** Patch top-level project fields. */
  patchProject(id: string, patch: Partial<Project>): Promise<void>;
  /** Fetch the current file map. */
  getFiles(id: string): Promise<FileMap>;
  /** Replace ALL files transactionally (full-replace, not a merge). */
  putFiles(id: string, files: FileMap): Promise<void>;
  /** Fetch the persisted conversation. */
  getMessages(id: string): Promise<ChatMessage[]>;
  /** Persist the conversation (before stream, per tool, at done, in finally). */
  saveMessages(id: string, messages: ChatMessage[]): Promise<void>;

  /** OPTIONAL. Capture a snapshot (pre-turn or undo). */
  createSnapshot?(
    id: string,
    s: { messageIndex: number; kind: 'pre-turn' | 'undo'; files: FileMap; messages?: ChatMessage[] },
  ): Promise<Snapshot>;
  /** OPTIONAL. List pre-turn snapshots (keep ~30). */
  listSnapshots?(id: string): Promise<Snapshot[]>;
  /** OPTIONAL. Fetch a snapshot with its files and messages. */
  getSnapshot?(
    id: string,
    snapshotId: string,
  ): Promise<(Snapshot & { files: FileMap; messages: ChatMessage[] }) | null>;
}

/* ------------------------------------------------------------------------- *
 * Agent tools
 * ------------------------------------------------------------------------- */

/** Context handed to a tool's `available`/`promptFragment`/`execute`. */
export interface ToolContext {
  /** The calling principal. */
  principal: Principal;
  /** The project being edited. */
  projectId: string;
  /** The current file map. */
  files: FileMap;
  /** The runtime namespace bound for this deployment. */
  namespace: string;
  /** The principal's scope, for connector resolution. */
  scope?: Record<string, string>;
  /** Adapter-specific extras. */
  [key: string]: unknown;
}

/**
 * A single agent tool: schema, availability, prompt fragment, and executor
 * co-located so a tool and its prompt move as one unit (they historically drifted
 * when smeared across three sites).
 */
export interface AgentTool<A = any> {
  /** The tool name the model calls. */
  name: string;
  /** OpenAI function-tool schema. */
  schema: ToolSchema;
  /** When true, a successful result triggers a client preview rebuild. */
  mutatesFiles?: boolean;
  /** When it returns false, the tool is pruned from the offered set for this context. */
  available?(ctx: ToolContext): boolean;
  /** Text injected into the system prompt (the tool carries its own prompt lines). */
  promptFragment?(ctx: ToolContext): string;
  /** Execute the tool. Success convention: the returned `ok !== false`. */
  execute(args: A, ctx: ToolContext): Promise<{ ok: boolean; [key: string]: unknown }>;
}

/* ------------------------------------------------------------------------- *
 * Connectors
 * ------------------------------------------------------------------------- */

/**
 * The plugin-contributed connector summary: an extensible, namespaced shape used
 * for the chip UI and prompt context. Individual connectors define their own
 * namespaced entries; protocol v1 does not fix them.
 */
export interface ConnectorSummary {
  /** The connector kinds present (e.g. `["postgres", "mcp"]`). */
  kinds?: string[];
  /** Plugin-defined, namespaced entries. */
  [key: string]: unknown;
}

/** Context for a connector's parent-side {@link ConnectorProvider.handle}. */
export interface RuntimeContext {
  /** The calling principal. */
  principal: Principal;
  /** The runtime namespace. */
  namespace: string;
  /** The principal's scope; connectors resolve their data access against it. */
  scope?: Record<string, string>;
  /** Optional share token threaded through every runtime RPC. */
  shareToken?: string;
  /** Adapter-specific extras. */
  [key: string]: unknown;
}

/**
 * An optional plugin bundling everything a data source needs: the tools the agent
 * can call, the system-prompt lines it contributes, the parent-side RPC handler,
 * and the in-iframe resolver shim. Reference implementations: MCP and Postgres,
 * exposed as the factories `mcp_connector(url=...)` / `postgres_connector(dsn=...)`.
 */
export interface ConnectorProvider {
  /** Summarize the connector for the chip UI and prompt context, scoped to the caller. */
  list(scope?: Record<string, string>): Promise<ConnectorSummary>;
  /** OPTIONAL. Statically scan file contents to report which connectors are used. */
  detectUsed?(files: FileMap): string[];
  /** OPTIONAL. The agent tools this connector adds (e.g. `list_tables`, `call_app_tool`). */
  tools?(): AgentTool[];
  /** Parent side of the `window.<ns>` RPC — invoked by `POST {base}/connectors/{kind}`. */
  handle(kind: string, payload: unknown, ctx: RuntimeContext): Promise<unknown>;
  /** OPTIONAL. In-iframe resolver contribution injected into the preview shim. */
  shim?(summary: ConnectorSummary, ns: string): string;
}

/* ------------------------------------------------------------------------- *
 * Telemetry
 * ------------------------------------------------------------------------- */

/** Token counts reported per generation. Cache buckets are separate (billed differently). */
export interface TokenUsage {
  /** Prompt tokens. */
  input_tokens: number;
  /** Completion tokens. */
  output_tokens: number;
  /** Tokens served from prompt cache (billed cheaply). */
  cache_read_tokens: number;
  /** Tokens written to prompt cache. */
  cache_write_tokens: number;
}

/** The event fired after every generation. */
export interface GenerationEvent {
  /** The model that ran. */
  model: string;
  /** Token usage for the generation. */
  usage: TokenUsage;
  /** The principal who ran it. */
  principal: Principal;
  /** Wall-clock latency in milliseconds. */
  latencyMs: number;
}

/** A no-op-by-default hook for metering and analytics. */
export interface TelemetrySink {
  /** Fired after every generation with model, usage, principal, and latency. */
  onGeneration?(e: GenerationEvent): void;
  /** Fired for arbitrary named events. */
  onEvent?(name: string, props: Record<string, unknown>): void;
}

/* ------------------------------------------------------------------------- *
 * Workspace ops (bundle, packages, snapshots)
 * ------------------------------------------------------------------------- */

/** `POST {base}/bundle/:id` success body. */
export interface BundleResponse {
  /** Bundled, browser-ready JS. */
  code: string;
  /** Bundled CSS. */
  css: string;
  /** Optional connector summary populated by the router from the mounted connectors. */
  connectors?: ConnectorSummary;
}

/** `POST {base}/bundle/:id` error body (HTTP 422). */
export interface BundleErrorResponse {
  /** The build error message. */
  error: string;
}

/** The raw sidecar bundle request: `POST /bundle {files, deps}`. */
export interface RawBundleRequest {
  /** The project's files. */
  files: FileMap;
  /** The project's dependencies. */
  deps: Record<string, string>;
}

/** The raw sidecar install request: `POST /packages/install {name, version}`. */
export interface PackageInstallRequest {
  /** Package name (regex-validated by the sidecar). */
  name: string;
  /** Optional version (regex-validated). */
  version?: string;
}

/** The raw sidecar install result. */
export interface PackageInstallResult {
  /** Whether the install succeeded. */
  ok: boolean;
  /** The error message on failure. */
  error?: string;
}

/** `POST {base}/projects/:id/rollback` request. */
export interface RollbackRequest {
  /** The snapshot to roll back to. */
  snapshotId: string;
}

/** `POST {base}/projects/:id/rollback` result. */
export interface RollbackResult {
  /** Whether the rollback applied. */
  ok: boolean;
  /** The message index restored to. */
  messageIndex: number;
  /** The undo snapshot captured before rolling back (so a rollback is itself undoable). */
  undoSnapshotId: string;
}

/* ------------------------------------------------------------------------- *
 * Capability negotiation (GET {base}/capabilities)
 * ------------------------------------------------------------------------- */

/**
 * The capabilities document. Lets one React client adapt to either the OSS Python
 * kit or a production backend. If this endpoint 404s (or the `Harness-Protocol`
 * header is absent), clients MUST assume protocol-1 defaults: server-side bundling,
 * `supportsInstall: true`, plan mode on, image + CSV attachments, no routing.
 */
export interface Capabilities {
  /** The wire protocol integer the server speaks. */
  protocol: number;
  /** The runtime namespace bound on this server. */
  namespace: string;
  /** The active bundler's capabilities. */
  sandbox: BundlerCaps;
  /** Whether plan mode is available. */
  planMode: boolean;
  /** Supported attachment kinds. */
  attachments: Array<'image' | 'csv'>;
  /** The model picker's menu. */
  models: string[];
  /** The active connector kinds. */
  connectors: string[];
  /** Present and `true` when dynamic model routing is enabled. */
  routing?: boolean;
}

/* ------------------------------------------------------------------------- *
 * Preview postMessage bridge
 * ------------------------------------------------------------------------- */

/**
 * A request from the sandboxed iframe to the parent: `{ type: '<ns>-<kind>', id, ... }`,
 * where `id = 'q_' + Date.now() + '_' + rand`. The parent forwards it to the mounted
 * {@link ConnectorProvider.handle}.
 */
export interface BridgeRequest {
  /** `'<namespace>-<kind>'`, e.g. `'app-query'`. */
  type: string;
  /** Correlation id. */
  id: string;
  /** Request-specific fields. */
  [key: string]: unknown;
}

/**
 * A reply from the parent to the iframe: `{ type: '<ns>-result', id, ...payload }`.
 * `targetOrigin` is `origin === 'null' ? '*' : origin`.
 */
export interface BridgeReply {
  /** `'<namespace>-result'`. */
  type: string;
  /** The correlation id from the matching {@link BridgeRequest}. */
  id: string;
  /** Reply-specific fields. */
  [key: string]: unknown;
}

/** A runtime error reported from the iframe: `{ type: 'preview-error', message, stack? }`. */
export interface PreviewError {
  /** Discriminant. */
  type: 'preview-error';
  /** The error message. */
  message: string;
  /** Optional stack trace. */
  stack?: string;
}

/** Client auth modes. See `spec/security.md` for the cross-origin embed recipe. */
export type AuthMode = 'bearer' | 'cookie';
