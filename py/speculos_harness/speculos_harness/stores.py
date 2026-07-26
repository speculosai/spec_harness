"""Reference ``ProjectStore`` implementations.

Two batteries-included stores so the core boots with zero external
dependencies:

* :class:`SQLiteProjectStore` - a single-file SQLite database. The default for
  a self-hosted single-tenant deployment.
* :class:`FsProjectStore` - plain files/JSON on disk, one directory per
  project. Handy for inspecting state by hand and for tests.

Both implement the full :class:`~speculos_harness.interfaces.ProjectStore`
surface **including** the optional snapshot methods, so the version timeline
and rollback work whichever you pick. Semantics are ported verbatim from
production: ``put_files`` is a full-replace transactional write, and pre-turn
snapshots are pruned to the most recent ~30.

Both are configuration-free beyond a path::

    SQLiteProjectStore("./harness.db")
    FsProjectStore("./harness-projects")

Beyond the protocol both stores also expose ``list_projects(created_by=None)``
and ``delete_project(id)``, which the mounted router uses for ``GET /projects``.
They are additive: a custom store that omits them still satisfies
``ProjectStore``, and the router degrades to not listing.

Concurrency: both stores are safe for the single-process default the kit ships
with. SQLite runs in WAL mode behind one serialized connection, so a second
process reading the same file sees consistent snapshots; the filesystem store
serializes its own writes with an in-process lock and is single-process only.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Optional, Sequence

from .interfaces import (
    ChatMessage,
    FileMap,
    NewProject,
    Project,
    ProjectStore,
    Snapshot,
    SnapshotDetail,
)

#: Pre-turn snapshots are pruned to this many most-recent entries per project.
SNAPSHOT_KEEP = 30

#: The snapshot kinds the agent takes. ``pre-turn`` is captured before a turn
#: starts writing; ``undo`` is captured by a rollback, so a rollback is itself
#: undoable.
_SNAPSHOT_KINDS = ("pre-turn", "undo")


def _now() -> str:
    """An ISO-8601 UTC timestamp. Sorts lexicographically, so it doubles as the
    snapshot ordering key."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def _as_str_map(value: Any) -> dict[str, str]:
    if not isinstance(value, Mapping):
        return {}
    return {str(k): str(v) for k, v in value.items()}


def _as_message_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, (list, tuple)):
        return []
    return [dict(m) for m in value if isinstance(m, Mapping)]


