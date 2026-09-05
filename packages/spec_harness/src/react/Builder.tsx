/**
 * The whole workspace, assembled.
 *
 * `<Builder>` is only composition: the panes own their own protocol work, and the
 * state they share - the rebuild key, whether a turn is streaming, and the repair
 * channel - lives on the provider's bus rather than in props. That is what lets the
 * same two components be pulled apart into a host's own drawer and modal and keep
 * behaving identically, and it is why the crash-to-fix loop cannot be lost by
 * rearranging the layout: the preview reports a failure at most once per rebuild key,
 * and whatever chat is mounted for that project takes it.
 */

import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react';
import { PROTOCOL_VERSION } from '../protocol';

import { ChatPane } from './ChatPane';
import { FileExplorer } from './FileExplorer';
import { PreviewPane } from './PreviewPane';
import { VersionTimeline } from './VersionTimeline';
import { useHarness } from './context';
import { HarnessMark, PanelIcon } from './icons';

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
  /** Rendered at the top of the chat log - starter suggestions, a welcome. */
  chatHeader?: ReactNode;
  /** Rendered inside the composer above the text box - the data sources for the next turn, say. */
  composerHeader?: ReactNode;
}

const MIN_FRACTION = 0.2;
const MAX_FRACTION = 0.8;

function splitStorageKey(projectId: string): string {
  return `speculos-harness.split.${projectId}`;
}

function readFraction(projectId: string): number {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(splitStorageKey(projectId));
    const value = raw ? Number.parseFloat(raw) : NaN;
    if (Number.isFinite(value) && value >= MIN_FRACTION && value <= MAX_FRACTION) return value;
  } catch {
    /* storage may be blocked; the default split is fine */
  }
  return 0.5;
}

/**
 * The whole workspace: a resizable two-pane split of {@link ChatPane} and
 * {@link PreviewPane}, with an optional {@link FileExplorer} + {@link VersionTimeline}.
 * Owns the shared state contract - the `fileSig` rebuild key and the once-per-signature
 * crash-to-auto-fix guard - so the panes stay in sync.
 */
export function Builder(props: BuilderProps): ReactElement {
  const { projectId, layout = 'preview-left', filePanel = 'explorer', onFirstPrompt, chatHeader, composerHeader } = props;
  const { t, brand, auth, protocolMismatch } = useHarness();
  const canEdit = auth.canEdit !== false;

  // Read once, on mount: a `?prompt=` deep link seeds the composer so the user lands
  // one click away from a build, rather than sending on their behalf.
  const [seed] = useState<string>(() => onFirstPrompt?.() ?? '');
  const [showFiles, setShowFiles] = useState(filePanel === 'explorer');
  const [fraction, setFraction] = useState(() => readFraction(projectId));

  const splitRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  const commitFraction = useCallback(
    (next: number) => {
      const clamped = Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, next));
      setFraction(clamped);
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(splitStorageKey(projectId), clamped.toFixed(3));
        }
      } catch {
        /* storage may be blocked */
      }
    },
    [projectId],
  );

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      const box = splitRef.current?.getBoundingClientRect();
      if (!box || box.width === 0) return;
      commitFraction((event.clientX - box.left) / box.width);
    },
    [commitFraction],
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const previewFirst = layout === 'preview-left';
  const preview = <PreviewPane projectId={projectId} />;
  const chat = <ChatPane projectId={projectId} initialInput={seed} header={chatHeader} composerHeader={composerHeader} />;

  const rail =
    filePanel === 'explorer' && showFiles ? (
      <aside className="harness-rail">
        <FileExplorer projectId={projectId} />
        <VersionTimeline projectId={projectId} />
      </aside>
    ) : null;

  const resizer = (
    <div
      className="harness-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('workspace.dragToResize')}
      title={t('workspace.dragToResize')}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') commitFraction(fraction - 0.02);
        else if (event.key === 'ArrowRight') commitFraction(fraction + 0.02);
      }}
    />
  );

  return (
    <div className="harness-root harness-builder">
      <header className="harness-topbar">
        <span className="harness-brand">
          {brand?.Logo ?? <HarnessMark size={18} />}
          <span className="harness-brand-name">{brand?.name ?? t('workspace.title')}</span>
        </span>
        {filePanel === 'explorer' && (
          <button
            type="button"
            className={showFiles ? 'harness-icon-btn harness-icon-btn-on' : 'harness-icon-btn'}
            title={showFiles ? t('workspace.hideFiles') : t('workspace.showFiles')}
            aria-label={showFiles ? t('workspace.hideFiles') : t('workspace.showFiles')}
            aria-pressed={showFiles}
            onClick={() => setShowFiles((value) => !value)}
          >
            <PanelIcon size={15} />
          </button>
        )}
      </header>

      {protocolMismatch !== null && (
        <div className="harness-banner">
          {t('workspace.protocolMismatch', { client: PROTOCOL_VERSION, server: protocolMismatch })}
        </div>
      )}

      <div className="harness-panes">
        {/* The rail sits on the outer edge next to the chat, whichever side that is. */}
        {!previewFirst && rail}
        {canEdit ? (
          <div className="harness-split" ref={splitRef}>
            <div className="harness-pane" style={{ flex: `0 0 ${(fraction * 100).toFixed(2)}%` }}>
              {previewFirst ? preview : chat}
            </div>
            {resizer}
            <div className="harness-pane" style={{ flex: '1 1 0' }}>
              {previewFirst ? chat : preview}
            </div>
          </div>
        ) : (
          // A read-only viewer gets the running app, full width, and no composer.
          <div className="harness-split" ref={splitRef}>
            <div className="harness-pane" style={{ flex: '1 1 0' }}>
              {preview}
            </div>
          </div>
        )}
        {previewFirst && rail}
      </div>
    </div>
  );
}
