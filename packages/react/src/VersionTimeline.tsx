/**
 * The version history.
 *
 * Every turn is captured before it runs, so the timeline is a real undo rather than a
 * best-effort one: restoring takes an undo snapshot of the current state first, which
 * is what makes it safe to click through versions looking for the one you meant.
 */

import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Snapshot } from '@speculos-harness/protocol';

import { useHarness } from './context';
import { RestoreIcon, SpinnerIcon } from './icons';
import { useHarnessFiles } from './useHarnessFiles';

/** Props for {@link VersionTimeline}. */
export interface VersionTimelineProps {
  /** The project whose version history to show. */
  projectId: string;
  /** Called after a restore completes. */
  onRestore?: (snapshotId: string) => void;
}

function timestampOf(snapshot: Snapshot): number {
  const value = snapshot.createdAt as unknown;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(String(value ?? ''));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** "4 min ago", falling back to a plain local time where `Intl` cannot help. */
function relativeTime(at: number): string {
  if (!at) return '';
  const seconds = Math.round((at - Date.now()) / 1000);
  try {
    const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
      ['second', 60],
      ['minute', 60],
      ['hour', 24],
      ['day', 7],
      ['week', 4.35],
      ['month', 12],
    ];
    let value = seconds;
    for (const [unit, span] of units) {
      if (Math.abs(value) < span) return format.format(Math.round(value), unit);
      value /= span;
    }
    return format.format(Math.round(value), 'year');
  } catch {
    return new Date(at).toLocaleString();
  }
}

/**
 * The version history: every turn as a restorable version (the last ~30). Selecting one
 * shows the files it produced; restoring is itself undoable. Hides itself when the
 * server's `/capabilities` reports no snapshot support.
 */
export function VersionTimeline(props: VersionTimelineProps): ReactElement {
  const { projectId, onRestore } = props;
  const { t, auth } = useHarness();
  const files = useHarnessFiles({ projectId });
  const [pending, setPending] = useState<string | null>(null);
  // A viewer sees the history but cannot rewrite the project. The real boundary is
  // the server's `Principal.can_edit`; this only stops offering a button that would
  // come back 403.
  const canEdit = auth.canEdit !== false;

  const versions = useMemo(
    () => [...files.versions].sort((a, b) => timestampOf(b) - timestampOf(a)),
    [files.versions],
  );

  const restore = useCallback(
    async (snapshot: Snapshot) => {
      if (pending) return;
      const confirmed = typeof window === 'undefined' ? true : window.confirm(t('versions.restoreConfirm'));
      if (!confirmed) return;
      setPending(snapshot.id);
      try {
        await files.restore(snapshot.id);
        onRestore?.(snapshot.id);
      } finally {
        setPending(null);
      }
    },
    [files, onRestore, pending, t],
  );

  // A store with no snapshot surface answers 404 and the timeline simply is not part
  // of that deployment's UI.
  if (!files.supportsVersions) return <></>;

  return (
    <div className="harness-root harness-versions">
      <div className="harness-panel-head">
        <span className="harness-panel-title">{t('versions.title')}</span>
      </div>

      {canEdit && files.undo && (
        <div className="harness-undo-bar">
          <span>{t('versions.restored')}</span>
          <button type="button" className="harness-btn harness-btn-soft" onClick={() => void files.undoRestore()}>
            {t('versions.undo')}
          </button>
          <button type="button" className="harness-link" onClick={files.dismissUndo}>
            {t('preview.dismiss')}
          </button>
        </div>
      )}

      {versions.length === 0 ? (
        <div className="harness-muted harness-panel-empty">{t('versions.empty')}</div>
      ) : (
        <ol className="harness-version-list">
          {versions.map((snapshot, index) => {
            const at = timestampOf(snapshot);
            return (
              <li key={snapshot.id} className="harness-version">
                <div className="harness-version-meta">
                  <span className="harness-version-label">
                    {snapshot.kind === 'undo' ? t('versions.undoKind') : t('versions.turn', { turn: versions.length - index })}
                  </span>
                  <span className="harness-muted" title={at ? new Date(at).toLocaleString() : undefined}>
                    {relativeTime(at)}
                  </span>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    className="harness-btn harness-btn-soft"
                    disabled={pending !== null}
                    onClick={() => void restore(snapshot)}
                  >
                    {pending === snapshot.id ? <SpinnerIcon size={12} /> : <RestoreIcon size={12} />}
                    {pending === snapshot.id ? t('versions.restoring') : t('versions.restore')}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
