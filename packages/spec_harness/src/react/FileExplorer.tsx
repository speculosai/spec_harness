/**
 * The read-only file tree.
 *
 * This is the trust view - "what did the agent actually change in my app?" - and it
 * is deliberately not an editor. Every file the agent touched carries a marker for the
 * turn that touched it, so the answer is one glance rather than a diff tool.
 */

import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';

import { useHarness } from './context';
import { ChevronIcon, CloseIcon, FileIcon, FolderIcon } from './icons';
import { useHarnessFiles } from './useHarnessFiles';
import type { FileTreeNode } from './useHarnessFiles';
import type { Translate } from './strings';

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
 */
export function FileExplorer(props: FileExplorerProps): ReactElement {
  const { projectId, onSelect } = props;
  const { t } = useHarness();
  const files = useHarnessFiles({ projectId });

  // Directories start expanded: a generated app is a handful of files, and hiding
  // them behind a click would only make the tree feel bigger than it is.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [source, setSource] = useState('');

  const select = useCallback(
    (path: string) => {
      setSelected(path);
      setSource('');
      onSelect?.(path);
      void files.read(path).then(setSource);
    },
    [files, onSelect],
  );

  const toggle = useCallback((path: string) => {
    setCollapsed((current) => ({ ...current, [path]: !current[path] }));
  }, []);

  const renderNodes = (nodes: FileTreeNode[], depth: number): ReactElement[] =>
    nodes.flatMap((node) => {
      const indent = { paddingLeft: `calc(${depth} * var(--harness-space-3) + var(--harness-space-2))` };
      if (node.isDir) {
        const isOpen = !collapsed[node.path];
        return [
          <button
            key={node.path}
            type="button"
            className="harness-tree-row"
            style={indent}
            onClick={() => toggle(node.path)}
          >
            <ChevronIcon size={12} className={isOpen ? 'harness-chevron harness-chevron-open' : 'harness-chevron'} />
            <FolderIcon size={13} />
            <span className="harness-tree-name">{node.name}</span>
          </button>,
          ...(isOpen ? renderNodes(node.children ?? [], depth + 1) : []),
        ];
      }
      const turn = files.changed[node.path];
      return [
        <button
          key={node.path}
          type="button"
          className={selected === node.path ? 'harness-tree-row harness-tree-row-on' : 'harness-tree-row'}
          style={indent}
          onClick={() => select(node.path)}
        >
          <span className="harness-chevron-spacer" />
          <FileIcon size={13} />
          <span className="harness-tree-name">{node.name}</span>
          {turn ? <ChangeMarker turn={turn} latest={files.turns} t={t} /> : null}
        </button>,
      ];
    });

  return (
    <div className="harness-root harness-files">
      <div className="harness-panel-head">
        <span className="harness-panel-title">{t('files.title')}</span>
      </div>

      <div className="harness-tree">
        {files.loading && files.tree.length === 0 ? (
          <div className="harness-muted harness-panel-empty">{t('chat.loadingHistory')}</div>
        ) : files.tree.length === 0 ? (
          <div className="harness-muted harness-panel-empty">{t('files.empty')}</div>
        ) : (
          renderNodes(files.tree, 0)
        )}
      </div>

      {selected && (
        <div className="harness-file-view">
          <div className="harness-file-view-head">
            <span className="harness-mono harness-file-view-path">{selected}</span>
            <span className="harness-muted">{t('files.bytes', { bytes: source.length })}</span>
            <button
              type="button"
              className="harness-icon-btn"
              aria-label={t('files.close')}
              onClick={() => setSelected(null)}
            >
              <CloseIcon size={12} />
            </button>
          </div>
          <pre className="harness-code-block harness-file-source">
            <code>{source}</code>
          </pre>
        </div>
      )}

      <p className="harness-panel-note">{t('files.note')}</p>
    </div>
  );
}

function ChangeMarker({ turn, latest, t }: { turn: number; latest: number; t: Translate }): ReactElement {
  const isLatest = turn === latest;
  const label = isLatest ? t('files.changedLastTurn') : t('files.changedTurn', { turn });
  return (
    <span
      className={isLatest ? 'harness-change-dot harness-change-dot-latest' : 'harness-change-dot'}
      title={label}
      aria-label={label}
    />
  );
}
