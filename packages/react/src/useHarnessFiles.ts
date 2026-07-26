/**
 * The read-only file view and the version history, as a hook.
 *
 * Nothing here is an editor. It answers the two questions a person actually asks
 * about an agent that writes code on their behalf - "what did it change?" and "can I
 * go back?" - from data that already flows through the store.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, FileMap, Project, RollbackResult, Snapshot } from '@speculos-harness/protocol';

import { HarnessHttpError, useHarness, useRebuildKey } from './context';
import { changesByTurn } from './items';

/** A node in the read-only file tree. */
export interface FileTreeNode {
  /** Full in-project path. */
  path: string;
  /** Leaf name. */
  name: string;
  /** Whether this node is a directory. */
  isDir: boolean;
  /** Child nodes, for directories. */
  children?: FileTreeNode[];
}

/** Options for {@link useHarnessFiles}. */
export interface UseHarnessFilesOptions {
  /** The project whose files and versions to read. */
  projectId: string;
}

/** Return value of {@link useHarnessFiles}. */
export interface HarnessFiles {
  /** The current file tree. */
  tree: FileTreeNode[];
  /** Read a file's source by path. */
  read: (path: string) => Promise<string>;
  /** The set of paths changed on a given turn. */
  diff: (turn: number) => Promise<FileMap>;
  /** The version history (pre-turn snapshots). */
  versions: Snapshot[];
  /** Restore a version; the restore is itself captured as an undo point. */
  restore: (snapshotId: string) => Promise<void>;
  /** The current file map. */
  files: FileMap;
  /** Whether the first read is still in flight. */
  loading: boolean;
  /** Re-read files and versions now. */
  refresh: () => void;
  /** Path to the most recent turn that touched it - the explorer's change markers. */
  changed: Record<string, number>;
  /** How many turns this conversation has had. */
  turns: number;
  /** Whether the server keeps snapshots at all; false hides the timeline. */
  supportsVersions: boolean;
  /** The undo point captured by the last restore, until it is used or dismissed. */
  undo: { snapshotId: string } | null;
  /** Roll the last restore back. */
  undoRestore: () => Promise<void>;
  /** Forget the undo point. */
  dismissUndo: () => void;
}

/** Build the nested tree a file map implies. Directories sort first, then by name. */
export function buildTree(files: FileMap): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const dirs = new Map<string, FileTreeNode>();

  const ensureDir = (path: string): FileTreeNode[] => {
    if (!path) return root;
    const existing = dirs.get(path);
    if (existing) return existing.children!;
    const slash = path.lastIndexOf('/');
    const parent = ensureDir(slash === -1 ? '' : path.slice(0, slash));
    const node: FileTreeNode = {
      path,
      name: slash === -1 ? path : path.slice(slash + 1),
      isDir: true,
      children: [],
    };
    dirs.set(path, node);
    parent.push(node);
    return node.children!;
  };

  for (const full of Object.keys(files).sort()) {
    const clean = full.replace(/^\/+/, '');
    if (!clean) continue;
    const slash = clean.lastIndexOf('/');
    const siblings = ensureDir(slash === -1 ? '' : clean.slice(0, slash));
    siblings.push({
      path: full,
      name: slash === -1 ? clean : clean.slice(slash + 1),
      isDir: false,
    });
  }

  const sort = (nodes: FileTreeNode[]): FileTreeNode[] => {
    nodes.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    for (const node of nodes) if (node.children) sort(node.children);
    return nodes;
  };

  return sort(root);
}

/**
 * The read-only file explorer + version history as a hook: the tree, per-turn diffs,
 * the snapshot timeline, and restore - all read-only, backed by data that already flows
 * through the store.
 */