class _BaseProjectStore(ProjectStore):
    """Shared method surface for the reference stores.

    Concrete stores differ only in where bytes land; the contract is identical,
    so the signatures live here once and each subclass wires its own backend.
    """

    async def get_project(self, id: str) -> Optional[Project]:
        raise NotImplementedError

    async def create_project(self, input: NewProject) -> Project:
        raise NotImplementedError

    async def patch_project(self, id: str, patch: Mapping[str, Any]) -> None:
        raise NotImplementedError

    async def get_files(self, id: str) -> FileMap:
        raise NotImplementedError

    async def put_files(self, id: str, files: FileMap) -> None:
        """FULL REPLACE, transactional.

        The whole file map is swapped atomically: every prior path is dropped
        and the supplied map becomes the project's complete contents. This is
        not a merge and not a patch. A partial application must never be
        observable by a concurrent reader, because a half-applied file map is a
        corrupted project - which is why the SQLite store does the swap inside
        one ``BEGIN IMMEDIATE`` transaction and the filesystem store builds the
        replacement tree beside the live one and renames it into place.
        """
        raise NotImplementedError

    async def get_messages(self, id: str) -> Sequence[ChatMessage]:
        raise NotImplementedError

    async def save_messages(
        self, id: str, messages: Sequence[ChatMessage]
    ) -> None:
        raise NotImplementedError

    # ---- optional snapshot surface (both reference stores implement it) ----

    async def create_snapshot(self, id: str, s: Mapping[str, Any]) -> Snapshot:
        """Persist a snapshot; prune pre-turn ones to :data:`SNAPSHOT_KEEP`."""
        raise NotImplementedError

    async def list_snapshots(self, id: str) -> Sequence[Snapshot]:
        raise NotImplementedError

    async def get_snapshot(
        self, id: str, snapshot_id: str
    ) -> Optional[SnapshotDetail]:
        raise NotImplementedError

    # ---- shared helpers ----------------------------------------------------

    @staticmethod
    def _normalize_new(input: NewProject) -> dict[str, Any]:
        """Coerce a ``NewProject`` into the stored record's fields."""
        data = dict(input or {})
        created = _now()
        return {
            "id": str(data.get("id") or _new_id("proj")),
            "name": str(data.get("name") or "Untitled project"),
            "template": str(data.get("template") or ""),
            "files": _as_str_map(data.get("files")),
            "dependencies": _as_str_map(data.get("dependencies")),
            "messages": _as_message_list(data.get("messages")),
            "createdBy": data.get("createdBy") or data.get("created_by"),
            "connections": data.get("connections"),
            "meta": dict(data.get("meta") or {}) or None,
            "createdAt": created,
            "updatedAt": created,
        }

    @staticmethod
    def _normalize_snapshot(s: Mapping[str, Any]) -> dict[str, Any]:
        """Coerce the agent's snapshot request into a stored record."""
        kind = str(s.get("kind") or "pre-turn")
        if kind not in _SNAPSHOT_KINDS:
            kind = "pre-turn"
        try:
            message_index = int(s.get("messageIndex", s.get("message_index", 0)))
        except (TypeError, ValueError):
            message_index = 0
        return {
            "id": str(s.get("id") or _new_id("snap")),
            "messageIndex": message_index,
            "kind": kind,
            "createdAt": str(s.get("createdAt") or _now()),
            "files": _as_str_map(s.get("files")),
            "messages": _as_message_list(s.get("messages")),
        }


# ---------------------------------------------------------------------------
# SQLite
# ---------------------------------------------------------------------------

_SCHEMA = """
create table if not exists projects (
    id           text primary key,
    name         text not null,
    template     text not null default '',
    dependencies text not null default '{}',
    created_by   text,
    connections  text,
    meta         text,
    created_at   text not null,
    updated_at   text not null
);

create table if not exists files (
    project_id text not null,
    path       text not null,
    content    text not null,
    primary key (project_id, path)
);

create table if not exists messages (
    project_id text primary key,
    payload    text not null,
    updated_at text not null
);

create table if not exists snapshots (
    id            text primary key,
    project_id    text not null,
    message_index integer not null,
    kind          text not null,
    created_at    text not null,
    files         text not null,
    messages      text
);

create index if not exists idx_files_project on files(project_id);
create index if not exists idx_snapshots_project
    on snapshots(project_id, kind, created_at);
"""


