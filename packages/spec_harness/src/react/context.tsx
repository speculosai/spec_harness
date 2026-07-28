/**
 * The workspace context: where the backend is, who is asking, what it supports, and
 * the small shared bus that keeps independently-mounted panes in step.
 *
 * Everything below `<HarnessProvider>` gets one request helper, so identity is
 * attached to the chat stream, the bundle call, project and snapshot reads and every
 * bridge-proxy fetch in exactly the same way - the "thread auth through everything"
 * rule from `spec/security.md` is impossible to half-implement this way.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  DEFAULT_NAMESPACE,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
} from '../protocol';
import type { AuthMode, Capabilities, ConnectorProvider } from '../protocol';

import { makeTranslator } from './strings';
import type { HarnessStrings, Translate } from './strings';

/* ------------------------------------------------------------------------- *
 * Public props
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
  /**
   * Which credential mode the client uses. `bearer` (the default) sends
   * `credentials: 'omit'` and relies on `getHeaders`; `cookie` sends
   * `credentials: 'include'`. Cookie mode cross-origin additionally requires
   * `SameSite=None; Secure` cookies and a per-origin CORS allowlist - see
   * `spec/security.md`.
   */
  mode?: AuthMode;
}

/** Brand overrides. The logo is a slot, never hardcoded. */
export interface HarnessBrand {
  /** The product name shown in the workspace chrome. */
  name: string;
  /** A logo element rendered in place of the default mark. */
  Logo?: ReactNode;
}

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
  /**
   * The preview document's `<head>`. Defaults to the preview package's head, which
   * loads Tailwind from a CDN; a host under a strict CSP passes a precompiled,
   * inlined stylesheet here instead. Only the styling delivery changes.
   */
  previewHead?: string;
  /** The workspace subtree. */
  children?: ReactNode;
}

/* ------------------------------------------------------------------------- *
 * Capabilities
 * ------------------------------------------------------------------------- */

/**
 * The capabilities document, plus the additive `snapshots` flag the reference server
 * advertises. Unknown fields are ignored, per the spec's forward-compatibility rule.
 */
export interface HarnessCapabilities extends Capabilities {
  /** Whether the mounted store keeps snapshots; when false the version timeline hides. */
  snapshots?: boolean;
}

/**
 * The protocol-1 fallback a client MUST assume when `/capabilities` 404s or answers
 * without a `Harness-Protocol` header. These describe a plain protocol-1 server, which
 * is exactly what makes a capabilities-aware client work against a backend that
 * predates the endpoint.
 */
export function protocolOneDefaults(namespace: string): HarnessCapabilities {
  return {
    protocol: PROTOCOL_VERSION,
    namespace,
    sandbox: { location: 'server', supportsInstall: true, jsxRuntime: 'automatic' },
    planMode: true,
    attachments: ['image', 'csv'],
    models: [],
    connectors: [],
  };
}

/** Narrow an unknown `/capabilities` body onto {@link HarnessCapabilities}. */
function readCapabilities(body: unknown, namespace: string): HarnessCapabilities {
  const defaults = protocolOneDefaults(namespace);
  if (!body || typeof body !== 'object') return defaults;
  const raw = body as Record<string, unknown>;
  const sandbox = (raw.sandbox ?? {}) as Record<string, unknown>;
  const attachments = Array.isArray(raw.attachments)
    ? raw.attachments.filter((k): k is 'image' | 'csv' => k === 'image' || k === 'csv')
    : defaults.attachments;
  return {
    protocol: typeof raw.protocol === 'number' ? raw.protocol : defaults.protocol,
    namespace: typeof raw.namespace === 'string' && raw.namespace ? raw.namespace : namespace,
    sandbox: {
      location: sandbox.location === 'browser' ? 'browser' : 'server',
      supportsInstall: sandbox.supportsInstall !== false,
      jsxRuntime: sandbox.jsxRuntime === 'classic' ? 'classic' : 'automatic',
    },
    planMode: raw.planMode !== false,
    attachments,
    models: Array.isArray(raw.models) ? raw.models.filter((m): m is string => typeof m === 'string') : [],
    connectors: Array.isArray(raw.connectors)
      ? raw.connectors.filter((c): c is string => typeof c === 'string')
      : [],
    routing: raw.routing === true ? true : undefined,
    snapshots: typeof raw.snapshots === 'boolean' ? raw.snapshots : undefined,
  };
}

