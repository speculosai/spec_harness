"""A complete Speculos Harness backend - the minimal example.

This is the whole server: mount one router on a FastAPI app, hand it a store,
an LLM provider, and a build brief, and you have an app-building workspace. It
is written to be read top to bottom and copied into your own service.

Run it::

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
# Configuration - driven entirely by environment variables.
#
# Copy .env.example to .env and fill in a real key. Nothing here is secret in
# the source: the values come from the environment so this file is safe to
# commit and share.
# ---------------------------------------------------------------------------

#: The company-wide default model, in LiteLLM notation. LiteLLM speaks one API
#: across every major provider and a LiteLLM proxy, so switching providers is a
#: config change, not a code change. Inference is billed by your provider, on
#: your keys - no markup.
DEFAULT_MODEL = os.environ.get("HARNESS_MODEL", "anthropic/claude-fable-5")

#: Where the bundler sidecar (``speculos/harness-bundler``) is reachable. In the
#: shipped docker-compose this resolves to the ``bundler`` service.
BUNDLER_URL = os.environ.get("BUNDLER_URL", "http://bundler:8081")

#: Optional: point at an existing LiteLLM proxy to inherit its keys, budgets,
#: rate limits, and spend logs. Leave unset to call the provider directly.
LITELLM_PROXY = os.environ.get("LITELLM_PROXY") or None

# ---------------------------------------------------------------------------
# The build brief - Northwind Property Group.
#
# Included in the system prompt on every build, so a standing house rule is set
# once by an administrator instead of restated by every user on every request.
# The design system goes here too, so every generated app comes out on-brand.
# ---------------------------------------------------------------------------

INSTRUCTIONS = """
We are Northwind Property Group, a property-management company.

- Amounts are in USD. Format them like $1,234.56.
- The fiscal year runs April 1 to March 31. "This year" and any quarter labels
  follow that fiscal calendar, not the calendar year.
- Use the Northwind design system for every app.
- Every table needs a CSV export button that downloads the visible rows.
""".strip()


# ---------------------------------------------------------------------------
# Auth (optional).
#
# The default is single-user: every request resolves to an editing local user,
# which is what you want for a laptop or a single-tenant deploy. To put this
# behind your real sessions, implement an AuthProvider that turns a request into
# a Principal. The example below shows the three outcomes the interface
# supports - allow, plain 401, and a typed in-band denial (402) for an
# authenticated-but-blocked caller such as an expired plan.
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
#             # authed but blocked - typed, in-band, no exception around the
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
    api_key=os.environ.get("ANTHROPIC_API_KEY", "sk-ant-..."),
    api_base=LITELLM_PROXY,  # None -> call the provider directly
    allowed_models=[
        # The in-chat model picker's menu, surfaced via /capabilities.
        "anthropic/claude-fable-5",
        "openai/gpt-5.6-sol",
        "zai/glm-5.2",  # open weights
    ],
    supports_prompt_cache=True,  # keeps cost per build flat across turns
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
