"""Server-sent-event emitters for the Harness chat stream.

The chat response is hand-rolled SSE - ``event: <name>\\n`` + ``data: <json>\\n\\n``
- **not** the Vercel AI SDK data-stream protocol. There are exactly seven
events, and this module is the single place that frames them, so the wire
vocabulary cannot drift.

The seven events (see ``spec/chat-protocol.md``):

* ``user-message`` ``{text}`` - client MUST ignore (already rendered
  optimistically); emitted for reimplementers/loggers.
* ``text-delta`` ``{text}`` - append to the trailing assistant bubble.
* ``tool-call-delta`` ``{index, argsDelta}`` - stream args into a pending card.
* ``tool-call`` ``{toolCallId, name, input}`` - finalize the card.
* ``tool-result`` ``{toolCallId, name, output}`` - success is
  ``output.ok !== false``; mutating tools trigger a preview rebuild.
* ``error`` ``{message}`` - render a friendly bubble.
* ``done`` ``{}`` - advisory; the stream actually ends on reader EOF.

The module is the ``sse_frame`` encoder plus one thin emitter per event.
"""

from __future__ import annotations

import json
from typing import Any, Mapping

__all__ = [
    "EVENT_NAMES",
    "sse_frame",
    "sse_comment",
    "user_message",
    "text_delta",
    "tool_call_delta",
    "tool_call",
    "tool_result",
    "error",
    "done",
    "is_ok",
]

#: The complete, closed set of chat SSE event names. Documented here as the
#: authoritative Python-side copy; the canonical source is the protocol package.
EVENT_NAMES = (
    "user-message",
    "text-delta",
    "tool-call-delta",
    "tool-call",
    "tool-result",
    "error",
    "done",
)

# Compact separators keep the frames small; a stream is thousands of them.
_SEPARATORS = (",", ":")


def sse_frame(event: str, data: Mapping[str, Any]) -> bytes:
    """Encode one SSE frame: ``event: <event>\\ndata: <json>\\n\\n``.

    ``event`` must be one of :data:`EVENT_NAMES` - the set is closed in
    protocol v1, and a typo here is a silently-ignored event on the client
    (clients MUST ignore names they do not recognize), which is far harder to
    debug than an exception at the emit site.

    The payload is JSON on a single line. ``json.dumps`` escapes newlines
    inside strings, which is what keeps a multi-line tool result from breaking
    the frame apart; ``default=str`` keeps an exotic value in a tool result
    (a datetime, a Decimal) from killing the stream mid-turn.
    """
    if event not in EVENT_NAMES:
        raise ValueError(
            f"unknown SSE event {event!r}; protocol v1 defines {EVENT_NAMES}"
        )
    payload = json.dumps(
        dict(data), separators=_SEPARATORS, ensure_ascii=False, default=str
    )
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")


def sse_comment(text: str = "") -> bytes:
    """Encode an SSE comment line - a keep-alive, not an event.

    A comment (``: ...``) carries no event name, so a conforming client
    ignores it entirely. It exists to stop an intermediary buffering or
    timing out a long tool call that produces no tokens for a while.
    """
    return f": {text}\n\n".encode("utf-8")


def user_message(text: str) -> bytes:
    """Emit ``user-message`` (clients MUST ignore it)."""
    return sse_frame("user-message", {"text": text})


def text_delta(text: str) -> bytes:
    """Emit ``text-delta`` - a chunk of assistant text."""
    return sse_frame("text-delta", {"text": text})


def tool_call_delta(index: int, args_delta: str) -> bytes:
    """Emit ``tool-call-delta`` - streamed args for a pending tool card."""
    # `index` is the client's pending-card key, so it must survive the wire as
    # a number even when a provider hands it over as a string.
    return sse_frame("tool-call-delta", {"index": int(index), "argsDelta": args_delta})


def tool_call(tool_call_id: str, name: str, input: Mapping[str, Any]) -> bytes:
    """Emit ``tool-call`` - the finalized call with its parsed input."""
    return sse_frame(
        "tool-call",
        {"toolCallId": tool_call_id, "name": name, "input": dict(input)},
    )


def tool_result(
    tool_call_id: str, name: str, output: Mapping[str, Any]
) -> bytes:
    """Emit ``tool-result``. Success is ``output.get("ok") is not False``."""
    return sse_frame(
        "tool-result",
        {"toolCallId": tool_call_id, "name": name, "output": dict(output)},
    )


def error(message: str) -> bytes:
    """Emit ``error`` - a friendly failure bubble."""
    return sse_frame("error", {"message": message})


def done() -> bytes:
    """Emit ``done`` - advisory end-of-stream marker."""
    return sse_frame("done", {})


def is_ok(output: Mapping[str, Any]) -> bool:
    """The ``ok !== false`` success convention, in one place.

    Deliberately not ``output.get("ok") is True``: a result object with no
    ``ok`` key at all counts as success, and only an explicit ``False`` is a
    failure. The client applies the same test before bumping its rebuild key.
    """
    return output.get("ok") is not False