/* ------------------------------------------------------------------------- *
 * The shared workspace bus
 * ------------------------------------------------------------------------- */

/**
 * The state two panes must agree on even when they are mounted in different corners
 * of a host's layout: the rebuild key, whether a turn is streaming, and the channel
 * the preview uses to ask the chat for a repair.
 *
 * This is why `<ChatPane>` in a drawer and `<PreviewPane>` in a modal keep talking to
 * each other: they share one bus through the provider rather than props.
 */
export interface WorkspaceBus {
  /** Subscribe to any change; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void;
  /** The monotonic rebuild key for a project - the `fileSig` contract. */
  getRebuildKey: (projectId: string) => string;
  /** Bump the rebuild key: the preview re-bundles from scratch. */
  bumpRebuild: (projectId: string) => void;
  /** Whether a turn is currently streaming for this project. */
  getBusy: (projectId: string) => boolean;
  /** Record whether a turn is streaming. */
  setBusy: (projectId: string, busy: boolean) => void;
  /** A counter the chat watches to know the persisted history changed under it. */
  getHistoryEpoch: (projectId: string) => number;
  /** Announce that the persisted conversation was replaced (a restore, say). */
  bumpHistory: (projectId: string) => void;
  /** Ask a mounted chat to send a message. Returns whether anything took it. */
  requestSend: (projectId: string, text: string) => boolean;
  /** Register a chat as the taker of {@link WorkspaceBus.requestSend}. */
  onSendRequest: (projectId: string, handler: (text: string) => boolean) => () => void;
}

function createBus(): WorkspaceBus {
  const rebuildKeys = new Map<string, string>();
  const busyFlags = new Map<string, boolean>();
  const historyEpochs = new Map<string, number>();
  const senders = new Map<string, Set<(text: string) => boolean>>();
  const listeners = new Set<() => void>();
  let seq = 0;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getRebuildKey: (projectId) => rebuildKeys.get(projectId) ?? 'init',
    bumpRebuild: (projectId) => {
      // Monotonic and always different: the build effect is keyed on this string,
      // and two file writes in the same millisecond must still be two rebuilds.
      seq += 1;
      rebuildKeys.set(projectId, `${Date.now()}-${seq}`);
      notify();
    },
    getBusy: (projectId) => busyFlags.get(projectId) ?? false,
    setBusy: (projectId, busy) => {
      if ((busyFlags.get(projectId) ?? false) === busy) return;
      busyFlags.set(projectId, busy);
      notify();
    },
    getHistoryEpoch: (projectId) => historyEpochs.get(projectId) ?? 0,
    bumpHistory: (projectId) => {
      historyEpochs.set(projectId, (historyEpochs.get(projectId) ?? 0) + 1);
      notify();
    },
    requestSend: (projectId, text) => {
      for (const handler of senders.get(projectId) ?? []) {
        if (handler(text)) return true;
      }
      return false;
    },
    onSendRequest: (projectId, handler) => {
      const set = senders.get(projectId) ?? new Set();
      set.add(handler);
      senders.set(projectId, set);
      return () => {
        set.delete(handler);
      };
    },
  };
}

/* ------------------------------------------------------------------------- *
 * Requests
 * ------------------------------------------------------------------------- */

/** Extra knobs on a workspace request beyond the standard `fetch` init. */
export interface HarnessRequestInit extends RequestInit {
  /** Override the provider's base URL for this one call. */
  baseUrl?: string;
}

/** The request helper every hook and pane goes through. */
export type HarnessRequest = (path: string, init?: HarnessRequestInit) => Promise<Response>;

