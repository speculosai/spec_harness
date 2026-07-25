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

_NOT_IMPLEMENTED = "speculos_harness.sse: implementation pending"

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


def sse_frame(event: str, data: Mapping[str, Any]) -> bytes:
    """Encode one SSE frame: ``event: <event>\\ndata: <json>\\n\\n``.

    TODO: validate ``event`` against :data:`EVENT_NAMES`, JSON-encode
    ``data`` compactly, and return the UTF-8 bytes.
    """
    raise NotImplementedError(_NOT_IMPLEMENTED)
    return b""  # unreachable; pins the return type. pragma: no cover


def user_message(text: str) -> bytes:
    """Emit ``user-message`` (clients MUST ignore it)."""
    raise NotImplementedError(_NOT_IMPLEMENTED)


def text_delta(text: str) -> bytes:
    """Emit ``text-delta`` - a chunk of assistant text."""
    raise NotImplementedError(_NOT_IMPLEMENTED)


def tool_call_delta(index: int, args_delta: str) -> bytes:
    """Emit ``tool-call-delta`` - streamed args for a pending tool card."""
    raise NotImplementedError(_NOT_IMPLEMENTED)


def tool_call(tool_call_id: str, name: str, input: Mapping[str, Any]) -> bytes:
    """Emit ``tool-call`` - the finalized call with its parsed input."""
    raise NotImplementedError(_NOT_IMPLEMENTED)


def tool_result(
    tool_call_id: str, name: str, output: Mapping[str, Any]
) -> bytes:
    """Emit ``tool-result``. Success is ``output.get("ok") is not False``."""
    raise NotImplementedError(_NOT_IMPLEMENTED)


def error(message: str) -> bytes:
    """Emit ``error`` - a friendly failure bubble."""
    raise NotImplementedError(_NOT_IMPLEMENTED)


def done() -> bytes:
    """Emit ``done`` - advisory end-of-stream marker."""
    raise NotImplementedError(_NOT_IMPLEMENTED)


# ``json`` is the encoder's dependency; referenced here to keep linters quiet.
_ = json
