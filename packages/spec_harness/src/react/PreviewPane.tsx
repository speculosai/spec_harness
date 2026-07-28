/**
 * The preview side of the workspace: the null-origin iframe, a small toolbar, and the
 * failure footer.
 *
 * The `sandbox` string comes from the package, never from this file - it is
 * security-load-bearing and non-configurable (`spec/security.md`). The frame's null
 * origin is why the data bridge exists at all, so the element also carries the hook's
 * `ref`: without it the bridge has nothing to listen to and every data call in the
 * generated app would time out.
 */

import { useCallback } from 'react';
import type { ReactElement } from 'react';

import { useAgentBusy, useHarness, useRebuildKey } from './context';
import { RepairIcon, RestoreIcon, SpinnerIcon } from './icons';
import { useHarnessPreview } from './useHarnessPreview';
import type { BundleFn } from './useHarnessPreview';

/** How much of a crash report is worth sending back to the agent. */
const MAX_ERROR_CHARS = 4000;

/** Props for {@link PreviewPane}. */
export interface PreviewPaneProps {
  /** The project to preview. */
  projectId: string;
  /** A string whose change forces a full rebuild (the `fileSig` contract). */
  rebuildKey?: string;
  /**
   * Replace the default crash handling. The default asks the agent to repair the
   * app - at most once per rebuild key, a guard that lives in the hook.
   */
  onError?: (err: { message: string; stack?: string }) => void;
  /** How to bundle. Defaults to the server proxy at `POST {base}/bundle/{id}`. */
  bundle?: BundleFn;
}

/**
 * The preview side: the null-origin sandboxed iframe, the postMessage bridge, the
 * readable fallback on build/runtime failure, and the once-per-build crash-to-auto-fix
 * request. Talks to the bundler through {@link useHarnessPreview}.
 */
export function PreviewPane(props: PreviewPaneProps): ReactElement {
  const { projectId, rebuildKey, onError, bundle } = props;
  const { t, auth, bus } = useHarness();
  const canEdit = auth.canEdit !== false;

  // The shared key is the default so a preview mounted anywhere in the host's layout
  // still rebuilds when the chat writes a file.
  const sharedKey = useRebuildKey(projectId);
  const busy = useAgentBusy(projectId);

  const askAgentToFix = useCallback(
    (message: string) => {
      if (!canEdit) return;
      const trimmed = message.length > MAX_ERROR_CHARS ? `${message.slice(0, MAX_ERROR_CHARS)}…` : message;
      bus.requestSend(projectId, t('preview.repairPrompt', { error: trimmed }));
    },
    [bus, canEdit, projectId, t],
  );

  const preview = useHarnessPreview({
    projectId,
    rebuildKey: rebuildKey ?? sharedKey,
    bundle,
    onError:
      onError ??
      ((err) => {
        askAgentToFix(err.stack ? `${err.message}\n${err.stack}` : err.message);
      }),
  });

  const failure = preview.error;

  return (
    <div className="harness-root harness-preview">
      <div className="harness-preview-bar">
        <span className="harness-preview-title">{t('preview.title')}</span>
        {preview.building && (
          <span className="harness-preview-status">
            <SpinnerIcon size={12} />
            {t('preview.building')}
          </span>
        )}
        {!preview.building && failure && busy && (
          <span className="harness-preview-status">
            <SpinnerIcon size={12} />
            {t('preview.patching')}
          </span>
        )}
        <button
          type="button"
          className="harness-icon-btn harness-preview-rebuild"
          title={t('preview.rebuild')}
          aria-label={t('preview.rebuild')}
          onClick={preview.rebuild}
        >
          <RestoreIcon size={14} />
        </button>
      </div>

      <iframe
        key={projectId}
        ref={preview.ref}
        className="harness-preview-frame"
        title={t('preview.iframeTitle')}
        srcDoc={preview.srcDoc}
        sandbox={preview.sandbox}
      />

      {failure && !busy && (
        <div className="harness-preview-error">
          <div className="harness-preview-error-head">
            <span className="harness-preview-error-title">
              {failure.fault
                ? t('preview.buildUnavailable')
                : failure.kind === 'build'
                  ? t('preview.buildFailed')
                  : t('preview.runtimeError')}
            </span>
            {canEdit && !failure.fault && (
              <button
                type="button"
                className="harness-btn harness-btn-soft"
                onClick={() => {
                  // A person asking explicitly is not the auto-fix loop, so this
                  // deliberately bypasses the once-per-build guard.
                  askAgentToFix(failure.message);
                  preview.dismissError();
                }}
              >
                <RepairIcon size={12} />
                {t('preview.askToFix')}
              </button>
            )}
            <button type="button" className="harness-link" onClick={preview.dismissError}>
              {t('preview.dismiss')}
            </button>
          </div>
          <pre className="harness-preview-error-body">{failure.message}</pre>
        </div>
      )}
    </div>
  );
}
