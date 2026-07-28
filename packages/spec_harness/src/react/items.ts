/**
 * The chat item model: what the message log renders, how persisted history turns
 * back into it, and how a tool call is described in product language.
 *
 * Two read rules from `spec/message-format.md` live here. A CSV attachment is
 * persisted as an `attachment_csv` content part, and readers MUST also accept the
 * legacy `speculos_csv` tag indefinitely - a reader that knows only the new name
 * silently drops every CSV from every pre-rename conversation on reload.
 */

import { CSV_PART, LEGACY_CSV_PART, MUTATING_TOOLS } from '../protocol';
import type { Attachment, ChatMessage, ToolResultOutput } from '../protocol';

import type { Translate } from './strings';

/** A rendered chat item: a user bubble, an assistant bubble, or a tool card. */
export interface ChatItem {
  /** Stable key for React. */
  id: string;
  /** What kind of item this is. */
  kind: 'user' | 'assistant' | 'tool';
  /** Item-specific fields (text, tool name/input/output, pending flag). */
  [key: string]: unknown;
}

/** Where a tool card is in its life: streaming args, running, finished, failed. */
export type ToolStatus = 'streaming' | 'pending' | 'done' | 'error';

/** The user's own turn. */
export interface UserChatItem extends ChatItem {
  /** Discriminant. */
  kind: 'user';
  /** What the user typed. */
  text: string;
  /** Images and CSVs sent with the turn. */
  attachments?: Attachment[];
  /** Index into the persisted message log, when this item came from history. */
  messageIndex?: number;
}

/** A run of assistant prose. Plan-mode choice blocks ride inside `text`. */
export interface AssistantChatItem extends ChatItem {
  /** Discriminant. */
  kind: 'assistant';
  /** The assistant's text so far. */
  text: string;
  /** Set when this bubble is a friendly rendering of an `error` event. */
  isError?: boolean;
}

/** One tool call and its result, rendered as a single legible line. */
export interface ToolChatItem extends ChatItem {
  /** Discriminant. */
  kind: 'tool';
  /** The wire tool-call id, or a temporary id while only deltas have arrived. */
  toolCallId: string;
  /** The tool name, once `tool-call` has landed. */
  name: string;
  /** The raw argument text accumulated from `tool-call-delta`. */
  argsText: string;
  /** The parsed input from `tool-call`. */
  input?: Record<string, unknown>;
  /** The output from `tool-result`. */
  output?: ToolResultOutput;
  /** Where the card is in its life. */
  status: ToolStatus;
}

/** Narrow a {@link ChatItem} to the user variant. */
export function isUserItem(item: ChatItem): item is UserChatItem {
  return item.kind === 'user';
}

/** Narrow a {@link ChatItem} to the assistant variant. */
export function isAssistantItem(item: ChatItem): item is AssistantChatItem {
  return item.kind === 'assistant';
}

/** Narrow a {@link ChatItem} to the tool variant. */
export function isToolItem(item: ChatItem): item is ToolChatItem {
  return item.kind === 'tool';
}

/** Whether a successful result for this tool should bump the rebuild key. */
export function isMutatingTool(name: string): boolean {
  return (MUTATING_TOOLS as readonly string[]).includes(name);
}

/** Parse a tool call's JSON arguments without ever throwing. */
export function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readString(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === 'string' ? value : undefined;
}

/** Drop the leading slash so a path reads like a filename in the transcript. */
function trimPath(path: string | undefined, fallback: string): string {
  if (!path) return fallback;
  return path.replace(/^\/+/, '') || fallback;
}

/**
 * One product-facing line per tool call.
 *
 * The person building an app should read "Wrote App.tsx", not `write_file` and a blob
 * of JSON. A tool this build does not know about falls back to its own name, which is
 * still better than hiding that something happened.
 */
export function describeTool(item: ToolChatItem, t: Translate): string {
  const input = item.input;
  switch (item.name) {
    case 'write_file':
      return t('tool.wroteFile', { path: trimPath(readString(input, 'path'), t('tool.fallbackFile')) });
    case 'edit_file':
      return t('tool.editedFile', { path: trimPath(readString(input, 'path'), t('tool.fallbackFile')) });
    case 'delete_file':
      return t('tool.deletedFile', { path: trimPath(readString(input, 'path'), t('tool.fallbackFile')) });
    case 'read_file':
      return t('tool.readFile', { path: trimPath(readString(input, 'path'), t('tool.fallbackFile')) });
    case 'install_package':
      return t('tool.installed', { name: readString(input, 'name') ?? t('tool.fallbackPackage') });
    case '':
    case '…':
      return t('tool.working');
    default:
      return t('tool.ran', { name: item.name.replace(/_/g, ' ') });
  }
}

/* ------------------------------------------------------------------------- *
 * History rehydration
 * ------------------------------------------------------------------------- */

function attachmentFromPart(part: Record<string, unknown>): Attachment | null {
  const type = part.type;
  if (type === 'image_url') {
    const ref = part.image_url;
    const url = ref && typeof ref === 'object' ? (ref as Record<string, unknown>).url : undefined;
    if (typeof url !== 'string' || !url) return null;
    return { kind: 'image', name: readString(part, 'name') ?? 'image', dataUrl: url };
  }
  // Both tags are the same part. The legacy one is never written and always read.
  if (type === CSV_PART || type === LEGACY_CSV_PART) {
    const text = readString(part, 'text') ?? '';
    const rows = typeof part.rows === 'number' ? part.rows : undefined;
    return { kind: 'csv', name: readString(part, 'name') ?? 'attachment.csv', text, rows };
  }
  return null;
}

