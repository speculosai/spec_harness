/**
 * The preview, as a hook: bundle on the rebuild key, assemble the null-origin
 * document, own the parent side of the postMessage bridge, and report a failure
 * exactly once per build.
 *
 * The once-per-`rebuildKey` guard lives in here rather than in `<Builder>` on purpose.
 * It is the only thing standing between "the agent repairs its own crash" and an
 * infinite repair loop, and a custom layout must not be able to lose it by wiring the
 * panes up differently.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildErrorDoc, buildSrcDoc, createBridge, makeShim, SANDBOX_ATTRIBUTES } from '../preview';
import type { IframeStrings } from '../preview';
import type {
  ConnectorProvider,
  ConnectorSummary,
  FileMap,
  Project,
  RuntimeContext,
} from '../protocol';

import { errorMessageOf, useHarness } from './context';

/** A bundle function: `{files, deps}` in, `{code, css}` (or `{error}`) out. */
export type BundleFn = (
  files: FileMap,
  deps: Record<string, string>,
  signal?: AbortSignal,
) => Promise<{ code: string; css: string } | { error: string }>;

/** A failure the preview is showing: a build that did not compile, or a crash at runtime. */
export interface PreviewFailure {
  /** Which half failed. */
  kind: 'build' | 'runtime';
  /** The message, as the build service or the frame reported it. */
  message: string;
  /**
   * Whether this was infrastructure rather than the app: an unreachable or
   * unconfigured build service. The agent is never asked to repair one of these -
   * conflating a 502 with a 422 makes it rewrite code that was never wrong.
   */
  fault?: boolean;
}

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
  /**
   * Attach this to the iframe (`<iframe ref={preview.ref} …>`). The parent half of the
   * data bridge is bound to that element - without it the frame renders, but every
   * `window.<ns>` call times out with no one listening.
   */
  ref: (element: HTMLIFrameElement | null) => void;
  /** Whether a bundle is in flight. */
  building: boolean;
  /** The current failure, or `null`. */
  error: PreviewFailure | null;
  /** Dismiss the current failure without rebuilding. */
  dismissError: () => void;
  /** Force a fresh build (bumps the shared rebuild key). */
  rebuild: () => void;
}

/** The bundle proxy's success body, including the optional connector summary. */
interface BundlePayload {
  code?: unknown;
  css?: unknown;
  connectors?: unknown;
}

type BuildOutcome =
  | { code: string; css: string; connectors?: ConnectorSummary }
  | { error: string; fault?: boolean };

/**
 * The preview as a hook: rebuilds on `rebuildKey`, assembles the srcdoc, owns the
 * bridge, and fires `onError` at most once per rebuild.
 */
