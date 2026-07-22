"""A complete Speculos Harness backend — the minimal example.

This is the whole server: mount one router on a FastAPI app, hand it a store,
an LLM provider, and a build brief, and you have an app-building workspace. It
is written to be read top to bottom and copied into your own service.

PRE-RELEASE: this file is real, runnable-shaped code against the decided public
API, but the package it imports is still spec-first. Boot it today and it comes
up and answers ``GET /api/builder/capabilities``, but every working route
returns ``501 {"error": "not yet implemented — v0.1"}`` and the reference
adapters raise ``NotImplementedError``. It becomes a working builder with the
v0.1 code drop. Watch or star the repo to follow.

Run it (once v0.1 lands)::

    pip install -r requirements.txt
    cp .env.example .env          # then edit in your key
    uvicorn main:app --reload

The workspace this backend serves is in ``../web``; the three-service stack
(this backend + the bundler sidecar + the web app) is in ``../docker-compose.yml``.
"""

from __future__ import annotations

import os

from fastapi import FastAPI

from speculos_harness import HarnessAgent
from speculos_harness.llm import LiteLLMProvider
from speculos_harness.stores import SQLiteProjectStore

# ---------------------------------------------------------------------------
# Configuration — driven entirely by environment variables.
#
# Copy .env.example to .env and fill in a real key. Nothing here is secret in
# the source: the values come from the environment so this file is safe to
# commit and share.
# ---------------------------------------------------------------------------

#: The company-wide default model, in LiteLLM notation. LiteLLM speaks one API
#: across OpenAI, Anthropic, Bedrock, Ollama, and a LiteLLM proxy, so switching
#: providers is a config change, not a code change.
DEFAULT_MODEL = os.environ.get("HARNESS_MODEL", "openai/gpt-4.1")

#: Where the bundler sidecar (``speculos/harness-bundler``) is reachable. In the
#: shipped docker-compose this resolves to the ``bundler`` service.
BUNDLER_URL = os.environ.get("BUNDLER_URL", "http://bundler:8081")

#: Optional: point at an existing LiteLLM proxy to inherit its keys, budgets,
#: rate limits, and spend logs. Leave unset to call the provider directly.
LITELLM_PROXY = os.environ.get("LITELLM_PROXY") or None

# ---------------------------------------------------------------------------
# The build brief — Northwind Property Group.
#
# Injected into the system prompt on every turn, so a standing house rule is
# set once by an administrator instead of restated by every user on every
# request. Put your design system here too, so all generated apps follow the
# required look.
# ---------------------------------------------------------------------------

INSTRUCTIONS = """
We are Northwind Property Group, a property-management company.

- All monetary amounts are in US dollars (USD). Format them like $1,234.56.
- Our fiscal year runs April 1 to March 31. "This year" and any quarter labels
  follow that fiscal calendar, not the calendar year.
- Every table you generate must have a "Export CSV" button that downloads the
  visible rows.
- Prefer clear, dense operator dashboards over marketing-style layouts.
""".strip()


# ---------------------------------------------------------------------------
# Auth (optional).
#
# The default is single-user: every request resolves to an editing local user,
# which is what you want for a laptop or a single-tenant deploy. When you are
# ready to put this behind your real sessions, implement an AuthProvider that
# turns a request into a Principal. The example below shows the three outcomes
# the interface supports — allow, plain 401, and a typed in-band denial (402)
# for an authenticated-but-blocked caller such as an expired plan.
#
# Uncomment it, wire up your own ``my_session_lookup``, and pass
# ``auth=MyAuth()`` to ``HarnessAgent`` below.
# ---------------------------------------------------------------------------

# from fastapi import Request
# from speculos_harness import AuthProvider, AuthDenied, Principal
#
# class MyAuth(AuthProvider):
#     async def resolve(self, request: "Request"):
#         user = await my_session_lookup(request.headers.get("authorization"))
#         if user is None:
#             return None  # -> plain 401
#         if user.plan_expired:
#             # authed but blocked — typed, in-band, no exception around the
#             # abstraction. The frontend can turn 402 into an upgrade prompt.
#             return AuthDenied(status=402, message="upgrade required")
#         return Principal(
#             user_id=user.id,
#             can_edit=True,
#             scope={"tenant": user.org_id},  # scopes projects + connector data
#         )


# ---------------------------------------------------------------------------
# Assemble the agent and mount it.
# ---------------------------------------------------------------------------

llm = LiteLLMProvider(
    model=DEFAULT_MODEL,
    api_key=os.environ.get("OPENAI_API_KEY", "sk-your-key-here"),
    api_base=LITELLM_PROXY,  # None -> call the provider directly
    allowed_models=[
        # The in-chat model picker's menu, surfaced via /capabilities.
        "openai/gpt-4.1",
        "anthropic/claude-sonnet-5",
        "ollama/llama3.3",  # a free, local option — no key required
    ],
    supports_prompt_cache=False,
)

agent = HarnessAgent(
    store=SQLiteProjectStore("./projects.db"),  # one file; swap for your own store
    llm=llm,
    instructions=INSTRUCTIONS,
    bundler_url=BUNDLER_URL,
    namespace="app",  # MUST match the frontend + generated apps
    # auth=MyAuth(),   # default: single-user (always allowed)
    # connectors=[...] # see ../../with-connectors for Postgres + MCP
    # telemetry=...    # see ../../with-connectors for a metering sink
)

app = FastAPI(title="Northwind Harness")

# Mount the whole wire protocol under one prefix: /chat (SSE), /bundle/{id},
# /projects (+ /projects/{id}/snapshots, /rollback), /capabilities, /connectors/{kind}.
app.include_router(agent.router, prefix="/api/builder")


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    """A trivial liveness check outside the mounted router."""
    return {"status": "ok"}
