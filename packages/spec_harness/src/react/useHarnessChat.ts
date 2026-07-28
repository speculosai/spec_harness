/**
 * The chat protocol, as a hook.
 *
 * `POST {base}/chat` is answered with a hand-rolled SSE stream, so this uses a
 * streaming `fetch` rather than `EventSource` - `EventSource` cannot POST, and the
 * turn's body is what the request is. The seven events of `spec/chat-protocol.md` are
 * parsed here and nowhere else in the package.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Attachment, ChatMessage, Project, ToolResultOutput } from '../protocol';

import { errorMessageOf, useHarness } from './context';
import { historyToItems, isMutatingTool, isToolItem, parseArgs } from './items';
import type { AssistantChatItem, ChatItem, ToolChatItem, UserChatItem } from './items';
import { readSseStream } from './sse';
import type { Translate } from './strings';

/** What the agent is doing right now, for the one-line status under the transcript. */
export type ChatActivity =
  | { kind: 'thinking' }
  | { kind: 'writing' }
  | { kind: 'tool-input' }
  | { kind: 'tool-running'; name: string }
  | { kind: 'tool-result' };

/** Per-turn options for {@link HarnessChat.send}. */
export interface SendOptions {
  /** Ask for a plan instead of code. Omitted from the request when false. */
  planMode?: boolean;
  /** Per-turn model override; the server honours it only if it is in the allowed set. */
  model?: string;
  /** Images and CSVs to send with this turn. */
  attachments?: Attachment[];
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
  /** What the agent is doing right now, or `null` between turns. */
  activity: ChatActivity | null;
  /** Whether the persisted history is still loading. */
  loading: boolean;
  /** Re-read the persisted conversation (after a restore, say). */
  reload: () => void;
}

/** A monotonic id source for React keys. */
let idCounter = 0;
function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/** The advisory language hint, from the document the workspace is embedded in. */
function currentLang(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const tag = document.documentElement.lang || (typeof navigator !== 'undefined' ? navigator.language : '');
  return tag ? tag.split('-')[0] : undefined;
}

/**
 * Turn a provider failure into something a person can act on.
 *
 * The raw text goes to the console for whoever is debugging; the bubble gets plain
 * language. "AccessDeniedException when calling the InvokeModelWithResponseStream
 * operation" is not a message to put in front of someone building a dashboard.
 */
function friendlyStreamError(raw: string, t: Translate): string {
  if (raw) {
    try {
      console.warn('[speculos-harness] chat stream error:', raw);
    } catch {
      /* console is optional */
    }
  }
  if (/model not found|invalid model|model_?id|no such model|not supported/i.test(raw)) {
    return t('error.modelUnavailable');
  }
  if (/access denied|accessdenied|not authorized|unauthorized|forbidden|permission/i.test(raw)) {
    return t('error.accessDenied');
  }
  if (/throttl|rate.?limit|too many requests|429/i.test(raw)) return t('error.rateLimited');
  return t('error.generic');
}

/** A short, single-line server message worth showing next to an HTTP status. */
function shortServerMessage(body: unknown, status: number): string | null {
  const message = errorMessageOf(body, status);
  if (!message || message === `HTTP ${status}`) return null;
  if (message.length > 160 || message.includes('\n')) return null;
  return message;
}

/** Wire attachments carry only what the protocol defines - no local bookkeeping. */
function wireAttachment(attachment: Attachment): Attachment {
  return attachment.kind === 'image'
    ? { kind: 'image', name: attachment.name, dataUrl: attachment.dataUrl }
    : { kind: 'csv', name: attachment.name, text: attachment.text, rows: attachment.rows };
}

/**
 * The chat protocol as a hook: opens the SSE stream, parses the seven events, pairs
 * tool cards by index, and exposes `filesChangedAt` (the `fileSig` contract).
 */
