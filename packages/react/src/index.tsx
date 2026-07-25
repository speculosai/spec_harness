/**
 * @speculos-harness/react
 *
 * The embeddable workspace: a chat panel beside a live, sandboxed preview, plus a
 * read-only file explorer and a version timeline. One provider and one component
 * cover the common case; the panes and the headless hooks are exported for full control.
 */

import type { ReactElement, ReactNode } from 'react';
import type {
  Attachment,
  ChatMessage,
  ConnectorProvider,
  FileMap,
  Snapshot,
} from '@speculos-harness/protocol';

/** Placeholder message for the exports the implementation drops into. */
const NOT_IMPLEMENTED = '@speculos-harness/react: implementation pending';

/* ------------------------------------------------------------------------- *
 * Provider
 * ------------------------------------------------------------------------- */

/**
 * Client auth. `getHeaders` runs on every request the workspace makes - chat SSE,
 * bundle, project/snapshot reads, and the preview bridge-proxy fetches - so identity
 * is attached uniformly. `canEdit: false` yields a read-only viewer (preview
 * full-width, no chat). `shareToken`, when set, is threaded through every runtime RPC.
 */
export interface HarnessAuth {
  /** Returns the headers to attach to every request (e.g. an `Authorization` bearer). */
  getHeaders: () => Promise<Record<string, string>> | Record<string, string>;
  /** Whether this caller may edit. `false` renders a read-only workspace. */
  canEdit?: boolean;
  /** Optional share token threaded through every runtime RPC as `?token=`. */
  shareToken?: string;
}

/** Brand overrides. The logo is a slot, never hardcoded. */
export interface HarnessBrand {
  /** The product name shown in the workspace chrome. */
  name: string;
  /** A logo element rendered in place of the default mark. */
  Logo?: ReactNode;
}

/**
 * A string bag or a `t()`-style function overriding every UI label, so the workspace
 * speaks your product's language without a fork. Defaults to built-in English.
 */
export type HarnessStrings = Record<string, string> | ((key: string, vars?: Record<string, unknown>) => string);

/** Props for {@link HarnessProvider}. */
export interface HarnessProviderProps {
  /** Where the agent router is mounted, e.g. `"/api/builder"`. */
  baseUrl: string;
  /**
   * The runtime namespace: `window.<ns>.*` and `<ns>-*` bridge messages. Must match
   * the server and the generated apps. Defaults to `"app"`.
   */
  namespace?: string;
  /** Client auth: how the workspace proves who is asking on every request. */
  auth: HarnessAuth;
  /** Brand name and logo slot. */
  brand?: HarnessBrand;
  /** Label overrides. */
  strings?: HarnessStrings;
  /** Connector client halves (bridge/shim); omit for file/package tools only. */
  connectors?: ConnectorProvider[];
  /** The workspace subtree. */
  children?: ReactNode;
}

/**
 * The context provider. Wraps a `<Builder>` (or your own composition of panes/hooks)
 * and supplies base URL, namespace, auth, brand, strings, and connectors to everything
 * beneath it.
 *
 * TODO: stand up the workspace context - resolve `/capabilities` once, hold the
 * auth header factory, bind the namespace, and expose it to the hooks and panes.
 */
export function HarnessProvider(_props: HarnessProviderProps): ReactElement {
  throw new Error(NOT_IMPLEMENTED);
}

/* ------------------------------------------------------------------------- *
 * Builder
 * ------------------------------------------------------------------------- */

/** Pane order for {@link Builder}. */
export type BuilderLayout = 'preview-left' | 'chat-left';

/** File-panel mode for {@link Builder}. */
export type BuilderFilePanel = 'explorer' | 'hidden';

/** Props for {@link Builder}. */
export interface BuilderProps {
  /** The project to open. */
  projectId: string;
  /** Which side the preview sits on. Defaults to `"preview-left"`. */
  layout?: BuilderLayout;
  /** Whether the read-only file explorer + version timeline show. Defaults to `"explorer"`. */
  filePanel?: BuilderFilePanel;
  /** Seed the first turn (e.g. from a `?prompt=` deep link). */
  onFirstPrompt?: () => string | undefined;
}