/** An HTTP failure with the server's own message pulled out where there was one. */
export class HarnessHttpError extends Error {
  /** The HTTP status. */
  readonly status: number;
  /** The parsed body, when there was one. */
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'HarnessHttpError';
    this.status = status;
    this.body = body;
  }
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const tail = path.startsWith('/') ? path : `/${path}`;
  return `${base}${tail}`;
}

function withToken(url: string, token?: string): string {
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

/** Pull the most useful message out of an error body, whatever shape it arrived in. */
export function errorMessageOf(body: unknown, status: number): string {
  if (typeof body === 'string' && body.trim()) return body.trim();
  if (body && typeof body === 'object') {
    const raw = body as Record<string, unknown>;
    const detail = raw.detail;
    if (typeof detail === 'string' && detail) return detail;
    if (detail && typeof detail === 'object') {
      const nested = (detail as Record<string, unknown>).error;
      if (typeof nested === 'string' && nested) return nested;
    }
    for (const key of ['error', 'message']) {
      const value = raw[key];
      if (typeof value === 'string' && value) return value;
    }
  }
  return `HTTP ${status}`;
}

/* ------------------------------------------------------------------------- *
 * Context
 * ------------------------------------------------------------------------- */

/** Everything the hooks and panes read out of the provider. */
export interface HarnessContextValue {
  /** Where the agent router is mounted. */
  baseUrl: string;
  /** The runtime namespace bound into `window.<ns>` and the bridge. */
  namespace: string;
  /** Client auth, as supplied by the host. */
  auth: HarnessAuth;
  /** Brand name and logo slot. */
  brand?: HarnessBrand;
  /** Connector client halves. */
  connectors: ConnectorProvider[];
  /** The preview document head override, when the host supplied one. */
  previewHead?: string;
  /** Resolve a label. */
  t: Translate;
  /** Issue an authenticated request against the mounted router. */
  request: HarnessRequest;
  /** Issue a request and parse JSON, throwing {@link HarnessHttpError} on failure. */
  requestJson: <T>(path: string, init?: HarnessRequestInit) => Promise<T>;
  /** What the server supports; protocol-1 defaults until the real answer lands. */
  capabilities: HarnessCapabilities;
  /** Whether `/capabilities` has been resolved (or definitively fallen back). */
  capabilitiesReady: boolean;
  /** The server's protocol integer when it does not match ours, else `null`. */
  protocolMismatch: number | null;
  /** The shared cross-pane bus. */
  bus: WorkspaceBus;
}

const HarnessContext = createContext<HarnessContextValue | null>(null);

/**
 * Read the workspace context. Internal to the package: the panes and the three public
 * hooks use it, and a host composes through those rather than through this.
 */
export function useHarness(): HarnessContextValue {
  const ctx = useContext(HarnessContext);
  if (!ctx) {
    throw new Error(
      '@speculosai/spec_harness: this must be rendered inside <HarnessProvider>. ' +
        'The provider carries the base URL, the auth header factory and the shared rebuild key.',
    );
  }
  return ctx;
}

/**
 * The context provider. Wraps a `<Builder>` (or your own composition of panes/hooks)
 * and supplies base URL, namespace, auth, brand, strings, and connectors to everything
 * beneath it.
 */
export function HarnessProvider(props: HarnessProviderProps): ReactElement {
  const { baseUrl, auth, brand, strings, previewHead, children } = props;
  const namespace = props.namespace || DEFAULT_NAMESPACE;
  const connectors = props.connectors;

  const [bus] = useState(createBus);
  const [capabilities, setCapabilities] = useState<HarnessCapabilities>(() =>
    protocolOneDefaults(namespace),
  );
  const [capabilitiesReady, setCapabilitiesReady] = useState(false);
  const [protocolMismatch, setProtocolMismatch] = useState<number | null>(null);

  // `auth` is usually an object literal, so it is a new reference on every host
  // render. Reading it through a ref keeps `request` stable without asking the host
  // to memoize anything.
  const authRef = useRef(auth);
  authRef.current = auth;

  const request = useMemo<HarnessRequest>(
    () => async (path, init = {}) => {
      const { baseUrl: override, headers, ...rest } = init;
      const current = authRef.current;
      const supplied = await current.getHeaders();
      const merged: Record<string, string> = {
        // Every request states the protocol it speaks; the response carries it back.
        [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
        ...(supplied ?? {}),
        ...((headers as Record<string, string> | undefined) ?? {}),
      };
      return fetch(withToken(joinUrl(override ?? baseUrl, path), current.shareToken), {
        ...rest,
        headers: merged,
        // Bearer is the default because it sidesteps third-party cookies entirely;
        // cookie mode is opt-in and only sane same-origin or with a per-origin CORS
        // allowlist (spec/security.md).
        credentials: current.mode === 'cookie' ? 'include' : 'omit',
      });
    },
    [baseUrl],
  );

  const requestJson = useMemo(
    () =>
      async <T,>(path: string, init?: HarnessRequestInit): Promise<T> => {
        const res = await request(path, init);
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) throw new HarnessHttpError(res.status, errorMessageOf(body, res.status), body);
        return body as T;
      },
    [request],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fallback = protocolOneDefaults(namespace);
      try {
        const res = await request('/capabilities');
        if (cancelled) return;
        // The 404 fallback is normative, and so is the missing-header one: without
        // `Harness-Protocol` we cannot tell a conforming body from a host's 200 page.
        if (!res.ok || !res.headers.get(PROTOCOL_HEADER)) {
          setCapabilities(fallback);
          setCapabilitiesReady(true);
          return;
        }
        const body: unknown = await res.json().catch(() => null);
        if (cancelled) return;
        const caps = readCapabilities(body, namespace);
        setCapabilities(caps);
        setCapabilitiesReady(true);
        if (caps.protocol !== PROTOCOL_VERSION) {
          setProtocolMismatch(caps.protocol);
          // Loud, because a mismatch is not something to paper over.
          console.error(
            `@speculosai/spec_harness: protocol mismatch - client speaks ${PROTOCOL_VERSION}, ` +
              `server speaks ${caps.protocol}.`,
          );
        } else {
          setProtocolMismatch(null);
        }
        if (caps.namespace !== namespace) {
          // The #1 integration failure: the preview loads, the app renders, and every
          // data call silently returns nothing (spec/preview-bridge.md).
          console.warn(
            `@speculosai/spec_harness: namespace mismatch - the provider uses "${namespace}" ` +
              `but the server is bound to "${caps.namespace}". Data calls will return nothing ` +
              'until they agree.',
          );
        }
      } catch {
        if (cancelled) return;
        setCapabilities(fallback);
        setCapabilitiesReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request, namespace]);

  const t = useMemo(() => makeTranslator(strings), [strings]);

  const value = useMemo<HarnessContextValue>(
    () => ({
      baseUrl,
      namespace,
      auth,
      brand,
      connectors: connectors ?? [],
      previewHead,
      t,
      request,
      requestJson,
      capabilities,
      capabilitiesReady,
      protocolMismatch,
      bus,
    }),
    [
      baseUrl,
      namespace,
      auth,
      brand,
      connectors,
      previewHead,
      t,
      request,
      requestJson,
      capabilities,
      capabilitiesReady,
      protocolMismatch,
      bus,
    ],
  );

  return <HarnessContext.Provider value={value}>{children}</HarnessContext.Provider>;
}

/* ------------------------------------------------------------------------- *
 * Bus subscriptions
 * ------------------------------------------------------------------------- */

/** Subscribe to a project's rebuild key - the string the preview build effect keys on. */
export function useRebuildKey(projectId: string): string {
  const { bus } = useHarness();
  return useSyncExternalStore(
    bus.subscribe,
    () => bus.getRebuildKey(projectId),
    () => 'init',
  );
}

/** Subscribe to whether a turn is streaming for a project. */
export function useAgentBusy(projectId: string): boolean {
  const { bus } = useHarness();
  return useSyncExternalStore(
    bus.subscribe,
    () => bus.getBusy(projectId),
    () => false,
  );
}