export function useHarnessChat(opts: UseHarnessChatOptions): HarnessChat {
  const { projectId, baseUrl } = opts;
  const { request, requestJson, t, bus } = useHarness();

  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<ChatActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);

  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // A host that passes an inline `strings` object gets a fresh `t` on every render.
  // Effects therefore read it through a ref: re-reading a project's history because
  // the host re-rendered would be a fetch loop nobody asked for.
  const tRef = useRef(t);
  tRef.current = t;

  const filesChangedAt = useSyncExternalStore(
    bus.subscribe,
    () => bus.getRebuildKey(projectId),
    () => 'init',
  );
  const historyEpoch = useSyncExternalStore(
    bus.subscribe,
    () => bus.getHistoryEpoch(projectId),
    () => 0,
  );

  /* -- history ----------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const project = await requestJson<Project>(`/projects/${encodeURIComponent(projectId)}`, { baseUrl });
        if (cancelled) return;
        // A turn started before history landed wins: never overwrite live work.
        if (!busyRef.current) setItems(historyToItems(project.messages as ChatMessage[]));
      } catch (err) {
        if (cancelled) return;
        const detail = err instanceof Error ? err.message : '';
        setItems((current) =>
          current.length
            ? current
            : [
                {
                  id: uid('e'),
                  kind: 'assistant',
                  text: tRef.current('error.loadProject', { detail }),
                  isError: true,
                } as AssistantChatItem,
              ],
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, baseUrl, requestJson, reloadNonce, historyEpoch]);

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  /* -- item mutations ---------------------------------------------------- */

  const pushItem = useCallback((item: ChatItem) => {
    setItems((current) => [...current, item]);
  }, []);

  const appendAssistantText = useCallback((text: string) => {
    setItems((current) => {
      const last = current[current.length - 1];
      if (last && last.kind === 'assistant' && !(last as AssistantChatItem).isError) {
        const merged: AssistantChatItem = {
          ...(last as AssistantChatItem),
          text: (last as AssistantChatItem).text + text,
        };
        return [...current.slice(0, -1), merged];
      }
      const fresh: AssistantChatItem = { id: uid('a'), kind: 'assistant', text };
      return [...current, fresh];
    });
  }, []);

  const patchTool = useCallback((toolCallId: string, patch: Partial<ToolChatItem>) => {
    setItems((current) =>
      current.map((item) =>
        isToolItem(item) && item.toolCallId === toolCallId ? ({ ...item, ...patch } as ToolChatItem) : item,
      ),
    );
  }, []);

  /* -- the turn ---------------------------------------------------------- */

  const runTurn = useCallback(
    async (text: string, options?: SendOptions): Promise<void> => {
      const attachments = options?.attachments ?? [];
      if ((!text.trim() && attachments.length === 0) || busyRef.current) return;

      busyRef.current = true;
      setBusy(true);
      setActivity({ kind: 'thinking' });

      const userItem: UserChatItem = { id: uid('u'), kind: 'user', text };
      if (attachments.length) userItem.attachments = attachments;
      pushItem(userItem);

      // Argument text arrives before the tool is identified, so a card is opened per
      // `index` and reconciled when the matching `tool-call` lands.
      const pending = new Map<number, { tempId: string; argsText: string }>();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await request('/chat', {
          baseUrl,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            projectId,
            message: text,
            // Omitted rather than sent false: the wire says "omit when false".
            planMode: options?.planMode ? true : undefined,
            model: options?.model || undefined,
            lang: currentLang(),
            attachments: attachments.length ? attachments.map(wireAttachment) : undefined,
          }),
        });

        if (!response.ok || !response.body) {
          const body: unknown = await response
            .clone()
            .json()
            .catch(() => null);
          const detail = shortServerMessage(body, response.status);
          const base = tRef.current('error.http', { status: response.status });
          pushItem({
            id: uid('e'),
            kind: 'assistant',
            text: detail ? `${base} ${detail}` : base,
            isError: true,
          } as AssistantChatItem);
          return;
        }

        const handle = (event: string, data: Record<string, unknown>): void => {
          switch (event) {
            // The user's bubble was rendered optimistically when the request went
            // out. Echoing this event would double-render it on every turn.
            case 'user-message':
              return;

            case 'text-delta': {
              const delta = typeof data.text === 'string' ? data.text : '';
              if (!delta) return;
              setActivity({ kind: 'writing' });
              appendAssistantText(delta);
              return;
            }

            case 'tool-call-delta': {
              const index = typeof data.index === 'number' ? data.index : 0;
              const argsDelta = typeof data.argsDelta === 'string' ? data.argsDelta : '';
              setActivity({ kind: 'tool-input' });
              const open = pending.get(index);
              if (open) {
                open.argsText += argsDelta;
                patchTool(open.tempId, { argsText: open.argsText });
                return;
              }
              const tempId = uid('pending');
              pending.set(index, { tempId, argsText: argsDelta });
              pushItem({
                id: tempId,
                kind: 'tool',
                toolCallId: tempId,
                name: '',
                argsText: argsDelta,
                status: 'streaming',
              } as ToolChatItem);
              return;
            }

            case 'tool-call': {
              const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId : uid('call');
              const name = typeof data.name === 'string' ? data.name : '';
              const input =
                data.input && typeof data.input === 'object' && !Array.isArray(data.input)
                  ? (data.input as Record<string, unknown>)
                  : {};
              setActivity({ kind: 'tool-running', name });

              // Pair by canonicalized-argument equality first, then by the earliest
              // still-pending card. Both halves matter: parallel tool calls stream
              // interleaved, and a card that never got a delta must still resolve.
              const canonical = JSON.stringify(input);
              let matched: number | null = null;
              for (const [index, open] of pending) {
                if (JSON.stringify(parseArgs(open.argsText)) === canonical) {
                  matched = index;
                  break;
                }
              }
              if (matched === null && pending.size > 0) matched = pending.keys().next().value ?? null;

              if (matched !== null) {
                const open = pending.get(matched)!;
                pending.delete(matched);
                patchTool(open.tempId, { toolCallId, name, input, status: 'pending' });
              } else {
                pushItem({
                  id: uid('t'),
                  kind: 'tool',
                  toolCallId,
                  name,
                  argsText: canonical,
                  input,
                  status: 'pending',
                } as ToolChatItem);
              }
              return;
            }

            case 'tool-result': {
              const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId : '';
              const name = typeof data.name === 'string' ? data.name : '';
              const output =
                data.output && typeof data.output === 'object' && !Array.isArray(data.output)
                  ? (data.output as ToolResultOutput)
                  : {};
              // `ok !== false`, deliberately: a result with no `ok` key is a success.
              const ok = output.ok !== false;
              setActivity({ kind: 'tool-result' });
              patchTool(toolCallId, { output, status: ok ? 'done' : 'error' });
              // The entire "the preview feels live" mechanism: a successful
              // file-mutating tool bumps the rebuild key and the sandbox refreshes.
              if (ok && isMutatingTool(name)) bus.bumpRebuild(projectId);
              return;
            }

            case 'error': {
              const raw = typeof data.message === 'string' ? data.message : '';
              setActivity(null);
              pushItem({
                id: uid('e'),
                kind: 'assistant',
                text: friendlyStreamError(raw, tRef.current),
                isError: true,
              } as AssistantChatItem);
              return;
            }

            // `done` is advisory - the stream truly ends on reader EOF - and any
            // event name this client does not know is ignored on purpose, which is
            // what keeps additive minor versions safe.
            default:
              return;
          }
        };

        for await (const frame of readSseStream(response.body)) {
          handle(frame.event, frame.data);
        }
      } catch (err) {
        // A user-initiated stop is not an error: the server's finally-guard has
        // already persisted whatever was assembled, so the partial turn survives.
        const aborted = (err as { name?: string } | null)?.name === 'AbortError';
        if (!aborted) {
          try {
            console.warn('[speculos-harness] chat transport error:', err);
          } catch {
            /* console is optional */
          }
          pushItem({
            id: uid('e'),
            kind: 'assistant',
            text: tRef.current('error.network'),
            isError: true,
          } as AssistantChatItem);
        }
      } finally {
        abortRef.current = null;
        busyRef.current = false;
        setBusy(false);
        setActivity(null);
      }
    },
    [appendAssistantText, baseUrl, bus, patchTool, projectId, pushItem, request],
  );

  const send = useCallback(
    (text: string, options?: SendOptions) => {
      void runTurn(text, options);
    },
    [runTurn],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // The preview reads this to show "patching…" instead of a raw error while the
  // agent is mid-repair, and to hold its auto-fix until the turn is over.
  useEffect(() => {
    bus.setBusy(projectId, busy);
    return () => bus.setBusy(projectId, false);
  }, [bus, projectId, busy]);

  return useMemo(
    () => ({ items, send, stop, busy, filesChangedAt, activity, loading, reload }),
    [items, send, stop, busy, filesChangedAt, activity, loading, reload],
  );
}