/**
 * The whole workspace: a resizable two-pane split of {@link ChatPane} and
 * {@link PreviewPane}, with an optional {@link FileExplorer} + {@link VersionTimeline}.
 * Owns the shared state contract - the `fileSig` rebuild key and the once-per-signature
 * crash-to-auto-fix guard - so the panes stay in sync.
 *
 * TODO: compose the panes over the shared workspace state (project, fileSig,
 * snapshots, busy, chat imperative handle) with resizable panels and the layout prop.
 */
export function Builder(_props: BuilderProps): ReactElement {
  throw new Error(NOT_IMPLEMENTED);
}

/* ------------------------------------------------------------------------- *
 * Panes (composable pieces of Builder)
 * ------------------------------------------------------------------------- */

/** Props for {@link ChatPane}. */
export interface ChatPaneProps {
  /** The project the conversation belongs to. */
  projectId: string;
  /** Optional slot rendered above the composer (starter suggestions, connector chips). */
  header?: ReactNode;
}

/**
 * The chat side: the message log with legible tool cards, plan-mode choice chips, the
 * model picker, and the composer with image/CSV attachment support. Talks the protocol
 * through {@link useHarnessChat}.
 *
 * TODO: render `useHarnessChat` items - assistant text, tool cards paired by
 * index, the activity line - plus the composer, attachments, and plan-choice chips.
 */
export function ChatPane(_props: ChatPaneProps): ReactElement {
  throw new Error(NOT_IMPLEMENTED);
}

/** Props for {@link PreviewPane}. */
export interface PreviewPaneProps {
  /** The project to preview. */
  projectId: string;
  /** A string whose change forces a full rebuild (the `fileSig` contract). */
  rebuildKey?: string;
}

/**
 * The preview side: the null-origin sandboxed iframe, the postMessage bridge, the
 * readable fallback on build/runtime failure, and the once-per-build crash-to-auto-fix
 * request. Talks to the bundler through {@link useHarnessPreview}.
 *
 * TODO: host the `@speculos-harness/preview` iframe core, wire the bridge to the
 * mounted connectors, and surface the fallback + auto-fix hook.
 */
export function PreviewPane(_props: PreviewPaneProps): ReactElement {
  throw new Error(NOT_IMPLEMENTED);
}

/** Props for {@link FileExplorer}. */
export interface FileExplorerProps {
  /** The project whose files to show. */
  projectId: string;
  /** Called when the user selects a file. */
  onSelect?: (path: string) => void;
}

/**
 * The read-only file tree with per-turn diffs. Answers "what did the agent actually
 * change in my app?" without pretending to be an editor.
 *
 * TODO: render the tree from `useHarnessFiles`, with per-turn diff highlighting.
 */
export function FileExplorer(_props: FileExplorerProps): ReactElement {
  throw new Error(NOT_IMPLEMENTED);
}

/** Props for {@link VersionTimeline}. */
export interface VersionTimelineProps {
  /** The project whose version history to show. */
  projectId: string;
  /** Called after a restore completes. */
  onRestore?: (snapshotId: string) => void;
}

/**
 * The version history: every turn as a restorable version (the last ~30). Selecting one
 * shows the files it produced; restoring is itself undoable. Hides itself when the
 * server's `/capabilities` reports no snapshot support.
 *
 * TODO: list snapshots from `useHarnessFiles().versions`, wire restore/undo.
 */
export function VersionTimeline(_props: VersionTimelineProps): ReactElement {
  throw new Error(NOT_IMPLEMENTED);
}

/* ------------------------------------------------------------------------- *
 * Headless hooks (own the protocol, state, and streaming)
 * ------------------------------------------------------------------------- */

/** A rendered chat item: a user bubble, an assistant bubble, or a tool card. */
export interface ChatItem {
  /** Stable key for React. */
  id: string;
  /** What kind of item this is. */
  kind: 'user' | 'assistant' | 'tool';
  /** Item-specific fields (text, tool name/input/output, pending flag). */
  [key: string]: unknown;
}

/** Options for {@link useHarnessChat}. */
export interface UseHarnessChatOptions {
  /** Where the agent router is mounted. Defaults to the provider's `baseUrl`. */
  baseUrl?: string;
  /** The project to chat about. */
  projectId: string;
}