export function useHarnessFiles(opts: UseHarnessFilesOptions): HarnessFiles {
  const { projectId } = opts;
  const { requestJson, capabilities, bus } = useHarness();
  const rebuildKey = useRebuildKey(projectId);

  const [files, setFiles] = useState<FileMap>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [versions, setVersions] = useState<Snapshot[]>([]);
  const [supportsVersions, setSupportsVersions] = useState(capabilities.snapshots !== false);
  const [loading, setLoading] = useState(true);
  const [undo, setUndo] = useState<{ snapshotId: string } | null>(null);
  const [nonce, setNonce] = useState(0);

  const filesRef = useRef<FileMap>({});
  const messagesRef = useRef<ChatMessage[]>([]);
  const loadedOnce = useRef(false);

  const loadProject = useCallback(async (): Promise<Project | null> => {
    try {
      const project = await requestJson<Project>(`/projects/${encodeURIComponent(projectId)}`);
      filesRef.current = project.files ?? {};
      messagesRef.current = (project.messages ?? []) as ChatMessage[];
      return project;
    } catch {
      return null;
    }
  }, [projectId, requestJson]);

  const loadVersions = useCallback(async (): Promise<void> => {
    // The server already told us it keeps none; do not ask it to 404 for us.
    if (capabilities.snapshots === false) {
      setSupportsVersions(false);
      setVersions([]);
      return;
    }
    try {
      const list = await requestJson<Snapshot[]>(`/projects/${encodeURIComponent(projectId)}/snapshots`);
      setVersions(Array.isArray(list) ? list : []);
      setSupportsVersions(true);
    } catch (err) {
      // A store without a snapshot surface answers 404. That is a capability, not a
      // fault: the timeline hides itself rather than showing an error.
      if (err instanceof HarnessHttpError && err.status === 404) {
        setSupportsVersions(false);
        setVersions([]);
        return;
      }
      setVersions([]);
    }
  }, [capabilities.snapshots, projectId, requestJson]);

  useEffect(() => {
    let cancelled = false;
    // A turn writes several files in a row and bumps the key each time. The first
    // read is immediate; later ones coalesce so a busy turn is one refresh, not six.
    const delay = loadedOnce.current ? 300 : 0;
    const timer = setTimeout(() => {
      void (async () => {
        const project = await loadProject();
        if (cancelled) return;
        if (project) {
          setFiles(project.files ?? {});
          setMessages((project.messages ?? []) as ChatMessage[]);
        }
        loadedOnce.current = true;
        setLoading(false);
        await loadVersions();
      })();
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, rebuildKey, nonce, loadProject, loadVersions]);

  const tree = useMemo(() => buildTree(files), [files]);

  const { changed, turns } = useMemo(() => {
    const byTurn = changesByTurn(messages);
    const map: Record<string, number> = {};
    let highest = 0;
    for (const [turn, entries] of byTurn) {
      highest = Math.max(highest, turn);
      for (const entry of entries) map[entry.path] = Math.max(map[entry.path] ?? 0, turn);
    }
    return { changed: map, turns: highest };
  }, [messages]);

  const read = useCallback(
    async (path: string): Promise<string> => {
      const local = filesRef.current[path];
      if (typeof local === 'string') return local;
      await loadProject();
      return filesRef.current[path] ?? '';
    },
    [loadProject],
  );

  const diff = useCallback(
    async (turn: number): Promise<FileMap> => {
      if (!messagesRef.current.length) await loadProject();
      const entries = changesByTurn(messagesRef.current).get(turn) ?? [];
      const out: FileMap = {};
      for (const entry of entries) {
        if (entry.kind === 'delete') {
          out[entry.path] = '';
          continue;
        }
        // `write_file` carries the whole file it wrote, which is the content as of
        // that turn. An edit only carries its substrings, so the current file is the
        // honest answer for it.
        out[entry.path] = entry.content ?? filesRef.current[entry.path] ?? '';
      }
      return out;
    },
    [loadProject],
  );

  const rollback = useCallback(
    async (snapshotId: string): Promise<RollbackResult> => {
      const result = await requestJson<RollbackResult>(`/projects/${encodeURIComponent(projectId)}/rollback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ snapshotId }),
      });
      // Files and the conversation both moved: rebuild the preview and let the chat
      // re-read its history.
      bus.bumpRebuild(projectId);
      bus.bumpHistory(projectId);
      setNonce((n) => n + 1);
      return result;
    },
    [bus, projectId, requestJson],
  );

  const restore = useCallback(
    async (snapshotId: string): Promise<void> => {
      const result = await rollback(snapshotId);
      // The restore is itself a version, so it can be undone.
      if (result?.undoSnapshotId) setUndo({ snapshotId: result.undoSnapshotId });
    },
    [rollback],
  );

  const undoRestore = useCallback(async (): Promise<void> => {
    if (!undo) return;
    const target = undo.snapshotId;
    setUndo(null);
    await rollback(target);
  }, [rollback, undo]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const dismissUndo = useCallback(() => setUndo(null), []);

  return useMemo(
    () => ({
      tree,
      read,
      diff,
      versions,
      restore,
      files,
      loading,
      refresh,
      changed,
      turns,
      supportsVersions,
      undo,
      undoRestore,
      dismissUndo,
    }),
    [
      tree,
      read,
      diff,
      versions,
      restore,
      files,
      loading,
      refresh,
      changed,
      turns,
      supportsVersions,
      undo,
      undoRestore,
      dismissUndo,
    ],
  );
}
