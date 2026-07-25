"""History sanitation and token management.

The subtle, hard-won part of the agent loop. Long real builds accumulate large
tool outputs and stale generated code that blow the context window and inflate
cost; this module keeps the message history valid, small, and cache-friendly
without losing the information the model actually needs.

What this module does (behavior ported verbatim from production):

* ``sanitize_history`` - repair orphaned tool calls (an assistant tool-call
  with no matching tool result, or vice versa) so the provider never rejects a
  malformed transcript.
* ``sample_tool_results`` / ``truncate_tool_results`` - keep recent tool
  outputs whole while sampling/truncating older, larger ones down to a budget.
* ``elide_stale_assistant_code`` - drop superseded generated code from earlier
  assistant turns once newer files exist, since only the current file map
  matters.
* ``cache_breakpoint`` - place prompt-cache markers at the stable prefix so
  providers that bill cache reads separately can reuse it turn over turn.
* ``fit_to_window`` - the shrink-and-retry entry point the loop calls when
  ``LLMProvider.is_context_window_error`` fires.
"""

from __future__ import annotations

from typing import Optional, Sequence

from .interfaces import ChatMessage

_NOT_IMPLEMENTED = "speculos_harness.history: implementation pending"


def sanitize_history(messages: Sequence[ChatMessage]) -> list[ChatMessage]:
    """Repair orphaned tool calls/results so the transcript is always valid.

    TODO: drop or backfill assistant tool-calls that have no matching
    tool-result and tool-results that reference no call.
    """
    raise NotImplementedError(_NOT_IMPLEMENTED)


def sample_tool_results(
    messages: Sequence[ChatMessage], *, keep_recent: int = 3
) -> list[ChatMessage]:
    """Keep the most recent tool outputs whole; sample older ones.

    TODO: retain ``keep_recent`` full outputs; replace older large ones
    with a representative sample.
    """
    raise NotImplementedError(_NOT_IMPLEMENTED)


def truncate_tool_results(
    messages: Sequence[ChatMessage], *, max_chars: int
) -> list[ChatMessage]:
    """Truncate individual tool outputs to a per-result character budget.

    TODO: head/tail truncation with an elision marker.
    """
    raise NotImplementedError(_NOT_IMPLEMENTED)


def elide_stale_assistant_code(
    messages: Sequence[ChatMessage],
) -> list[ChatMessage]:
    """Drop superseded generated code from earlier assistant turns.

    TODO: once newer files exist, only the current file map matters, so
    stale code blocks in old assistant messages are replaced with a short note.
    """
    raise NotImplementedError(_NOT_IMPLEMENTED)


def cache_breakpoint(
    messages: Sequence[ChatMessage], *, supports_prompt_cache: bool
) -> list[ChatMessage]:
    """Place prompt-cache markers at the stable prefix.

    TODO: no-op when ``supports_prompt_cache`` is false; otherwise tag
    the longest stable prefix so cache reads are reused turn over turn.
    """
    raise NotImplementedError(_NOT_IMPLEMENTED)


def fit_to_window(
    messages: Sequence[ChatMessage],
    *,
    token_budget: Optional[int] = None,
    supports_prompt_cache: bool = False,
) -> list[ChatMessage]:
    """Apply the shrink pipeline until the history fits the window.

    TODO: compose sanitize -> elide stale code -> sample/truncate tool
    results -> re-place cache breakpoints. Called by the loop on a
    context-window error before retrying the step.
    """
    raise NotImplementedError(_NOT_IMPLEMENTED)
