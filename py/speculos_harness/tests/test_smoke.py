"""Smoke tests for the package surface.

They prove the package imports, the public API is exported, the identity
dataclasses work, and a ``HarnessAgent`` builds a router that mounts on a
FastAPI app with every protocol route registered.
"""

from __future__ import annotations

import importlib.metadata

import pytest

MODEL = "anthropic/claude-fable-5"
API_KEY = "sk-ant-..."


def test_package_imports_public_api() -> None:
    """The documented public names import from the top-level package."""
    import speculos_harness as sh

    for name in (
        "HarnessAgent",
        "Principal",
        "AuthDenied",
        "AuthProvider",
        "LLMProvider",
        "LiteLLMProvider",
        "ProjectStore",
        "SQLiteProjectStore",
        "FsProjectStore",
        "TelemetrySink",
        "AgentTool",
        "postgres_connector",
        "mcp_connector",
    ):
        assert hasattr(sh, name), f"missing public export: {name}"

    # Checked against the packaging metadata rather than a literal: a hardcoded
    # version turns every release into a test edit, and it fails for the one
    # reason that is never a bug. Real drift between __init__, pyproject and
    # package.json is what CI's version-drift step is for.
    assert sh.__version__ == importlib.metadata.version("speculos-harness")


def test_principal_and_auth_denied_are_usable() -> None:
    """The identity dataclasses carry the values the router scopes on."""
    from speculos_harness import AuthDenied, Principal

    p = Principal(user_id="local", can_edit=True)
    assert p.user_id == "local"
    assert p.can_edit is True
    assert p.is_viewer is False

    denied = AuthDenied(status=402, message="upgrade required")
    assert denied.deny is True
    assert denied.status == 402


def test_agent_constructs_with_the_reference_adapters() -> None:
    """A HarnessAgent holds the adapters it was handed."""
    from speculos_harness import HarnessAgent
    from speculos_harness.llm import LiteLLMProvider
    from speculos_harness.stores import SQLiteProjectStore

    store = SQLiteProjectStore(":memory:")
    llm = LiteLLMProvider(model=MODEL, api_key=API_KEY)
    agent = HarnessAgent(store=store, llm=llm, bundler_url="http://bundler:8081")

    assert agent.store is store
    assert agent.llm is llm
    assert agent.namespace == "app"
    assert agent.connectors == ()


def test_router_mounts_and_exposes_routes() -> None:
    """The router registers every protocol route and mounts under a prefix."""
    from fastapi import FastAPI

    from speculos_harness import HarnessAgent
    from speculos_harness.llm import LiteLLMProvider
    from speculos_harness.stores import SQLiteProjectStore

    agent = HarnessAgent(
        store=SQLiteProjectStore(":memory:"),
        llm=LiteLLMProvider(model=MODEL, api_key=API_KEY),
        bundler_url="http://bundler:8081",
    )

    # The router is stable across accesses (built lazily, then cached).
    assert agent.router is agent.router

    # Paths are un-prefixed on the router itself; the mount prefix is applied
    # by include_router.
    paths = {getattr(route, "path", None) for route in agent.router.routes}
    for expected in (
        "/chat",
        "/bundle/{project_id}",
        "/projects",
        "/projects/{project_id}",
        "/projects/{project_id}/snapshots",
        "/projects/{project_id}/snapshots/{snapshot_id}",
        "/projects/{project_id}/rollback",
        "/capabilities",
        "/connectors/{kind}",
    ):
        assert expected in paths, f"route not registered: {expected}"

    # And it mounts on an app under a prefix.
    app = FastAPI()
    app.include_router(agent.router, prefix="/api/builder")


def test_mounted_router_answers_over_http() -> None:
    """The mounted router serves its prefixed routes."""
    fastapi_testclient = pytest.importorskip("fastapi.testclient")
    from fastapi import FastAPI

    from speculos_harness import HarnessAgent
    from speculos_harness.llm import LiteLLMProvider
    from speculos_harness.stores import SQLiteProjectStore

    agent = HarnessAgent(
        store=SQLiteProjectStore(":memory:"),
        llm=LiteLLMProvider(model=MODEL, api_key=API_KEY),
        bundler_url="http://bundler:8081",
    )
    app = FastAPI()
    app.include_router(agent.router, prefix="/api/builder")

    client = fastapi_testclient.TestClient(app)
    res = client.get("/api/builder/capabilities")
    assert res.status_code != 404
    assert isinstance(res.json(), dict)