export function useHarnessPreview(opts: UseHarnessPreviewOptions): HarnessPreview {
  const { projectId, rebuildKey, bundle, onError } = opts;
  const { request, requestJson, namespace, connectors, previewHead, auth, t, bus } = useHarness();

  const [srcDoc, setSrcDoc] = useState('');
  const [building, setBuilding] = useState(true);
  const [error, setError] = useState<PreviewFailure | null>(null);
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);

  const key = `${projectId}:${rebuildKey}`;
  const keyRef = useRef(key);
  keyRef.current = key;
  const firedFor = useRef<string | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  /** Report a failure to the host at most once per build. */
  const reportOnce = useCallback((failure: { message: string; stack?: string }) => {
    if (firedFor.current === keyRef.current) return;
    firedFor.current = keyRef.current;
    onErrorRef.current?.(failure);
  }, []);

  // Read through refs, never through effect dependencies. A host that passes an
  // inline `strings` object or an inline `connectors` array would otherwise re-bundle
  // the project and tear down the bridge on every one of its own renders.
  const tRef = useRef(t);
  tRef.current = t;
  const connectorsRef = useRef(connectors);
  connectorsRef.current = connectors;
  const authRef = useRef(auth);
  authRef.current = auth;
  const bundleRef = useRef(bundle);
  bundleRef.current = bundle;

  const iframeStrings = useCallback(
    (): IframeStrings => ({
      renderedNothing: tRef.current('preview.renderedNothing'),
      errorHeading: tRef.current('preview.errorHeading'),
      errorRepairing: tRef.current('preview.errorRepairing'),
      // Keeps the `{{name}}` placeholder the stub substitutes in-frame.
      notConnected: tRef.current('preview.notConnected'),
      requestTimedOut: tRef.current('preview.requestTimedOut'),
      unknownError: tRef.current('preview.unknownError'),
    }),
    [],
  );

  /* -- building ---------------------------------------------------------- */

  const runBuild = useCallback(
    async (signal: AbortSignal): Promise<BuildOutcome> => {
      // A browser bundler builds from the file map, so the project has to come down
      // first. The server proxy already has the files and needs no body at all.
      const custom = bundleRef.current;
      if (custom) {
        const project = await requestJson<Project>(`/projects/${encodeURIComponent(projectId)}`);
        return custom(project.files ?? {}, project.dependencies ?? {}, signal);
      }
      const response = await request(`/bundle/${encodeURIComponent(projectId)}`, { method: 'POST', signal });
      const body: unknown = await response.json().catch(() => null);
      // 422 is an ordinary, recoverable build result. Anything else - an unreachable
      // sidecar, a deployment with no bundler, a rejected caller - is a fault, and the
      // agent must not be asked to fix code that was never the problem.
      if (!response.ok) {
        return { error: errorMessageOf(body, response.status), fault: response.status !== 422 };
      }
      const payload = (body ?? {}) as BundlePayload;
      return {
        code: typeof payload.code === 'string' ? payload.code : '',
        css: typeof payload.css === 'string' ? payload.css : '',
        connectors:
          payload.connectors && typeof payload.connectors === 'object'
            ? (payload.connectors as ConnectorSummary)
            : undefined,
      };
    },
    [projectId, request, requestJson],
  );

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setBuilding(true);
    setError(null);

    void (async () => {
      let outcome: BuildOutcome;
      try {
        outcome = await runBuild(controller.signal);
      } catch (err) {
        if (cancelled || (err as { name?: string } | null)?.name === 'AbortError') return;
        outcome = { error: err instanceof Error ? err.message : String(err), fault: true };
      }
      if (cancelled) return;

      const strings = iframeStrings();
      if ('error' in outcome) {
        // Never a blank frame: the same readable card a runtime crash produces, with
        // the build error in it. `report: false` because the failure is reported here
        // directly - the frame's own channel would be a second, redundant hop.
        setSrcDoc(buildErrorDoc({ error: outcome.error, headHtml: previewHead, strings, report: false }));
        setError({ kind: 'build', message: outcome.error, fault: outcome.fault });
        if (!outcome.fault) reportOnce({ message: `Build failed:\n${outcome.error}` });
      } else {
        setSrcDoc(
          buildSrcDoc({
            code: outcome.code,
            css: outcome.css,
            namespace,
            headHtml: previewHead,
            shim: makeShim(namespace, outcome.connectors, { strings }),
            strings,
          }),
        );
        setError(null);
      }
      setBuilding(false);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, runBuild, namespace, previewHead, iframeStrings, reportOnce]);

  /* -- the bridge -------------------------------------------------------- */

  // Which kinds each client-half connector answers. Resolved once per provider: a
  // provider that cannot say is simply not consulted, and the request goes to the
  // server proxy instead.
  const kindsCache = useRef(new Map<ConnectorProvider, string[]>());

  const handleBridgeRequest = useCallback(
    async (kind: string, payload: unknown): Promise<unknown> => {
      for (const provider of connectorsRef.current) {
        let kinds = kindsCache.current.get(provider);
        if (!kinds) {
          try {
            const summary = await provider.list();
            kinds = Array.isArray(summary.kinds) ? summary.kinds.map(String) : [];
          } catch {
            kinds = [];
          }
          kindsCache.current.set(provider, kinds);
        }
        if (!kinds.includes(kind)) continue;
        // The browser holds no authoritative principal - the server resolves the real
        // one from the same headers. This is the shape a client half sees, nothing
        // more; a client-half connector must not make an access decision on it.
        const ctx: RuntimeContext = {
          principal: { userId: 'client', canEdit: authRef.current.canEdit !== false },
          namespace,
          shareToken: authRef.current.shareToken,
        };
        try {
          return await provider.handle(kind, payload, ctx);
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      }

      // The default path: the credential lives on the server, so the frame's request
      // is proxied there and only the rows come back.
      try {
        const response = await request(`/connectors/${encodeURIComponent(kind)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload ?? {}),
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) return { error: errorMessageOf(body, response.status) };
        return body ?? {};
      } catch (err) {
        return { error: `Network error: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    [namespace, request],
  );

  useEffect(() => {
    if (!frame) return;
    const bridge = createBridge({
      iframe: frame,
      namespace,
      onRequest: handleBridgeRequest,
      onError: (err) => {
        const message = err.stack ? `${err.message}\n${err.stack}` : err.message;
        setError({ kind: 'runtime', message });
        reportOnce(err);
      },
    });
    return () => bridge.destroy();
  }, [frame, namespace, handleBridgeRequest, reportOnce]);

  const dismissError = useCallback(() => setError(null), []);
  const rebuild = useCallback(() => bus.bumpRebuild(projectId), [bus, projectId]);

  return useMemo(
    () => ({
      srcDoc,
      sandbox: SANDBOX_ATTRIBUTES,
      ref: setFrame,
      building,
      error,
      dismissError,
      rebuild,
    }),
    [srcDoc, building, error, dismissError, rebuild],
  );
}
