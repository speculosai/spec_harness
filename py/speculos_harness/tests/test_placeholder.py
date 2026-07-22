"""Smoke tests for the pre-release surface.

These are REAL passing tests: they prove the package imports, the public API is
exported, and the agent router mounts on a FastAPI app and answers with the
documented pre-release status codes. They deliberately do not exercise any real
behavior — every implementation stub raises ``NotImplementedError`` until v0.1.

The full executable conformance suite (golden SSE transcripts replayed against
a live loop, the legacy ``speculos_csv`` / ``speculos-choices`` back-compat
fixtures, capability negotiation) lands with the v0.1 code drop.
"""

from __future__ import annotations

import pytest


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

    assert sh.__version__ == "0.0.0"


def test_principal_and_auth_denied_are_usable() -> None:
    """The identity dataclasses are real, not stubs."""
    from speculos_harness import AuthDenied, Principal

    p = Principal(user_id="local", can_edit=True)
    assert p.user_id == "local"
    assert p.can_edit is True
    assert p.is_viewer is False

    denied = AuthDenied(status=402, message="upgrade required")
    assert denied.deny is True
    assert denied.status == 402


def test_router_mounts_and_exposes_routes() -> None:
    """A HarnessAgent builds a router that mounts on a FastAPI app."""
    from fastapi import FastAPI

    from speculos_harness import HarnessAgent
    from speculos_harness.llm import LiteLLMProvider
    from speculos_harness.stores import SQLiteProjectStore

    agent = HarnessAgent(
        store=SQLiteProjectStore(":memory:"),
        llm=LiteLLMProvider(model="openai/gpt-4.1", api_key="sk-your-key-here"),
        bundler_url="http://bundler:8081",
    )

    # The router is stable across accesses (built lazily, then cached).
    assert agent.router is agent.router

    # The six route groups are registered (paths are un-prefixed on the router
    # itself; the mount prefix is applied by include_router).
    paths = {getattr(route, "path", None) for route in agent.router.routes}
    for expected in (
        "/chat",
        "/bundle/{project_id}",
        "/projects",
        "/projects/{project_id}",
        "/projects/{project_id}/snapshots",
        "/projects/{project_id}/rollback",
        "/capabilities",
        "/connectors/{kind}",
    ):
        assert expected in paths, f"route not registered: {expected}"

    # And it actually mounts on an app under a prefix.
    app = FastAPI()
    app.include_router(agent.router, prefix="/api/builder")


def test_mounted_routes_return_pre_release_501() -> None:
    """Every stub route answers with the documented 501 body."""
    fastapi_testclient = pytest.importorskip("fastapi.testclient")
    from fastapi import FastAPI

    from speculos_harness import HarnessAgent
    from speculos_harness.llm import LiteLLMProvider
    from speculos_harness.stores import SQLiteProjectStore

    agent = HarnessAgent(
        store=SQLiteProjectStore(":memory:"),
        llm=LiteLLMProvider(model="openai/gpt-4.1", api_key="sk-your-key-here"),
        bundler_url="http://bundler:8081",
    )
    app = FastAPI()
    app.include_router(agent.router, prefix="/api/builder")

    client = fastapi_testclient.TestClient(app)
    res = client.get("/api/builder/capabilities")
    assert res.status_code == 501
    assert res.json() == {"error": "not yet implemented — v0.1"}


def test_implementation_stubs_raise_not_implemented() -> None:
    """Reference-impl methods raise the honest pre-release message."""
    from speculos_harness.sse import text_delta

    with pytest.raises(NotImplementedError, match="v0.1 code drop"):
        text_delta("hello")