/**
 * Turn a persisted conversation back into rendered items.
 *
 * Tool results are matched to their calls by `tool_call_id`, so a reloaded page shows
 * the same finished cards the live stream produced, in the same order.
 */
export function historyToItems(messages: ChatMessage[] | null | undefined): ChatItem[] {
  if (!Array.isArray(messages)) return [];
  const items: ChatItem[] = [];
  let counter = 0;
  const nextId = (prefix: string): string => `${prefix}-${counter++}`;

  messages.forEach((message, index) => {
    if (!message || typeof message !== 'object') return;

    if (message.role === 'user') {
      let text = '';
      const attachments: Attachment[] = [];
      if (typeof message.content === 'string') {
        text = message.content;
      } else if (Array.isArray(message.content)) {
        for (const rawPart of message.content) {
          if (!rawPart || typeof rawPart !== 'object') continue;
          const part = rawPart as unknown as Record<string, unknown>;
          if (part.type === 'text' && typeof part.text === 'string') {
            text += (text ? '\n' : '') + part.text;
            continue;
          }
          const attachment = attachmentFromPart(part);
          if (attachment) attachments.push(attachment);
        }
      }
      const item: UserChatItem = {
        id: nextId('u'),
        kind: 'user',
        text,
        messageIndex: index,
      };
      if (attachments.length) item.attachments = attachments;
      items.push(item);
      return;
    }

    if (message.role === 'assistant') {
      if (typeof message.content === 'string' && message.content.trim()) {
        const item: AssistantChatItem = { id: nextId('a'), kind: 'assistant', text: message.content };
        items.push(item);
      } else if (Array.isArray(message.content)) {
        const text = message.content
          .map((part) =>
            part && typeof part === 'object' && (part as { type?: unknown }).type === 'text'
              ? String((part as { text?: unknown }).text ?? '')
              : '',
          )
          .filter(Boolean)
          .join('\n');
        if (text.trim()) items.push({ id: nextId('a'), kind: 'assistant', text } as AssistantChatItem);
      }
      for (const call of message.tool_calls ?? []) {
        const args = call?.function?.arguments ?? '';
        const item: ToolChatItem = {
          id: nextId('t'),
          kind: 'tool',
          toolCallId: call?.id ?? nextId('call'),
          name: call?.function?.name ?? '',
          argsText: args,
          input: parseArgs(args),
          status: 'pending',
        };
        items.push(item);
      }
      return;
    }

    if (message.role === 'tool') {
      let output: ToolResultOutput;
      try {
        const parsed: unknown = typeof message.content === 'string' ? JSON.parse(message.content) : message.content;
        output =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as ToolResultOutput)
            : { ok: true, result: parsed };
      } catch {
        output = { ok: false, error: typeof message.content === 'string' ? message.content : 'unreadable result' };
      }
      const target = items.find(
        (item): item is ToolChatItem => isToolItem(item) && item.toolCallId === message.tool_call_id,
      );
      if (target) {
        target.output = output;
        // `ok !== false` on purpose: a result with no `ok` key at all is a success.
        target.status = output.ok === false ? 'error' : 'done';
      }
    }
  });

  return items;
}

/* ------------------------------------------------------------------------- *
 * What each turn changed
 * ------------------------------------------------------------------------- */

/** One file a turn touched. */
export interface TurnChange {
  /** The in-project path. */
  path: string;
  /** How it was touched. */
  kind: 'write' | 'edit' | 'delete';
  /** The whole content, when the turn wrote one (`write_file` carries it). */
  content?: string;
}

/**
 * Walk the message log and report which files each turn touched.
 *
 * A "turn" is one user message and everything the agent did in reply, numbered from
 * 1. This is what the explorer's change markers and `useHarnessFiles().diff(turn)`
 * both read, so they can never disagree.
 */
export function changesByTurn(messages: ChatMessage[] | null | undefined): Map<number, TurnChange[]> {
  const byTurn = new Map<number, TurnChange[]>();
  if (!Array.isArray(messages)) return byTurn;
  let turn = 0;

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'user') {
      turn += 1;
      continue;
    }
    if (message.role !== 'assistant' || !message.tool_calls?.length) continue;
    if (turn === 0) turn = 1;

    for (const call of message.tool_calls) {
      const name = call?.function?.name ?? '';
      if (!isMutatingTool(name) || name === 'install_package') continue;
      const args = parseArgs(call?.function?.arguments);
      const path = readString(args, 'path');
      if (!path) continue;
      const kind = name === 'write_file' ? 'write' : name === 'delete_file' ? 'delete' : 'edit';
      const change: TurnChange = { path, kind };
      const content = readString(args, 'content');
      if (kind === 'write' && content !== undefined) change.content = content;
      const list = byTurn.get(turn) ?? [];
      list.push(change);
      byTurn.set(turn, list);
    }
  }

  return byTurn;
}
