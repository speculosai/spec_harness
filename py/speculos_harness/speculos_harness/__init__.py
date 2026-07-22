"""Speculos Harness — the mountable AI app-building agent, as a pip package.

Hand :class:`HarnessAgent` your LLM, storage, auth, and connectors, then mount
one FastAPI router::

    from fastapi import FastAPI
    from speculos_harness import HarnessAgent
    from speculos_harness.stores import SQLiteProjectStore
    from speculos_harness.llm import LiteLLMProvider

    app = FastAPI()
    agent = HarnessAgent(
        store=SQLiteProjectStore("./harness.db"),
        llm=LiteLLMProvider(model="anthropic/claude-sonnet-5",
                            api_key="sk-your-key-here"),
        bundler_url="http://bundler:8081",
    )
    app.include_router(agent.router, prefix="/api/builder")

This is the production engine behind Speculos, open-sourced as one agent loop,
in one language, on the revenue path.

PRE-RELEASE: this is version 0.0.0. The interfaces in
:mod:`speculos_harness.interfaces` are real and stable; everything else is a
typed stub that raises ``NotImplementedError`` (or a route that returns 501)
until the v0.1 code drop.
"""

from __future__ import annotations

from .interfaces import (
    AgentTool,
    AuthDenied,
    AuthProvider,
    ConnectorProvider,
    LLMProvider,
    Principal,
    ProjectStore,
    TelemetrySink,
)
from .config import HarnessAgent
from .llm import LiteLLMProvider
from .stores import FsProjectStore, SQLiteProjectStore
from .connectors import mcp_connector, postgres_connector

__version__ = "0.0.0"

__all__ = [
    "__version__",
    # Assembly
    "HarnessAgent",
    # Identity
    "Principal",
    "AuthDenied",
    "AuthProvider",
    # Providers / adapters
    "LLMProvider",
    "LiteLLMProvider",
    "ProjectStore",
    "SQLiteProjectStore",
    "FsProjectStore",
    "ConnectorProvider",
    "TelemetrySink",
    "AgentTool",
    # Connector factories
    "postgres_connector",
    "mcp_connector",
]