/** Return value of {@link useHarnessChat}. */
export interface HarnessChat {
  /** The rendered message log. */
  items: ChatItem[];
  /** Send a message; `planMode` requests a plan before code. */
  send: (text: string, opts?: { planMode?: boolean; model?: string; attachments?: Attachment[] }) => void;
  /** Abort the in-flight turn. */
  stop: () => void;
  /** Whether a turn is streaming. */
  busy: boolean;
  /** A string that changes whenever files were mutated - feed it to the preview as `rebuildKey`. */
  filesChangedAt: string;
}

/**
 * The chat protocol as a hook: opens the SSE stream, parses the seven events, pairs
 * tool cards by index, and exposes `filesChangedAt` (the `fileSig` contract).
 *
 * TODO: POST `/chat` with a streaming fetch, hand-parse the SSE framing, maintain
 * `items` and `filesChangedAt`, and expose optimistic send + abort.
 */
export function useHarnessChat(_opts: UseHarnessChatOptions): HarnessChat {
  throw new Error(NOT_IMPLEMENTED);
}

/** A bundle function: `{files, deps}` in, `{code, css}` (or `{error}`) out. */
export type BundleFn = (
  files: FileMap,
  deps: Record<string, string>,
  signal?: AbortSignal,
) => Promise<{ code: string; css: string } | { error: string }>;

/** Options for {@link useHarnessPreview}. */
export interface UseHarnessPreviewOptions {
  /** The project to preview. */
  projectId: string;
  /** A string whose change forces a full rebuild. */
  rebuildKey: string;
  /** How to bundle: the HTTP sidecar, or a browser bundler. */
  bundle?: BundleFn;
  /**
   * Called at most ONCE per `rebuildKey` when the preview fails to build or crashes.
   * The once-per-signature guard lives inside the hook, so custom layouts cannot
   * accidentally build a fix loop.
   */
  onError?: (err: { message: string; stack?: string }) => void;
}

/** Return value of {@link useHarnessPreview}. */
export interface HarnessPreview {
  /** The assembled null-origin `srcdoc` document to set on the iframe. */
  srcDoc: string;
  /** The normative sandbox attribute string (from the protocol package). */
  sandbox: string;
}

/**
 * The preview as a hook: rebuilds on `rebuildKey`, assembles the srcdoc, owns the
 * bridge, and fires `onError` at most once per rebuild.
 *
 * TODO: key a build effect on `${projectId}:${rebuildKey}`, call `bundle`, build
 * the srcdoc via `@speculos-harness/preview`, and manage the bridge + auto-fix guard.
 */
export function useHarnessPreview(_opts: UseHarnessPreviewOptions): HarnessPreview {
  throw new Error(NOT_IMPLEMENTED);
}

/** A node in the read-only file tree. */
export interface FileTreeNode {
  /** Full in-project path. */
  path: string;
  /** Leaf name. */
  name: string;
  /** Whether this node is a directory. */
  isDir: boolean;
  /** Child nodes, for directories. */
  children?: FileTreeNode[];
}

/** Options for {@link useHarnessFiles}. */
export interface UseHarnessFilesOptions {
  /** The project whose files and versions to read. */
  projectId: string;
}

/** Return value of {@link useHarnessFiles}. */
export interface HarnessFiles {
  /** The current file tree. */
  tree: FileTreeNode[];
  /** Read a file's source by path. */
  read: (path: string) => Promise<string>;
  /** The set of paths changed on a given turn. */
  diff: (turn: number) => Promise<FileMap>;
  /** The version history (pre-turn snapshots). */
  versions: Snapshot[];
  /** Restore a version; the restore is itself captured as an undo point. */
  restore: (snapshotId: string) => Promise<void>;
}

/**
 * The read-only file explorer + version history as a hook: the tree, per-turn diffs,
 * the snapshot timeline, and restore - all read-only, backed by data that already flows
 * through the store.
 *
 * TODO: fetch files and snapshots through the mounted router; compute per-turn
 * diffs from the message log; wire restore to `/rollback`.
 */
export function useHarnessFiles(_opts: UseHarnessFilesOptions): HarnessFiles {
  throw new Error(NOT_IMPLEMENTED);
}

// Re-export the wire types so consumers can type against one import.
export type { ChatMessage } from '@speculos-harness/protocol';