class SQLiteProjectStore(_BaseProjectStore):
    """A ``ProjectStore`` backed by a single SQLite file.

    Args:
        path: Path to the SQLite database file (created if absent).
            ``":memory:"`` gives an ephemeral in-process database, which is
            what the test suite uses.

    One connection is opened eagerly and shared. Every statement runs on a
    worker thread behind a lock, so the store is safe to call from an async
    router without blocking the event loop and without SQLite seeing
    cross-thread interleaving. WAL is enabled so a reader never blocks the
    agent's writes.
    """

    def __init__(self, path: str = "./harness.db") -> None:
        self.path = path
        if path != ":memory:" and not path.startswith("file:"):
            parent = Path(path).expanduser().resolve().parent
            parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(
            path,
            check_same_thread=False,
            # Autocommit: transactions are opened explicitly, so a
            # full-replace is one visible unit and nothing else is implicit.
            isolation_level=None,
        )
        self._db.row_factory = sqlite3.Row
        with self._lock:
            if path != ":memory:":
                self._db.execute("pragma journal_mode=WAL")
            self._db.execute("pragma synchronous=NORMAL")
            self._db.execute("pragma foreign_keys=ON")
            self._db.execute("pragma busy_timeout=5000")
            self._db.executescript(_SCHEMA)

    # -- plumbing ------------------------------------------------------------

    async def _run(self, fn: Any, *args: Any) -> Any:
        def call() -> Any:
            with self._lock:
                return fn(*args)

        return await asyncio.to_thread(call)

    def close(self) -> None:
        """Close the underlying connection. Optional; the process exiting is
        enough for the default deployment."""
        with self._lock:
            self._db.close()

    # -- projects ------------------------------------------------------------

    def _row_to_project(
        self, row: sqlite3.Row, *, with_files: bool, with_messages: bool
    ) -> dict[str, Any]:
        project: dict[str, Any] = {
            "id": row["id"],
            "name": row["name"],
            "template": row["template"],
            "dependencies": json.loads(row["dependencies"] or "{}"),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "messages": [],
        }
        if row["created_by"]:
            project["createdBy"] = row["created_by"]
        if row["connections"]:
            project["connections"] = json.loads(row["connections"])
        if row["meta"]:
            project["meta"] = json.loads(row["meta"])
        if with_files:
            project["files"] = {
                f["path"]: f["content"]
                for f in self._db.execute(
                    "select path, content from files where project_id=? order by path",
                    (row["id"],),
                )
            }
        if with_messages:
            msg_row = self._db.execute(
                "select payload from messages where project_id=?", (row["id"],)
            ).fetchone()
            project["messages"] = json.loads(msg_row["payload"]) if msg_row else []
        return project

    def _get_project(self, id: str) -> Optional[dict[str, Any]]:
        row = self._db.execute(
            "select * from projects where id=?", (id,)
        ).fetchone()
        if row is None:
            return None
        return self._row_to_project(row, with_files=True, with_messages=True)

    async def get_project(self, id: str) -> Optional[Project]:
        return await self._run(self._get_project, id)

    def _list_projects(self, created_by: Optional[str]) -> list[dict[str, Any]]:
        if created_by is None:
            rows = self._db.execute(
                "select * from projects order by updated_at desc"
            ).fetchall()
        else:
            rows = self._db.execute(
                "select * from projects where created_by=? order by updated_at desc",
                (created_by,),
            ).fetchall()
        # Files are omitted from list responses, as the Project schema allows.
        return [
            self._row_to_project(r, with_files=False, with_messages=False)
            for r in rows
        ]

    async def list_projects(
        self, created_by: Optional[str] = None
    ) -> Sequence[Project]:
        """Beyond the protocol: the caller's projects, newest write first.

        ``files`` and ``messages`` are omitted - a list response does not carry
        whole projects.
        """
        return await self._run(self._list_projects, created_by)

    def _create_project(self, record: dict[str, Any]) -> dict[str, Any]:
        self._db.execute("begin immediate")
        try:
            self._db.execute(
                "insert into projects"
                " (id, name, template, dependencies, created_by, connections,"
                "  meta, created_at, updated_at)"
                " values (?,?,?,?,?,?,?,?,?)",
                (
                    record["id"],
                    record["name"],
                    record["template"],
                    json.dumps(record["dependencies"]),
                    record["createdBy"],
                    json.dumps(record["connections"])
                    if record["connections"] is not None
                    else None,
                    json.dumps(record["meta"]) if record["meta"] else None,
                    record["createdAt"],
                    record["updatedAt"],
                ),
            )
            if record["files"]:
                self._db.executemany(
                    "insert into files (project_id, path, content) values (?,?,?)",
                    [
                        (record["id"], p, c)
                        for p, c in record["files"].items()
                    ],
                )
            self._db.execute(
                "insert into messages (project_id, payload, updated_at) values (?,?,?)",
                (
                    record["id"],
                    json.dumps(record["messages"], ensure_ascii=False),
                    record["updatedAt"],
                ),
            )
            self._db.execute("commit")
        except Exception:
            self._db.execute("rollback")
            raise
        return record

    async def create_project(self, input: NewProject) -> Project:
        record = self._normalize_new(input)
        await self._run(self._create_project, record)
        return {k: v for k, v in record.items() if v is not None}

    #: Top-level project fields a patch may touch. Anything else is ignored
    #: rather than written blind, so a stray key cannot corrupt a record.
    _PATCHABLE = {
        "name": "name",
        "template": "template",
        "dependencies": "dependencies",
        "createdBy": "created_by",
        "created_by": "created_by",
        "connections": "connections",
        "meta": "meta",
    }

    def _patch_project(self, id: str, patch: Mapping[str, Any]) -> None:
        sets: list[str] = []
        params: list[Any] = []
        for key, column in self._PATCHABLE.items():
            if key not in patch:
                continue
            value = patch[key]
            if column in ("dependencies", "connections", "meta"):
                value = json.dumps(value) if value is not None else None
            sets.append(f"{column}=?")
            params.append(value)
        sets.append("updated_at=?")
        params.append(_now())
        params.append(id)
        self._db.execute("begin immediate")
        try:
            self._db.execute(
                f"update projects set {', '.join(sets)} where id=?", params
            )
            self._db.execute("commit")
        except Exception:
            self._db.execute("rollback")
            raise

    async def patch_project(self, id: str, patch: Mapping[str, Any]) -> None:
        # `files` and `messages` route to their own transactional writers so a
        # caller cannot half-swap a file map through a metadata patch.
        rest = {k: v for k, v in (patch or {}).items() if k not in ("files", "messages")}
        if rest:
            await self._run(self._patch_project, id, rest)
        if "files" in (patch or {}):
            await self.put_files(id, _as_str_map(patch["files"]))
        if "messages" in (patch or {}):
            await self.save_messages(id, _as_message_list(patch["messages"]))

    def _delete_project(self, id: str) -> None:
        self._db.execute("begin immediate")
        try:
            for table in ("files", "messages", "snapshots"):
                self._db.execute(f"delete from {table} where project_id=?", (id,))
            self._db.execute("delete from projects where id=?", (id,))
            self._db.execute("commit")
        except Exception:
            self._db.execute("rollback")
            raise

    async def delete_project(self, id: str) -> None:
        """Beyond the protocol: drop a project and everything hanging off it."""
        await self._run(self._delete_project, id)

    # -- files ---------------------------------------------------------------

    def _get_files(self, id: str) -> dict[str, str]:
        return {
            row["path"]: row["content"]
            for row in self._db.execute(
                "select path, content from files where project_id=? order by path",
                (id,),
            )
        }

    async def get_files(self, id: str) -> FileMap:
        return await self._run(self._get_files, id)

    def _put_files(self, id: str, files: Mapping[str, str]) -> None:
        # Full replace inside one transaction: readers see the old map or the
        # new map, never a mixture of the two.
        self._db.execute("begin immediate")
        try:
            self._db.execute("delete from files where project_id=?", (id,))
            if files:
                self._db.executemany(
                    "insert into files (project_id, path, content) values (?,?,?)",
                    [(id, str(p), str(c)) for p, c in files.items()],
                )
            self._db.execute(
                "update projects set updated_at=? where id=?", (_now(), id)
            )
            self._db.execute("commit")
        except Exception:
            self._db.execute("rollback")
            raise

    async def put_files(self, id: str, files: FileMap) -> None:
        """FULL REPLACE, transactional - see :meth:`_BaseProjectStore.put_files`."""
        await self._run(self._put_files, id, dict(files))

    # -- messages ------------------------------------------------------------

    def _get_messages(self, id: str) -> list[dict[str, Any]]:
        row = self._db.execute(
            "select payload from messages where project_id=?", (id,)
        ).fetchone()
        return json.loads(row["payload"]) if row else []

    async def get_messages(self, id: str) -> Sequence[ChatMessage]:
        return await self._run(self._get_messages, id)

    def _save_messages(self, id: str, messages: Sequence[Mapping[str, Any]]) -> None:
        payload = json.dumps(list(messages), ensure_ascii=False, default=str)
        self._db.execute(
            "insert into messages (project_id, payload, updated_at) values (?,?,?)"
            " on conflict(project_id) do update set payload=excluded.payload,"
            " updated_at=excluded.updated_at",
            (id, payload, _now()),
        )

    async def save_messages(
        self, id: str, messages: Sequence[ChatMessage]
    ) -> None:
        await self._run(self._save_messages, id, list(messages))

    # -- snapshots -----------------------------------------------------------

    def _create_snapshot(self, id: str, record: dict[str, Any]) -> dict[str, Any]:
        self._db.execute("begin immediate")
        try:
            self._db.execute(
                "insert into snapshots"
                " (id, project_id, message_index, kind, created_at, files, messages)"
                " values (?,?,?,?,?,?,?)",
                (
                    record["id"],
                    id,
                    record["messageIndex"],
                    record["kind"],
                    record["createdAt"],
                    json.dumps(record["files"], ensure_ascii=False),
                    json.dumps(record["messages"], ensure_ascii=False, default=str),
                ),
            )
            if record["kind"] == "pre-turn":
                # Keep the most recent SNAPSHOT_KEEP pre-turn snapshots; that
                # is the depth the version timeline exposes as restorable.
                self._db.execute(
                    "delete from snapshots where id in ("
                    "  select id from snapshots"
                    "   where project_id=? and kind='pre-turn'"
                    "   order by created_at desc, rowid desc"
                    "   limit -1 offset ?"
                    ")",
                    (id, SNAPSHOT_KEEP),
                )
            self._db.execute("commit")
        except Exception:
            self._db.execute("rollback")
            raise
        return {
            "id": record["id"],
            "messageIndex": record["messageIndex"],
            "createdAt": record["createdAt"],
            "kind": record["kind"],
        }

    async def create_snapshot(self, id: str, s: Mapping[str, Any]) -> Snapshot:
        return await self._run(self._create_snapshot, id, self._normalize_snapshot(s))

    def _list_snapshots(self, id: str) -> list[dict[str, Any]]:
        return [
            {
                "id": row["id"],
                "messageIndex": row["message_index"],
                "createdAt": row["created_at"],
                "kind": row["kind"],
            }
            for row in self._db.execute(
                "select id, message_index, created_at, kind from snapshots"
                " where project_id=? and kind='pre-turn'"
                " order by created_at asc, rowid asc",
                (id,),
            )
        ]

    async def list_snapshots(self, id: str) -> Sequence[Snapshot]:
        """Pre-turn snapshots only, oldest first - the same order as the
        message log they index into."""
        return await self._run(self._list_snapshots, id)

    def _get_snapshot(self, id: str, snapshot_id: str) -> Optional[dict[str, Any]]:
        row = self._db.execute(
            "select * from snapshots where project_id=? and id=?", (id, snapshot_id)
        ).fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "messageIndex": row["message_index"],
            "createdAt": row["created_at"],
            "kind": row["kind"],
            "files": json.loads(row["files"] or "{}"),
            "messages": json.loads(row["messages"] or "[]"),
        }

    async def get_snapshot(
        self, id: str, snapshot_id: str
    ) -> Optional[SnapshotDetail]:
        return await self._run(self._get_snapshot, id, snapshot_id)


