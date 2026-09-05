/**
 * The pieces that show what changed: a diff renderer, a full-size file viewer, and
 * the per-version change list. All read-only, all built on {@link useHarnessFiles}.
 *
 * They open as an overlay over the workspace rather than inside the rail. The rail
 * is a narrow column meant for a tree and a timeline; a file, or a diff, needs the
 * width of the screen to be readable, and squeezing it into 260px made "click a
 * file" show a scroll box nobody could use.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { FileMap, Snapshot } from '../protocol';

import { useHarness } from './context';
import { diffHunks, diffStats, lineDiff } from './diff';
import type { DiffLine } from './diff';
import { CloseIcon, SpinnerIcon } from './icons';
import type { HarnessFiles } from './useHarnessFiles';
import type { Translate } from './strings';

/* ------------------------------------------------------------------------- *
 * Overlay
 * ------------------------------------------------------------------------- */

/** A full-size overlay over the workspace, closed by its button or Escape. */
export function HarnessOverlay({
  title,
  subtitle,
  onClose,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const { t } = useHarness();
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="harness-root harness-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="harness-overlay-card" onClick={(event) => event.stopPropagation()}>
        <div className="harness-overlay-head">
          <div className="harness-overlay-title">
            <span className="harness-mono harness-overlay-path">{title}</span>
            {subtitle ? <span className="harness-muted">{subtitle}</span> : null}
          </div>
          {actions}
          <button type="button" className="harness-icon-btn" aria-label={t('files.close')} onClick={onClose}>
            <CloseIcon size={14} />
          </button>
        </div>
        <div className="harness-overlay-body">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Diff rendering
 * ------------------------------------------------------------------------- */

/** A unified diff of `before` -> `after`, with line numbers on both sides. */
export function DiffView({ before, after, t }: { before: string; after: string; t: Translate }): ReactElement {
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  const hunks = useMemo(() => diffHunks(lines), [lines]);
  const stats = useMemo(() => diffStats(lines), [lines]);

  if (!hunks.length) {
    return <div className="harness-muted harness-panel-empty">{t('files.noChanges')}</div>;
  }
  return (
    <div className="harness-diff">
      <div className="harness-diff-stats">
        <span className="harness-diff-added">+{stats.added}</span>
        <span className="harness-diff-removed">-{stats.removed}</span>
      </div>
      {hunks.map((hunk, index) => (
        <div key={index} className="harness-diff-hunk">
          <div className="harness-diff-hunk-head">
            @@ -{hunk.oldStart} +{hunk.newStart} @@
          </div>
          {hunk.lines.map((line, i) => (
            <DiffRow key={i} line={line} />
          ))}
        </div>
      ))}
    </div>
  );
}

function DiffRow({ line }: { line: DiffLine }): ReactElement {
  const cls =
    line.kind === 'add' ? 'harness-diff-line harness-diff-line-add'
      : line.kind === 'del' ? 'harness-diff-line harness-diff-line-del'
        : 'harness-diff-line';
  return (
    <div className={cls}>
      <span className="harness-diff-no">{line.oldNo ?? ''}</span>
      <span className="harness-diff-no">{line.newNo ?? ''}</span>
      <span className="harness-diff-sign">{line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}</span>
      <span className="harness-diff-text">{line.text}</span>
    </div>
  );
}

/** Source with line numbers, for the file viewer. */
export function SourceView({ source }: { source: string }): ReactElement {
  const lines = useMemo(() => {
    const parts = source.split('\n');
    if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
    return parts;
  }, [source]);
  return (
    <div className="harness-source">
      {lines.map((text, index) => (
        <div key={index} className="harness-source-line">
          <span className="harness-diff-no">{index + 1}</span>
          <span className="harness-diff-text">{text}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * File viewer
 * ------------------------------------------------------------------------- */

function timestampOf(snapshot: Snapshot): number {
  const value = snapshot.createdAt as unknown;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(String(value ?? ''));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Versions newest first, labelled the way the timeline labels them. */
export function orderedVersions(versions: Snapshot[]): Snapshot[] {
  return [...versions].sort((a, b) => timestampOf(b) - timestampOf(a));
}

export function versionLabel(versions: Snapshot[], snapshot: Snapshot, t: Translate): string {
  const index = versions.indexOf(snapshot);
  const turn = versions.length - index;
  const base = snapshot.kind === 'undo' ? t('versions.undoKind') : t('versions.turn', { turn });
  const at = timestampOf(snapshot);
  return at ? `${base} · ${new Date(at).toLocaleString()}` : base;
}

/**
 * One file, full size: its source, and what changed in it since a chosen version
 * (the newest by default - "what did the last turn do to this file?").
 */
export function FileViewer({
  path,
  files,
  onClose,
}: {
  path: string;
  files: HarnessFiles;
  onClose: () => void;
}): ReactElement {
  const { t } = useHarness();
  const versions = useMemo(() => orderedVersions(files.versions), [files.versions]);
  const [tab, setTab] = useState<'source' | 'changes'>('source');
  const [source, setSource] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string>(() => versions[0]?.id ?? '');
  const [before, setBefore] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    void files.read(path).then((text) => {
      if (!cancelled) setSource(text);
    });
    return () => {
      cancelled = true;
    };
  }, [files, path]);

  useEffect(() => {
    if (!versionId && versions[0]) setVersionId(versions[0].id);
  }, [versionId, versions]);

  useEffect(() => {
    if (tab !== 'changes' || !versionId) return;
    let cancelled = false;
    setBefore(null);
    void files
      .snapshot(versionId)
      .then((detail) => {
        if (!cancelled) setBefore(detail?.files?.[path] ?? '');
      })
      .catch(() => {
        if (!cancelled) setBefore('');
      });
    return () => {
      cancelled = true;
    };
  }, [files, path, tab, versionId]);

  const bytes = source?.length ?? 0;
  const lineCount = source ? source.split('\n').length : 0;

  return (
    <HarnessOverlay
      title={path}
      subtitle={source === null ? '' : t('files.sizeLine', { bytes, lines: lineCount })}
      onClose={onClose}
      actions={
        <div className="harness-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'source'}
            className={tab === 'source' ? 'harness-tab harness-tab-on' : 'harness-tab'}
            onClick={() => setTab('source')}
          >
            {t('files.tabSource')}
          </button>
          {files.supportsVersions && versions.length > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'changes'}
              className={tab === 'changes' ? 'harness-tab harness-tab-on' : 'harness-tab'}
              onClick={() => setTab('changes')}
            >
              {t('files.tabChanges')}
            </button>
          )}
        </div>
      }
    >
      {tab === 'source' ? (
        source === null ? (
          <div className="harness-muted harness-panel-empty">
            <SpinnerIcon size={12} /> {t('chat.loadingHistory')}
          </div>
        ) : (
          <SourceView source={source} />
        )
      ) : (
        <>
          <div className="harness-compare-bar">
            <label className="harness-muted" htmlFor="harness-compare-version">
              {t('files.compareWith')}
            </label>
            <select
              id="harness-compare-version"
              className="harness-select"
              value={versionId}
              onChange={(event) => setVersionId(event.target.value)}
            >
              {versions.map((snapshot) => (
                <option key={snapshot.id} value={snapshot.id}>
                  {versionLabel(versions, snapshot, t)}
                </option>
              ))}
            </select>
          </div>
          {before === null || source === null ? (
            <div className="harness-muted harness-panel-empty">
              <SpinnerIcon size={12} /> {t('chat.loadingHistory')}
            </div>
          ) : (
            <DiffView before={before} after={source} t={t} />
          )}
        </>
      )}
    </HarnessOverlay>
  );
}

/* ------------------------------------------------------------------------- *
 * Version changes
 * ------------------------------------------------------------------------- */

export interface FileChange {
  path: string;
  status: 'added' | 'removed' | 'modified';
  before: string;
  after: string;
}

/** Every file that differs between a snapshot's files and the current ones. */
export function changesBetween(before: FileMap, after: FileMap): FileChange[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: FileChange[] = [];
  for (const path of [...paths].sort()) {
    const a = before[path];
    const b = after[path];
    if (a === b) continue;
    if (a === undefined) out.push({ path, status: 'added', before: '', after: b ?? '' });
    else if (b === undefined) out.push({ path, status: 'removed', before: a, after: '' });
    else out.push({ path, status: 'modified', before: a, after: b });
  }
  return out;
}

/**
 * What separates a version from the app as it is now - the answer to "if I restore
 * this, what goes back?", and after a restore, "what did that undo?".
 */
export function VersionChanges({
  snapshot,
  files,
  onClose,
}: {
  snapshot: Snapshot;
  files: HarnessFiles;
  onClose: () => void;
}): ReactElement {
  const { t } = useHarness();
  const versions = useMemo(() => orderedVersions(files.versions), [files.versions]);
  const [changes, setChanges] = useState<FileChange[] | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setChanges(null);
    void files
      .snapshot(snapshot.id)
      .then((detail) => {
        if (cancelled) return;
        const list = changesBetween(detail?.files ?? {}, files.files);
        setChanges(list);
        // A single changed file opens by itself; a long list starts folded.
        setOpen(list.length === 1 ? { [list[0].path]: true } : {});
      })
      .catch(() => {
        if (!cancelled) setChanges([]);
      });
  }, [files, snapshot.id]);

  const statusLabel = (status: FileChange['status']): string =>
    status === 'added' ? t('files.added') : status === 'removed' ? t('files.removed') : t('files.modified');

  return (
    <HarnessOverlay
      title={versionLabel(versions, snapshot, t)}
      subtitle={t('versions.comparedToNow')}
      onClose={onClose}
    >
      {changes === null ? (
        <div className="harness-muted harness-panel-empty">
          <SpinnerIcon size={12} /> {t('chat.loadingHistory')}
        </div>
      ) : changes.length === 0 ? (
        <div className="harness-muted harness-panel-empty">{t('versions.noChanges')}</div>
      ) : (
        <div className="harness-change-list">
          {changes.map((change) => {
            const isOpen = !!open[change.path];
            const stats = diffStats(lineDiff(change.before, change.after));
            return (
              <div key={change.path} className="harness-change">
                <button
                  type="button"
                  className="harness-change-head"
                  aria-expanded={isOpen}
                  onClick={() => setOpen((current) => ({ ...current, [change.path]: !isOpen }))}
                >
                  <span className={`harness-change-status harness-change-status-${change.status}`}>
                    {statusLabel(change.status)}
                  </span>
                  <span className="harness-mono harness-change-path">{change.path}</span>
                  <span className="harness-diff-stats">
                    <span className="harness-diff-added">+{stats.added}</span>
                    <span className="harness-diff-removed">-{stats.removed}</span>
                  </span>
                </button>
                {isOpen && <DiffView before={change.before} after={change.after} t={t} />}
              </div>
            );
          })}
        </div>
      )}
    </HarnessOverlay>
  );
}
