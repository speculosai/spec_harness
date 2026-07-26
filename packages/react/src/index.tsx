/**
 * @speculos-harness/react
 *
 * The embeddable workspace: a chat panel beside a live, sandboxed preview, plus a
 * read-only file explorer and a version timeline. One provider and one component
 * cover the common case; the panes and the headless hooks are exported for full control.
 *
 * The layering inside the package mirrors the layering outside it: `useHarnessChat`
 * owns the seven SSE events, `useHarnessPreview` owns the sandbox and the bridge (and
 * the once-per-build crash guard), `useHarnessFiles` owns the read-only views, and the
 * components are composition over those three. A host that wants its own chrome drops
 * the components and keeps the hooks without losing a single protocol rule.
 */

/* ------------------------------------------------------------------------- *
 * Provider
 * ------------------------------------------------------------------------- */

export { HarnessProvider } from './context';
export type {
  HarnessAuth,
  HarnessBrand,
  HarnessCapabilities,
  HarnessProviderProps,
  HarnessRequest,
  HarnessRequestInit,
  WorkspaceBus,
} from './context';
export { HarnessHttpError } from './context';
export type { HarnessStrings } from './strings';

/* ------------------------------------------------------------------------- *
 * Builder and panes
 * ------------------------------------------------------------------------- */

export { Builder } from './Builder';
export type { BuilderFilePanel, BuilderLayout, BuilderProps } from './Builder';

export { ChatPane } from './ChatPane';
export type { ChatPaneProps } from './ChatPane';

export { PreviewPane } from './PreviewPane';
export type { PreviewPaneProps } from './PreviewPane';

export { FileExplorer } from './FileExplorer';
export type { FileExplorerProps } from './FileExplorer';

export { VersionTimeline } from './VersionTimeline';
export type { VersionTimelineProps } from './VersionTimeline';

/* ------------------------------------------------------------------------- *
 * Headless hooks (own the protocol, state, and streaming)
 * ------------------------------------------------------------------------- */

export { useHarnessChat } from './useHarnessChat';
export type { ChatActivity, HarnessChat, SendOptions, UseHarnessChatOptions } from './useHarnessChat';

export { useHarnessPreview } from './useHarnessPreview';
export type { BundleFn, HarnessPreview, PreviewFailure, UseHarnessPreviewOptions } from './useHarnessPreview';

export { useHarnessFiles } from './useHarnessFiles';
export type { FileTreeNode, HarnessFiles, UseHarnessFilesOptions } from './useHarnessFiles';

/* ------------------------------------------------------------------------- *
 * Item model, plan choices, and the label defaults
 * ------------------------------------------------------------------------- */

export { describeTool, historyToItems, isAssistantItem, isToolItem, isUserItem } from './items';
export type {
  AssistantChatItem,
  ChatItem,
  ToolChatItem,
  ToolStatus,
  TurnChange,
  UserChatItem,
} from './items';

export { parseAssistantSegments } from './choices';
export type { AssistantSegment, ChoiceOption, ChoiceSpec } from './choices';

export { DEFAULT_STRINGS } from './strings';

/* ------------------------------------------------------------------------- *
 * Re-exports
 * ------------------------------------------------------------------------- */

// The normative sandbox attribute string, so a host assembling its own iframe uses
// the same one the workspace does. Never hand-write it.
export { SANDBOX_ATTRIBUTES } from '@speculos-harness/preview';

// Re-export the wire types so consumers can type against one import.
export type { ChatMessage } from '@speculos-harness/protocol';
export type { Attachment, Capabilities, FileMap, Snapshot } from '@speculos-harness/protocol';