# ---------------------------------------------------------------------------
# Filesystem
# ---------------------------------------------------------------------------


class FsProjectStore(_BaseProjectStore):
    """A ``ProjectStore`` backed by a directory tree on disk.

    Args:
        root: Directory under which each project gets its own folder
            (files on disk, metadata/messages/snapshots as JSON).

    The layout is deliberately readable, so a developer can open a project in
    an editor and see exactly what the agent built::

        <root>/<project-id>/
            project.json          metadata: name, template, dependencies, ...
            messages.json         the persisted conversation
            files/                the project's files, mirroring their paths
            files/.index.json     the file map's key order (an implementation
                                  detail; the tree is the content)
            snapshots/<id>.json   one snapshot per file, files inlined

    ``put_files`` builds the replacement tree beside the live one and renames
    it into place, so a crash leaves either the old tree or the new one. Writes
    are serialized per project with an in-process lock; this store is intended
    for a single process (development, tests, a single-tenant deploy). Reach
    for :class:`SQLiteProjectStore` when more than one process shares state.
    """

    def __init__(self, root: str = "./harness-projects") -> None:
        self.root = str(root)
        self._root = Path(self.root).expanduser()
        self._root.mkdir(parents=True, exist_ok=True)
        self._locks: dict[str, asyncio.Lock] = {}
        self._locks_guard = threading.Lock()

    # -- plumbing ------------------------------------------------------------

    def _lock_for(self, id: str) -> asyncio.Lock:
        with self._locks_guard:
            lock = self._locks.get(id)
            if lock is None:
                lock = asyncio.Lock()
                self._locks[id] = lock
            return lock

    def _dir(self, id: str) -> Path:
        # Project ids are server-generated, but a hostile id must never be able
        # to walk out of the root.
        safe = "".join(c for c in str(id) if c.isalnum() or c in "-_.")
        if not safe or safe in (".", ".."):
            raise ValueError(f"invalid project id: {id!r}")
        return self._root / safe

    @staticmethod
    def _read_json(path: Path, default: Any) -> Any:
        try:
            with path.open("r", encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, json.JSONDecodeError):
            return default

    @staticmethod
    def _write_json(path: Path, value: Any) -> None:
        """Write JSON atomically: a reader sees the old file or the new one."""
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.tmp")
        with tmp.open("w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, default=str)
            handle.write("\n")
        os.replace(tmp, path)

    # -- file tree -----------------------------------------------------------

    @staticmethod
    def _rel(path: str) -> Optional[str]:
        """Map a project path (``/App.tsx``) to a tree-relative path.

        Returns ``None`` for anything that would escape the project directory;
        such a key is kept in the index but not mirrored to disk.
        """
        parts = [p for p in str(path).replace("\\", "/").split("/") if p not in ("", ".")]
        if not parts or any(p == ".." for p in parts):
            return None
        return "/".join(parts)

    def _recover(self, directory: Path) -> None:
        """Finish an interrupted :meth:`put_files` swap.

        The swap is: build ``.files.new``, move ``files`` aside to
        ``.files.old``, rename ``.files.new`` into place, drop ``.files.old``.
        A crash between the first two steps leaves no ``files`` directory, so
        put the old one back.
        """
        live = directory / "files"
        old = directory / ".files.old"
        if not live.exists() and old.exists():
            os.rename(old, live)

    def _read_files(self, id: str) -> dict[str, str]:
        directory = self._dir(id)
        self._recover(directory)
        live = directory / "files"
        if not live.is_dir():
            return {}
        index = self._read_json(live / ".index.json", None)
        keys: list[str]
        if isinstance(index, Mapping) and isinstance(index.get("paths"), list):
            keys = [str(p) for p in index["paths"]]
        else:
            # No index (or a hand-edited tree): walk it and rebuild the keys.
            keys = sorted(
                "/" + str(p.relative_to(live)).replace(os.sep, "/")
                for p in live.rglob("*")
                if p.is_file() and not p.name.startswith(".index.json")
            )
        files: dict[str, str] = {}
        for key in keys:
            rel = self._rel(key)
            if rel is None:
                continue
            target = live / rel
            try:
                files[key] = target.read_text(encoding="utf-8")
            except OSError:
                continue
        return files

    def _write_files(self, id: str, files: Mapping[str, str]) -> None:
        directory = self._dir(id)
        directory.mkdir(parents=True, exist_ok=True)
        self._recover(directory)
        live = directory / "files"
        staging = directory / ".files.new"
        old = directory / ".files.old"
        for stale in (staging, old):
            if stale.exists():
                shutil.rmtree(stale, ignore_errors=True)

        staging.mkdir(parents=True)
        written: list[str] = []
        for key, content in files.items():
            rel = self._rel(key)
            if rel is None:
                continue
            target = staging / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(str(content), encoding="utf-8")
            written.append(str(key))
        self._write_json(staging / ".index.json", {"paths": written})

        # The swap. Two renames, both atomic; the recovery above closes the
        # window between them.
        if live.exists():
            os.rename(live, old)
        os.rename(staging, live)
        if old.exists():
            shutil.rmtree(old, ignore_errors=True)
        self._touch(id)

    def _touch(self, id: str) -> None:
        meta_path = self._dir(id) / "project.json"
        meta = self._read_json(meta_path, None)
        if isinstance(meta, dict):
            meta["updatedAt"] = _now()
            self._write_json(meta_path, meta)

    # -- projects ------------------------------------------------------------

    def _load_meta(self, id: str) -> Optional[dict[str, Any]]:
        meta = self._read_json(self._dir(id) / "project.json", None)
        return meta if isinstance(meta, dict) else None

    async def get_project(self, id: str) -> Optional[Project]:
        async with self._lock_for(id):
            return await asyncio.to_thread(self._get_project, id)

    def _get_project(self, id: str) -> Optional[dict[str, Any]]:
        meta = self._load_meta(id)
        if meta is None:
            return None
        project = dict(meta)
        project["files"] = self._read_files(id)
        project["messages"] = self._read_json(
            self._dir(id) / "messages.json", []
        )
        return project

    async def list_projects(
        self, created_by: Optional[str] = None
    ) -> Sequence[Project]:
        """Beyond the protocol: the caller's projects, newest write first.

        ``files`` and ``messages`` are omitted - a list response does not carry
        whole projects.
        """
        return await asyncio.to_thread(self._list_projects, created_by)

    def _list_projects(self, created_by: Optional[str]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for entry in self._root.iterdir():
            if not entry.is_dir():
                continue
            meta = self._read_json(entry / "project.json", None)
            if not isinstance(meta, dict):
                continue
            if created_by is not None and meta.get("createdBy") != created_by:
                continue
            record = dict(meta)
            record.setdefault("messages", [])
            out.append(record)
        out.sort(key=lambda p: str(p.get("updatedAt") or ""), reverse=True)
        return out

    async def create_project(self, input: NewProject) -> Project:
        record = self._normalize_new(input)
        async with self._lock_for(record["id"]):
            await asyncio.to_thread(self._create_project, record)
        return {k: v for k, v in record.items() if v is not None}

    def _create_project(self, record: dict[str, Any]) -> None:
        directory = self._dir(record["id"])
        directory.mkdir(parents=True, exist_ok=True)
        meta = {
            k: v
            for k, v in record.items()
            if k not in ("files", "messages") and v is not None
        }
        self._write_json(directory / "project.json", meta)
        self._write_json(directory / "messages.json", record["messages"])
        self._write_files(record["id"], record["files"])
        (directory / "snapshots").mkdir(parents=True, exist_ok=True)

    async def patch_project(self, id: str, patch: Mapping[str, Any]) -> None:
        rest = {k: v for k, v in (patch or {}).items() if k not in ("files", "messages")}
        if rest:
            async with self._lock_for(id):
                await asyncio.to_thread(self._patch_project, id, rest)
        if "files" in (patch or {}):
            await self.put_files(id, _as_str_map(patch["files"]))
        if "messages" in (patch or {}):
            await self.save_messages(id, _as_message_list(patch["messages"]))

    _PATCHABLE = ("name", "template", "dependencies", "createdBy", "connections", "meta")

    def _patch_project(self, id: str, patch: Mapping[str, Any]) -> None:
        meta = self._load_meta(id)
        if meta is None:
            return
        for key in self._PATCHABLE:
            if key in patch:
                meta[key] = patch[key]
        meta["updatedAt"] = _now()
        self._write_json(self._dir(id) / "project.json", meta)

    async def delete_project(self, id: str) -> None:
        """Beyond the protocol: drop a project directory and everything in it."""
        async with self._lock_for(id):
            await asyncio.to_thread(
                shutil.rmtree, self._dir(id), True
            )

    # -- files ---------------------------------------------------------------

    async def get_files(self, id: str) -> FileMap:
        async with self._lock_for(id):
            return await asyncio.to_thread(self._read_files, id)

    async def put_files(self, id: str, files: FileMap) -> None:
        """FULL REPLACE, transactional - see :meth:`_BaseProjectStore.put_files`."""
        async with self._lock_for(id):
            await asyncio.to_thread(self._write_files, id, dict(files))

    # -- messages ------------------------------------------------------------

    async def get_messages(self, id: str) -> Sequence[ChatMessage]:
        async with self._lock_for(id):
            return await asyncio.to_thread(
                self._read_json, self._dir(id) / "messages.json", []
            )

    async def save_messages(
        self, id: str, messages: Sequence[ChatMessage]
    ) -> None:
        async with self._lock_for(id):
            await asyncio.to_thread(
                self._write_json, self._dir(id) / "messages.json", list(messages)
            )

    # -- snapshots -----------------------------------------------------------

    async def create_snapshot(self, id: str, s: Mapping[str, Any]) -> Snapshot:
        record = self._normalize_snapshot(s)
        async with self._lock_for(id):
            await asyncio.to_thread(self._create_snapshot, id, record)
        return {
            "id": record["id"],
            "messageIndex": record["messageIndex"],
            "createdAt": record["createdAt"],
            "kind": record["kind"],
        }

    def _create_snapshot(self, id: str, record: dict[str, Any]) -> None:
        directory = self._dir(id) / "snapshots"
        directory.mkdir(parents=True, exist_ok=True)
        self._write_json(directory / f"{record['id']}.json", record)
        if record["kind"] != "pre-turn":
            return
        # Keep the most recent SNAPSHOT_KEEP pre-turn snapshots.
        entries = sorted(
            (
                (str(loaded.get("createdAt") or ""), path)
                for path, loaded in self._iter_snapshots(id)
                if loaded.get("kind") == "pre-turn"
            ),
            key=lambda pair: pair[0],
        )
        for _, path in entries[: max(0, len(entries) - SNAPSHOT_KEEP)]:
            try:
                path.unlink()
            except OSError:
                pass

    def _iter_snapshots(self, id: str) -> list[tuple[Path, dict[str, Any]]]:
        directory = self._dir(id) / "snapshots"
        if not directory.is_dir():
            return []
        out: list[tuple[Path, dict[str, Any]]] = []
        for path in directory.glob("*.json"):
            loaded = self._read_json(path, None)
            if isinstance(loaded, dict):
                out.append((path, loaded))
        return out

    async def list_snapshots(self, id: str) -> Sequence[Snapshot]:
        """Pre-turn snapshots only, oldest first - the same order as the
        message log they index into."""
        return await asyncio.to_thread(self._list_snapshots_sync, id)

    def _list_snapshots_sync(self, id: str) -> list[dict[str, Any]]:
        rows = [
            {
                "id": loaded.get("id"),
                "messageIndex": loaded.get("messageIndex", 0),
                "createdAt": loaded.get("createdAt", ""),
                "kind": loaded.get("kind", "pre-turn"),
            }
            for _, loaded in self._iter_snapshots(id)
            if loaded.get("kind") == "pre-turn"
        ]
        rows.sort(key=lambda r: str(r.get("createdAt") or ""))
        return rows

    async def get_snapshot(
        self, id: str, snapshot_id: str
    ) -> Optional[SnapshotDetail]:
        return await asyncio.to_thread(self._get_snapshot, id, snapshot_id)

    def _get_snapshot(self, id: str, snapshot_id: str) -> Optional[dict[str, Any]]:
        safe = "".join(c for c in str(snapshot_id) if c.isalnum() or c in "-_")
        if not safe:
            return None
        loaded = self._read_json(self._dir(id) / "snapshots" / f"{safe}.json", None)
        if not isinstance(loaded, dict):
            return None
        loaded.setdefault("files", {})
        loaded.setdefault("messages", [])
        return loaded
