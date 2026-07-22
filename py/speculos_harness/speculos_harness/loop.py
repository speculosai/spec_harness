"""The agent loop — moved, not rewritten.

This is the heart of Speculos Harness: the tool-calling loop that streams a
completion, executes file/package/connector tools server-side, feeds the
results back, and repeats until the model stops calling tools. It is the same
loop Speculos runs in production.

What lands here at v0.1:

* ``run_turn`` — drive one user turn: resolve the model config, build the
  message list, then loop up to ``max_steps`` times. Each step calls
  ``LLMProvider.stream(messages, tools, cfg, signal)`` and re-emits every
  delta as a Harness SSE event via :mod:`speculos_harness.sse`. Tool calls are
  executed through the tool registry; their results are appended and the loop
  continues. Plan mode passes ``tools=None`` (never ``[]``).
* File-mutating tool results (``write_file`` / ``edit_file`` / ``delete_file``
  / ``install_package``) are persisted through ``ProjectStore.put_files`` /
  the bundler, and the ``tool-result`` event tells the client to rebuild.
* Context-window handling: when ``LLMProvider.is_context_window_error`` is
  true, history is shrunk (see :mod:`speculos_harness.history`) and the step is
  retried rather than surfaced as an error.
* Cancellation via the request's abort signal; persistence of messages before
  the stream, after each tool, at ``done``, and in ``finally``.
* Telemetry: ``TelemetrySink.on_generation`` fires after each generation with
  the model, principal, token usage, and latency.

Everything below is a stub until the v0.1 code drop.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Mapping, Optional, Sequence

from .interfaces import AgentTool, ChatMessage, Principal

_NOT_IMPLEMENTED = (
    "speculos-harness: not yet implemented — arrives with the v0.1 code drop"
)

#: Default upper bound on tool-calling iterations per user turn.
DEFAULT_MAX_STEPS = 20


async def run_turn(
    *,
    agent: Any,
    project_id: str,
    principal: Principal,
    message: str,
    plan_mode: bool = False,
    requested_model: Optional[str] = None,
    lang: Optional[str] = None,
    attachments: Optional[Sequence[Mapping[str, Any]]] = None,
    signal: Any = None,
    max_steps: int = DEFAULT_MAX_STEPS,
) -> AsyncIterator[bytes]:
    """Run one user turn, yielding encoded Harness SSE frames.

    TODO(v0.1): implement the tool-calling loop described in the module
    docstring. Yields ``event: <name>\\ndata: <json>\\n\\n`` frames ready to
    write to the streaming response.
    """
    raise NotImplementedError(_NOT_IMPLEMENTED)
    # 'yield' below is unreachable but marks this as an async generator so the
    # real v0.1 signature (AsyncIterator[bytes]) is stable now.
    yield b""  # pragma: no cover


async def execute_tool(
    tool: AgentTool,
    args: Mapping[str, Any],
    ctx: Mapping[str, Any],
) -> Mapping[str, Any]:
    """Execute a single resolved tool call and normalize its result.

    TODO(v0.1): call ``tool.execute(args, ctx)``, coerce to the
    ``ok !== false`` convention, and tag whether it mutated files so the loop
    knows to trigger a rebuild.
    """
    raise NotImplementedError(_NOT_IMPLEMENTED)


def build_tool_registry(
    agent: Any, principal: Principal
) -> Sequence[AgentTool]:
    """Assemble the offered tool set for a turn.

    TODO(v0.1): the built-in file/package tools plus connector-contributed and
    user-supplied tools, pruned by each tool's ``available(ctx)``. Returns the
    concrete list; the caller passes ``None`` (not this list) in plan mode.
    """
    raise NotImplementedError(_NOT_IMPLEMENTED)


def initial_messages(
    system_prompt: str, history: Sequence[ChatMessage], user_message: str
) -> list[ChatMessage]:
    """Compose the message list that seeds the first LLM call of a turn.

    TODO(v0.1): system prompt + sanitized history + the new user message
    (with any attachments as content parts).
    """
    raise NotImplementedError(_NOT_IMPLEMENTED)
