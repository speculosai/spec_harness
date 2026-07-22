"""Reference ``ProjectStore`` implementations.

Two batteries-included stores so the core boots with zero external
dependencies:

* :class:`SQLiteProjectStore` — a single-file SQLite database. The default for
  a self-hosted single-tenant deployment.
* :class:`FsProjectStore` — plain files/JSON on disk, one directory per
  project. Handy for inspecting state by hand and for tests.

Both implement the full :class:`~speculos_harness.interfaces.ProjectStore`
surface **including** the optional snapshot methods, so the v0.1 version
timeline and rollback ship regardless of which you pick. Semantics are ported
verbatim from production: ``put_files`` is a full-replace transactional write,
and pre-turn snapshots are pruned to the most recent ~30.

Every method is a stub until the v0.1 code drop.
"""

from __future__ import annotations

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

_NOT_IMPLEMENTED = (
    "speculos-harness: not yet implemented — arrives with the v0.1 code drop"
)

#: Pre-turn snapshots are pruned to this many most-recent entries per project.
SNAPSHOT_KEEP = 30


class _BaseProjectStore(ProjectStore):
    """Shared method surface for the reference stores.

    Concrete stores differ only in where bytes land; the contract is identical,
    so the signatures live here once and each subclass wires its backend at
    v0.1.
    """

    async def get_project(self, id: str) -> Optional[Project]:
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def create_project(self, input: NewProject) -> Project:
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def patch_project(self, id: str, patch: Mapping[str, Any]) -> None:
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def get_files(self, id: str) -> FileMap:
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def put_files(self, id: str, files: FileMap) -> None:
        """Full-replace, transactional. TODO(v0.1): swap the file map atomically."""
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def get_messages(self, id: str) -> Sequence[ChatMessage]:
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def save_messages(
        self, id: str, messages: Sequence[ChatMessage]
    ) -> None:
        raise NotImplementedError(_NOT_IMPLEMENTED)

    # ---- optional snapshot surface (both reference stores implement it) ----

    async def create_snapshot(self, id: str, s: Mapping[str, Any]) -> Snapshot:
        """TODO(v0.1): persist a snapshot; prune pre-turn ones to SNAPSHOT_KEEP."""
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def list_snapshots(self, id: str) -> Sequence[Snapshot]:
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def get_snapshot(
        self, id: str, snapshot_id: str
    ) -> Optional[SnapshotDetail]:
        raise NotImplementedError(_NOT_IMPLEMENTED)


class SQLiteProjectStore(_BaseProjectStore):
    """A ``ProjectStore`` backed by a single SQLite file.

    Args:
        path: Path to the SQLite database file (created if absent at v0.1).
    """

    def __init__(self, path: str = "./harness.db") -> None:
        self.path = path
        # TODO(v0.1): open/create the database, run migrations for the
        # projects / files / messages / snapshots tables.

    async def get_project(self, id: str) -> Optional[Project]:
        raise NotImplementedError(_NOT_IMPLEMENTED)


class FsProjectStore(_BaseProjectStore):
    """A ``ProjectStore`` backed by a directory tree on disk.

    Args:
        root: Directory under which each project gets its own folder
            (files on disk, metadata/messages/snapshots as JSON).
    """

    def __init__(self, root: str = "./harness-projects") -> None:
        self.root = root
        # TODO(v0.1): ensure the root exists; lay out one directory per project.

    async def get_project(self, id: str) -> Optional[Project]:
        raise NotImplementedError(_NOT_IMPLEMENTED)
