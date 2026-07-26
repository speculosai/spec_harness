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

Two rules hold for every function here:

1. **Nothing mutates its input.** The persisted history and the copy sent to
   the provider are different objects; the transforms below only ever shape
   the second one. Losing that distinction means a user reloads a project and
   finds the code the agent wrote replaced by an elision marker.
2. **Every transform is deterministic.** Given the same history, they render
   the same bytes, which is what lets a prompt-cache prefix survive from one
   turn to the next. A transform that trimmed "whichever message happens to be
   last" would invalidate the cache on every turn and quietly double the bill.

The only transform that belongs on the *persistence* path is
``sanitize_history`` - saving an unbalanced transcript poisons the next turn.
"""

from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Optional, Sequence

from .interfaces import ChatMessage

__all__ = [
    "sanitize_history",
    "normalize_for_llm",
    "summarize_csv",
    "sample_tool_results",
    "truncate_tool_results",
    "elide_stale_assistant_code",
    "cache_breakpoint",
    "fit_to_window",
    "estimate_tokens",
]


# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------

#: Per-tool-message character cap applied to history from PRIOR turns. Every
#: historical tool message gets the same cap - a uniform rule keeps a message's
#: rendered bytes identical turn over turn, so the prompt-cache prefix stays
#: valid. The agent can always re-run a tool for fresh data.
OLD_TOOL_RESULT_MAX_CHARS = 2_000

#: String values in a historical tool call larger than this are stubbed out.
ELIDE_VALUE_OVER_CHARS = 400

#: How many code-bearing assistant turns at the tail keep their code intact.
KEEP_RECENT_ASSISTANT_MSGS = 4

#: Row-array sampling: only arrays longer than MIN get sampled, and a sampled
#: array keeps HEAD rows from the front and TAIL rows from the end.
SAMPLE_MIN_ROWS = 25
SAMPLE_HEAD_ROWS = 6
SAMPLE_TAIL_ROWS = 4

#: How deep the sampler walks a tool payload looking for a row array.
_SAMPLE_MAX_DEPTH = 6

#: Rough characters per token. Used only for budget comparisons, never for
#: billing - a real tokenizer is provider-specific and not worth a dependency
#: for a "does this fit" decision.
_CHARS_PER_TOKEN = 4

#: Per-message wire overhead in the estimate (role, delimiters, tool ids).
_MESSAGE_TOKEN_OVERHEAD = 4

#: The built-in file/package tools. Their results are file bodies and status
#: objects, never datasets, so row sampling has nothing to do with them.
_FILE_TOOL_NAMES = frozenset(
    {"write_file", "edit_file", "read_file", "delete_file", "install_package"}
)

#: Tools whose arguments carry a whole file body worth eliding once superseded.
_FILE_WRITE_TOOLS = frozenset({"write_file", "edit_file", "delete_file"})

_CODE_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)

#: The neutral CSV content-part tag, plus the legacy alias that MUST keep being
#: accepted on read forever (see spec/message-format.md). Written history only
#: ever emits the first one.
_CSV_PART_TYPES = ("attachment_csv", "speculos_csv")

_INTERRUPTED_TOOL_RESULT = json.dumps(
    {
        "ok": False,
        "error": "Previous turn was interrupted; this tool call did not complete.",
    }
)


# ---------------------------------------------------------------------------
# Small shared helpers
# ---------------------------------------------------------------------------


def _is_empty_content(content: Any) -> bool:
    """Whether a message body carries nothing a provider would accept.

    An empty string or an empty content-part list is not "a message with no
    text" to a provider - it is a validation error.
    """
    if content is None:
        return True
    if isinstance(content, str):
        return not content.strip()
    if isinstance(content, (list, tuple)):
        return len(content) == 0
    return False


def _as_text(content: Any) -> str:
    """Flatten a message body to plain text for size estimates."""
    if isinstance(content, str):
        return content
    if isinstance(content, (list, tuple)):
        parts = []
        for part in content:
            if isinstance(part, Mapping):
                text = part.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts)
    return "" if content is None else str(content)


def _normalized_tool_calls(msg: Mapping[str, Any], position: int) -> list[dict[str, Any]]:
    """Return this assistant message's tool calls in canonical OpenAI shape.

    Calls with no usable function name are dropped (nothing can answer them);
    calls with no id get a stable synthetic one so a tool result can be paired
    to them at all.
    """
    raw = msg.get("tool_calls")
    if not isinstance(raw, (list, tuple)):
        return []
    calls: list[dict[str, Any]] = []
    for k, entry in enumerate(raw):
        if not isinstance(entry, Mapping):
            continue
        call = dict(entry)
        fn = call.get("function")
        fn = dict(fn) if isinstance(fn, Mapping) else {}
        name = fn.get("name") or ""
        if not name:
            continue
        args = fn.get("arguments")
        if not isinstance(args, str):
            # Providers stream arguments as a JSON string; a dict here means
            # something upstream already parsed it. Re-encode so the shape the
            # provider sees is the shape it defined.
            args = json.dumps(args if args is not None else {}, ensure_ascii=False)
        fn["name"] = name
        fn["arguments"] = args
        call["function"] = fn
        call["type"] = call.get("type") or "function"
        if not call.get("id"):
            call["id"] = f"call_{position}_{k}"
        calls.append(call)
    return calls


def _normalized_tool_message(msg: Mapping[str, Any], tool_call_id: str) -> dict[str, Any]:
    """A tool message with a string body and the id it answers."""
    out = dict(msg)
    out["role"] = "tool"
    out["tool_call_id"] = tool_call_id
    content = out.get("content")
    if not isinstance(content, str):
        out["content"] = json.dumps(content, ensure_ascii=False, default=str)
    return out


def _tool_call_names(messages: Sequence[ChatMessage]) -> dict[str, str]:
    """``tool_call_id -> tool name``, read off the assistant turns."""
    names: dict[str, str] = {}
    for m in messages:
        if not (isinstance(m, Mapping) and m.get("role") == "assistant"):
            continue
        for call in m.get("tool_calls") or []:
            if not isinstance(call, Mapping):
                continue
            tcid = call.get("id")
            if tcid:
                fn = call.get("function")
                names[tcid] = (fn.get("name") if isinstance(fn, Mapping) else "") or ""
    return names


# ---------------------------------------------------------------------------
# 1. Sanitation - the transcript a provider will accept
# ---------------------------------------------------------------------------


def sanitize_history(messages: Sequence[ChatMessage]) -> list[ChatMessage]:
    """Repair orphaned tool calls/results so the transcript is always valid.

    A turn that was cancelled mid-flight - the tab closed, the stream dropped,
    the user hit stop - leaves an assistant message whose ``tool_calls`` have
    no answering ``tool`` messages. Providers reject that outright, so one dead
    turn would poison every later turn in the project. This repairs four
    classes of damage:

    * **Orphaned calls** get a stub result saying the turn was interrupted, so
      the pairing is balanced without inventing a plausible-looking answer.
    * **Orphaned results** - a ``tool`` message answering no call - are
      dropped.
    * **Empty messages** (no content, no tool calls) are dropped; an empty
      text block is a validation error, not a silent no-op.
    * **Interleaving** is rebuilt: every assistant turn is followed by exactly
      its own results, in call order.

    Safe to run on the persistence path, and it should be: saving an
    unbalanced transcript is what poisons the next turn.
    """
    history = [dict(m) for m in messages if isinstance(m, Mapping)]
    out: list[ChatMessage] = []
    i = 0
    n = len(history)

    while i < n:
        msg = history[i]
        role = msg.get("role")

        if role == "tool":
            # Every legitimate tool message is consumed by the assistant
            # branch below, so anything arriving here answers no call.
            i += 1
            continue

        if role == "assistant":
            calls = _normalized_tool_calls(msg, i)
            if not calls:
                if _is_empty_content(msg.get("content")):
                    i += 1
                    continue
                out.append({k: v for k, v in msg.items() if k != "tool_calls"})
                i += 1
                continue

            # Collect the run of tool messages that follows, keyed by the id
            # each one answers (first result wins on a duplicate id).
            j = i + 1
            results: dict[str, Mapping[str, Any]] = {}
            while j < n and history[j].get("role") == "tool":
                tcid = history[j].get("tool_call_id")
                if isinstance(tcid, str) and tcid and tcid not in results:
                    results[tcid] = history[j]
                j += 1

            assistant = {**msg, "tool_calls": calls}
            if _is_empty_content(assistant.get("content")):
                # An empty text block alongside tool calls trips validation on
                # several providers; absent is fine, empty is not.
                assistant.pop("content", None)
            out.append(assistant)

            for call in calls:
                tcid = call["id"]
                found = results.get(tcid)
                if found is None:
                    out.append(
                        {
                            "role": "tool",
                            "tool_call_id": tcid,
                            "content": _INTERRUPTED_TOOL_RESULT,
                        }
                    )
                else:
                    out.append(_normalized_tool_message(found, tcid))
            i = j
            continue

        if _is_empty_content(msg.get("content")):
            i += 1
            continue
        out.append(msg)
        i += 1

    return out


# ---------------------------------------------------------------------------
# 2. Provider normalization - custom content parts folded into plain chat
# ---------------------------------------------------------------------------


def summarize_csv(
    text: str, name: str = "data.csv", rows: Optional[int] = None, *, max_rows: int = 25
) -> str:
    """Render a CSV attachment as a header plus a sample, in a fenced block.

    The whole file is never handed to the model: a spreadsheet the user drops
    in can be megabytes, and the header plus the first rows is what the model
    needs to write code against it. The declared row count is preserved so the
    model knows the real size.
    """
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    total = rows if isinstance(rows, int) and rows > 0 else text.count("\n") + 1
    try:
        reader = csv.reader(io.StringIO(text))
        sampled: list[list[str]] = []
        for i, row in enumerate(reader):
            sampled.append(row)
            if i >= max_rows:
                break
        header = ",".join(sampled[0]) if sampled else ""
        body = "\n".join(",".join(r) for r in sampled[1:])
    except Exception:
        # A malformed CSV is still useful as raw lines; never fail a turn on it.
        lines = text.split("\n")[: max_rows + 1]
        header = lines[0] if lines else ""
        body = "\n".join(lines[1:])
    return f"[Attached CSV: {name} - {total} total rows]\n```\n{header}\n{body}\n```"


def _normalize_user_content(msg: Mapping[str, Any]) -> dict[str, Any]:
    """Fold custom content parts into a shape any provider accepts.

    Persisted user messages carry ``attachment_csv`` parts (and, in history
    written before the rename, the legacy ``speculos_csv`` alias - readers MUST
    accept both, indefinitely). No provider knows either name, so they are
    folded into the leading text part. Image parts pass through untouched, so a
    vision-capable model still sees the screenshot.
    """
    content = msg.get("content")
    if not isinstance(content, (list, tuple)):
        return dict(msg)

    text_chunks: list[str] = []
    images: list[dict[str, Any]] = []
    for part in content:
        if not isinstance(part, Mapping):
            continue
        kind = part.get("type")
        if kind == "text":
            text_chunks.append(part.get("text") or "")
        elif kind in _CSV_PART_TYPES:
            text_chunks.append(
                summarize_csv(
                    part.get("text") or "",
                    part.get("name") or "data.csv",
                    part.get("rows"),
                )
            )
        elif kind == "image_url":
            images.append(
                {"type": "image_url", "image_url": dict(part.get("image_url") or {})}
            )

    new_content: list[dict[str, Any]] = []
    joined = "\n\n".join(c for c in text_chunks if c)
    if joined:
        new_content.append({"type": "text", "text": joined})
    new_content.extend(images)
    out = dict(msg)
    out["content"] = new_content or list(content)
    return out


def normalize_for_llm(messages: Sequence[ChatMessage]) -> list[ChatMessage]:
    """Fold custom content parts so the transcript is plain OpenAI chat.

    Runs on the provider-bound copy only. The persisted history keeps the
    ``attachment_csv`` part intact, which is what lets the client re-render the
    attachment chip with its row count after a reload.
    """
    out: list[ChatMessage] = []
    for m in messages:
        if not isinstance(m, Mapping):
            continue
        if m.get("role") == "user":
            out.append(_normalize_user_content(m))
        else:
            out.append(dict(m))
    return out


# ---------------------------------------------------------------------------
# 3. Tool-result sampling - the model sees the shape, not the dataset
# ---------------------------------------------------------------------------


def _sample_note(kept: int, total: int) -> dict[str, Any]:
    return {
        "kept": kept,
        "dropped": total - kept,
        "total": total,
        "note": (
            f"showing {kept} of {total} rows (head and tail) to keep the context "
            "small; the running app fetches the FULL set at view time through the "
            "runtime data API. Do NOT inline these rows, and do NOT re-run the tool "
            "to get more."
        ),
    }


def _truncate_row_array(arr: Any) -> Optional[tuple[list[Any], int]]:
    """``(head + tail rows, total)`` for a long list of row-like dicts.

    Head *and* tail, because the interesting row in an ordered result is
    usually at one end or the other - "worst arrears first" puts the answer at
    the top, a running total puts it at the bottom.
    """
    if not isinstance(arr, list) or len(arr) <= SAMPLE_MIN_ROWS:
        return None
    if not isinstance(arr[0], Mapping):
        return None
    head = arr[:SAMPLE_HEAD_ROWS]
    tail = arr[-SAMPLE_TAIL_ROWS:] if SAMPLE_TAIL_ROWS else []
    return list(head) + list(tail), len(arr)


def _sample_payload(obj: Any, depth: int = 0) -> Any:
    """A copy of ``obj`` with its single longest row array sampled.

    Returns ``obj`` itself (same identity) when nothing was sampled, so callers
    can skip re-encoding. Never raises: a payload this does not understand
    passes through and the character cap still applies to it.
    """
    if depth > _SAMPLE_MAX_DEPTH or not isinstance(obj, Mapping):
        return obj

    result = obj.get("result")

    # 1. An MCP-style envelope: result.content[0].text is a JSON string with
    #    the rows inside it.
    if isinstance(result, Mapping):
        content = result.get("content")
        if (
            isinstance(content, list)
            and content
            and isinstance(content[0], Mapping)
            and content[0].get("type") == "text"
            and isinstance(content[0].get("text"), str)
        ):
            try:
                inner = json.loads(content[0]["text"])
            except Exception:
                inner = None
            if inner is not None:
                sampled = _sample_payload(inner, depth + 1)
                if sampled is not inner:
                    new_content = list(content)
                    new_content[0] = {
                        **dict(content[0]),
                        "text": json.dumps(sampled, ensure_ascii=False, default=str),
                    }
                    return {
                        **dict(obj),
                        "result": {**dict(result), "content": new_content},
                    }
                return obj

    # 2. A plain query result: rows at the top level.
    if isinstance(obj.get("rows"), list):
        truncated = _truncate_row_array(obj["rows"])
        if truncated:
            rows, total = truncated
            return {**dict(obj), "rows": rows, "_sampled": _sample_note(len(rows), total)}

    # 3. Anything else: the longest eligible row array among the values,
    #    including one nested under result.data (a common tool envelope).
    container: Any = obj
    if isinstance(result, Mapping) and isinstance(result.get("data"), Mapping):
        container = result["data"]
    best_key, best_len = None, SAMPLE_MIN_ROWS
    if isinstance(container, Mapping):
        for key, value in container.items():
            if (
                isinstance(value, list)
                and len(value) > best_len
                and value
                and isinstance(value[0], Mapping)
            ):
                best_key, best_len = key, len(value)
    if best_key is not None:
        truncated = _truncate_row_array(container[best_key])
        if truncated:
            rows, total = truncated
            new_container = {
                **dict(container),
                best_key: rows,
                "_sampled": _sample_note(len(rows), total),
            }
            if container is obj:
                return new_container
            return {**dict(obj), "result": {**dict(result), "data": new_container}}

    return obj


def sample_tool_results(
    messages: Sequence[ChatMessage], *, keep_recent: int = 3
) -> list[ChatMessage]:
    """Keep the most recent tool outputs whole; sample older ones.

    A character cap alone is not row-aware: a 30 KB, 400-row result fits under
    it, so the model holds a whole dataset and will happily paste it into the
    source. Sampling keeps the head and tail rows plus the true row count, so
    the model can see the *shape* of the data while having no full dataset to
    inline - the running app fetches its own rows at view time.

    Only connector-style tool results are sampled; the built-in file and
    package tools return file bodies and status objects, which are left alone.
    ``keep_recent`` tool messages at the tail stay verbatim so the agent keeps
    full fidelity on what it just looked at.
    """
    names = _tool_call_names(messages)
    tool_positions = [
        i
        for i, m in enumerate(messages)
        if isinstance(m, Mapping) and m.get("role") == "tool"
    ]
    keep = set(tool_positions[len(tool_positions) - keep_recent :]) if keep_recent > 0 else set()

    out: list[ChatMessage] = []
    for i, m in enumerate(messages):
        if not isinstance(m, Mapping):
            continue
        if m.get("role") != "tool" or i in keep:
            out.append(dict(m))
            continue
        name = names.get(m.get("tool_call_id") or "", "")
        content = m.get("content")
        if name in _FILE_TOOL_NAMES or not isinstance(content, str):
            out.append(dict(m))
            continue
        try:
            data = json.loads(content)
        except Exception:
            out.append(dict(m))
            continue
        sampled = _sample_payload(data)
        if sampled is data:
            out.append(dict(m))
            continue
        out.append(
            {**dict(m), "content": json.dumps(sampled, ensure_ascii=False, default=str)}
        )
    return out


def _truncate_text(text: str, max_chars: int) -> str:
    """Head + tail truncation with a marker naming how much went."""
    if max_chars <= 0 or len(text) <= max_chars:
        return text
    head_len = (max_chars * 2) // 3
    tail_len = max_chars - head_len
    dropped = len(text) - head_len - tail_len
    marker = (
        f"\n\n[... {dropped} chars of older tool output elided to save context - "
        "re-run the tool if you need fresh data ...]\n\n"
    )
    tail = text[-tail_len:] if tail_len > 0 else ""
    return text[:head_len] + marker + tail


def truncate_tool_results(
    messages: Sequence[ChatMessage], *, max_chars: int
) -> list[ChatMessage]:
    """Truncate individual tool outputs to a per-result character budget.

    Every tool message reaching this function is from a prior turn (the
    current turn's fresh results are appended full-fidelity by the loop), so
    they all get the *same* cap. A uniform rule - rather than exempting
    whichever message happens to be last - keeps each message's rendered bytes
    identical from turn to turn, which is what lets the prompt-cache prefix
    stay valid instead of being invalidated on every turn.
    """
    out: list[ChatMessage] = []
    for m in messages:
        if not isinstance(m, Mapping):
            continue
        if m.get("role") != "tool":
            out.append(dict(m))
            continue
        content = m.get("content")
        if not isinstance(content, str):
            out.append(dict(m))
            continue
        truncated = _truncate_text(content, max_chars)
        out.append(dict(m) if truncated == content else {**dict(m), "content": truncated})
    return out


# ---------------------------------------------------------------------------
# 4. Stale generated code - the file map is the source of truth
# ---------------------------------------------------------------------------


def _elide_stub(n: int) -> str:
    return (
        f"[{n} chars elided to save context - the current version is in the "
        "project files; call read_file if you need it]"
    )


def _elide_code_block(match: "re.Match[str]") -> str:
    block = match.group(0)
    if len(block) <= ELIDE_VALUE_OVER_CHARS:
        return block
    newline = block.find("\n")
    lang = block[3:newline].strip() if newline != -1 else ""
    return f"```{lang}\n{_elide_stub(len(block))}\n```"


def _elide_tool_call_args(arguments: str) -> str:
    """Stub the large string values in a historical file-write call.

    Short fields survive - the path, the name, a one-line edit - so the agent
    still knows which file each past turn touched. Returns the input unchanged
    when there is nothing large enough to elide.
    """
    try:
        obj = json.loads(arguments)
    except Exception:
        return arguments
    if not isinstance(obj, dict):
        return arguments
    changed = False
    new_obj: dict[str, Any] = {}
    for key, value in obj.items():
        if isinstance(value, str) and len(value) > ELIDE_VALUE_OVER_CHARS:
            new_obj[key] = _elide_stub(len(value))
            changed = True
        else:
            new_obj[key] = value
    return json.dumps(new_obj, ensure_ascii=False) if changed else arguments


def elide_stale_assistant_code(
    messages: Sequence[ChatMessage],
    *,
    keep_recent: int = KEEP_RECENT_ASSISTANT_MSGS,
) -> list[ChatMessage]:
    """Drop superseded generated code from earlier assistant turns.

    In an app builder the transcript is dominated by the file bodies inside
    ``write_file`` / ``edit_file`` arguments, and almost all of them are
    superseded: the live file state is in the project store, one ``read_file``
    away. Re-shipping every old version of every file on every turn is the
    single largest avoidable input cost.

    A tool call is never removed - only its bulky arguments shrink - so the
    assistant/tool pairing stays balanced. The last ``keep_recent``
    code-bearing assistant turns are left intact so the agent keeps full
    context for what it just did.
    """

    def bulky(m: Any) -> bool:
        if not (isinstance(m, Mapping) and m.get("role") == "assistant"):
            return False
        content = m.get("content")
        if isinstance(content, str) and "```" in content:
            return True
        return bool(m.get("tool_calls"))

    indexes = [i for i, m in enumerate(messages) if bulky(m)]
    cut = len(indexes) - max(0, keep_recent)
    to_elide = set(indexes[:cut]) if cut > 0 else set()
    if not to_elide:
        return [dict(m) for m in messages if isinstance(m, Mapping)]

    out: list[ChatMessage] = []
    for i, m in enumerate(messages):
        if not isinstance(m, Mapping):
            continue
        if i not in to_elide:
            out.append(dict(m))
            continue

        elided = dict(m)
        mutated = False

        content = elided.get("content")
        if isinstance(content, str) and "```" in content:
            replaced = _CODE_FENCE_RE.sub(_elide_code_block, content)
            if replaced != content:
                elided["content"] = replaced
                mutated = True

        calls = elided.get("tool_calls")
        if calls:
            new_calls = []
            for call in calls:
                if not isinstance(call, Mapping):
                    new_calls.append(call)
                    continue
                fn = call.get("function")
                fn = fn if isinstance(fn, Mapping) else {}
                args = fn.get("arguments")
                if fn.get("name") in _FILE_WRITE_TOOLS and isinstance(args, str):
                    shrunk = _elide_tool_call_args(args)
                    if shrunk != args:
                        call = {**dict(call), "function": {**dict(fn), "arguments": shrunk}}
                        mutated = True
                new_calls.append(call)
            if mutated:
                elided["tool_calls"] = new_calls

        out.append(elided)
    return out


# ---------------------------------------------------------------------------
# 5. Prompt-cache breakpoints
# ---------------------------------------------------------------------------


def _cache_control(ttl: Optional[str]) -> dict[str, str]:
    control = {"type": "ephemeral"}
    if ttl:
        # An extended TTL survives human-paced editing pauses that the default
        # five minutes does not. Providers without extended-TTL support drop
        # the key rather than failing.
        control["ttl"] = ttl
    return control


def _mark(msg: Mapping[str, Any], ttl: Optional[str]) -> dict[str, Any]:
    """Attach a cache marker to a message's last text block.

    A string body becomes a single text block carrying the marker - the same
    shape the system prompt uses, which is the known-good form across
    providers. A message with nothing cacheable comes back unchanged.
    """
    content = msg.get("content")
    if isinstance(content, str) and content:
        return {
            **dict(msg),
            "content": [
                {"type": "text", "text": content, "cache_control": _cache_control(ttl)}
            ],
        }
    if isinstance(content, (list, tuple)) and content and isinstance(content[-1], Mapping):
        blocks = [dict(p) if isinstance(p, Mapping) else p for p in content]
        blocks[-1] = {**blocks[-1], "cache_control": _cache_control(ttl)}
        return {**dict(msg), "content": blocks}
    return dict(msg)


def cache_breakpoint(
    messages: Sequence[ChatMessage],
    *,
    supports_prompt_cache: bool,
    ttl: Optional[str] = None,
) -> list[ChatMessage]:
    """Place prompt-cache markers at the stable prefix.

    Two markers, and no more, because providers cap how many they honor:

    1. The **system message**, whose text is identical on every turn.
    2. The **last cacheable message** of the history, which caches everything
       before it.

    The payoff is largest *within* a turn: a build does many tool-calling
    steps, and each one re-sends the same growing prefix. Marking the tail
    turns those re-prefills into cache reads instead of full input price. Tool
    messages are skipped as breakpoints - their bodies are the least stable
    part of a transcript, and several providers want a plain string there.

    A no-op when ``supports_prompt_cache`` is false, which is the default: a
    provider that does not understand ``cache_control`` should never see it.
    """
    out = [dict(m) for m in messages if isinstance(m, Mapping)]
    if not supports_prompt_cache or not out:
        return out

    marked: set[int] = set()
    if out[0].get("role") == "system":
        out[0] = _mark(out[0], ttl)
        marked.add(0)

    for i in range(len(out) - 1, -1, -1):
        if i in marked:
            break
        role = out[i].get("role")
        if role == "tool" or _is_empty_content(out[i].get("content")):
            continue
        out[i] = _mark(out[i], ttl)
        break

    return out


# ---------------------------------------------------------------------------
# 6. The shrink-and-retry driver
# ---------------------------------------------------------------------------


def estimate_tokens(messages: Sequence[ChatMessage]) -> int:
    """A rough token count for the whole transcript.

    Characters over four, plus a small per-message overhead. This exists to
    answer "does this fit", which does not justify shipping a tokenizer per
    provider; the authoritative answer is always the provider's own error, and
    :func:`fit_to_window` is driven by that error too.
    """
    total = 0
    for m in messages:
        if not isinstance(m, Mapping):
            continue
        total += _MESSAGE_TOKEN_OVERHEAD
        total += len(_as_text(m.get("content"))) // _CHARS_PER_TOKEN
        for call in m.get("tool_calls") or []:
            if not isinstance(call, Mapping):
                continue
            fn = call.get("function")
            if isinstance(fn, Mapping):
                total += len(str(fn.get("name") or "")) // _CHARS_PER_TOKEN
                total += len(str(fn.get("arguments") or "")) // _CHARS_PER_TOKEN
    return total


@dataclass(frozen=True)
class _Stage:
    """One rung of the shrink ladder, cheapest first."""

    #: Assistant turns at the tail that keep their generated code.
    elide_keep: int
    #: Tool results at the tail that keep every row.
    sample_keep: int
    #: Per-tool-result character cap.
    tool_cap: int
    #: Keep 1/divisor of the middle turns. 1 keeps them all.
    drop_divisor: int


# Rung 0 is what every turn gets: sample and cap old tool output, elide
# superseded code. The later rungs are only reached when the transcript still
# does not fit, and they start throwing away whole turns - which loses context,
# so they are last.
_STAGES: tuple[_Stage, ...] = (
    _Stage(elide_keep=KEEP_RECENT_ASSISTANT_MSGS, sample_keep=3, tool_cap=OLD_TOOL_RESULT_MAX_CHARS, drop_divisor=1),
    _Stage(elide_keep=2, sample_keep=1, tool_cap=800, drop_divisor=1),
    _Stage(elide_keep=0, sample_keep=0, tool_cap=400, drop_divisor=2),
    _Stage(elide_keep=0, sample_keep=0, tool_cap=400, drop_divisor=4),
    _Stage(elide_keep=0, sample_keep=0, tool_cap=200, drop_divisor=8),
)


#: Stands in for the turns a cut removed. It also keeps the transcript legal:
#: several providers require the first message after the system prompt to be a
#: user message, and a cut can easily land so that it is not.
_TRIM_PLACEHOLDER = {
    "role": "user",
    "content": "[earlier conversation trimmed to fit the context window]",
}


def _drop_oldest(messages: Sequence[ChatMessage], divisor: int) -> list[ChatMessage]:
    """Keep the newest ``1/divisor`` of the middle turns.

    The leading system message and the trailing user message are the request
    being answered - they always survive. Cutting the middle can leave a tool
    message whose call is gone, so the result is re-sanitized, and a cut that
    leaves the conversation starting on an assistant turn gets a one-line user
    placeholder so the transcript still satisfies role alternation.
    """
    msgs = [dict(m) for m in messages if isinstance(m, Mapping)]
    if divisor <= 1 or len(msgs) <= 2:
        return msgs
    head = [msgs[0]] if msgs[0].get("role") == "system" else []
    tail = [msgs[-1]] if msgs[-1].get("role") == "user" else []
    middle = msgs[len(head) : len(msgs) - len(tail)]
    keep = max(0, len(middle) // divisor)
    kept = sanitize_history(head + (middle[-keep:] if keep else []) + tail)

    first = len(head)
    if len(kept) > first and kept[first].get("role") != "user":
        kept.insert(first, dict(_TRIM_PLACEHOLDER))
    return kept


def _apply_stage(messages: Sequence[ChatMessage], stage: _Stage) -> list[ChatMessage]:
    out = normalize_for_llm(messages)
    out = elide_stale_assistant_code(out, keep_recent=stage.elide_keep)
    out = sample_tool_results(out, keep_recent=stage.sample_keep)
    out = truncate_tool_results(out, max_chars=stage.tool_cap)
    if stage.drop_divisor > 1:
        out = _drop_oldest(out, stage.drop_divisor)
    return out


def _describe(before: int, after: int) -> str:
    """One plain sentence about what the shrink did, for the caller to show."""
    parts = ["sampled large tool results", "elided superseded file contents"]
    dropped = before - after
    if dropped > 0:
        parts.append(f"dropped {dropped} earlier message{'s' if dropped != 1 else ''}")
    return (
        "Trimmed the conversation to fit the model's context window: "
        + ", ".join(parts)
        + "."
    )


def fit_to_window(
    messages: Sequence[ChatMessage],
    *,
    token_budget: Optional[int] = None,
    supports_prompt_cache: bool = False,
    attempt: int = 0,
    on_note: Optional[Callable[[str], None]] = None,
) -> list[ChatMessage]:
    """Apply the shrink pipeline until the history fits the window.

    The pipeline is: sanitize, then a ladder of rungs that each fold custom
    content parts, elide superseded generated code, sample large tool results,
    cap old tool output, and - only on the higher rungs - drop whole turns
    from the middle. Cache breakpoints are placed last, on whatever survived.

    Two ways to drive it, and they compose:

    * ``token_budget`` - climb rungs until the estimate fits.
    * ``attempt`` - climb at least this many rungs regardless. The loop passes
      the retry count when ``LLMProvider.is_context_window_error`` fires, since
      the provider's own rejection is more authoritative than any estimate.

    Every rung is computed from the same sanitized input, so the result depends
    only on the history and the rung - not on how many times this was called.
    ``on_note`` is invoked with a one-sentence description when a rung above
    the baseline was needed, so the caller can tell the user why the transcript
    got shorter; it is not called for the ordinary per-turn shaping.
    """
    sanitized = sanitize_history(messages)
    shaped = _apply_stage(sanitized, _STAGES[0])
    level = 0

    for i, stage in enumerate(_STAGES):
        if i == 0:
            candidate = shaped
        else:
            candidate = _apply_stage(sanitized, stage)
        shaped, level = candidate, i
        if i < attempt:
            continue
        if token_budget is None or estimate_tokens(candidate) <= token_budget:
            break

    if on_note is not None and level > 0:
        on_note(_describe(len(sanitized), len(shaped)))

    return cache_breakpoint(shaped, supports_prompt_cache=supports_prompt_cache)
