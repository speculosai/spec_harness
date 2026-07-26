"""The agent loop - moved, not rewritten.

This is the heart of Speculos Harness: the tool-calling loop that streams a
completion, executes file/package/connector tools server-side, feeds the
results back, and repeats until the model stops calling tools. It is the same
loop Speculos runs in production.

What this module does:

* ``run_turn`` - drive one user turn: resolve the model config, build the
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
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any, AsyncIterator, Mapping, Optional, Sequence

from . import sse
from .history import fit_to_window, sanitize_history
from .interfaces import (
    AgentTool,
    ChatMessage,
    GenerationEvent,
    Principal,
    TextDelta,
    TokenUsage,
    ToolCallDelta,
    ToolResult,
)
from .llm import is_aborted
from .prompt import build_system_prompt
from .tools.files import builtin_file_tools

__all__ = [
    "DEFAULT_MAX_STEPS",
    "MAX_CONTEXT_RETRIES",
    "AbortSignal",
    "run_turn",
    "execute_tool",
    "build_tool_registry",
    "initial_messages",
    "connector_summary",
    "detect_used",
]

#: Default upper bound on tool-calling iterations per user turn.
DEFAULT_MAX_STEPS = 20

#: How many times a step may be retried against a shrunk transcript before the
#: context-window error is surfaced to the user. Each retry climbs one rung of
#: the shrink ladder in :func:`speculos_harness.history.fit_to_window`, and the
#: ladder runs out of room quickly, so more retries would only burn a request
#: per rung for no benefit.
MAX_CONTEXT_RETRIES = 3

#: How long a single tool may run before the loop gives up on it and reports a
#: failure result. Without a cap, one hung connector call holds the SSE stream
#: open indefinitely and the user sees a tool card that never resolves.
TOOL_TIMEOUT_S = 300.0

#: The CSV content part written on persistence. Readers must also accept the
#: legacy alias (see spec/message-format.md); writers emit only this one.
_CSV_PART = "attachment_csv"


@dataclass
class AbortSignal:
    """A minimal abort handle, for hosts that want to cancel a turn by hand.

    The mounted router does not need one - a client disconnect cancels the
    streaming task and the loop's ``finally`` persists whatever was assembled -
    but a host driving :func:`run_turn` directly (a job queue, a test) needs
    something to flip. Anything with an ``aborted`` flag, an ``is_set()``
    method (``asyncio.Event``), or a plain callable works equally well.
    """

    aborted: bool = False

    def abort(self) -> None:
        """Ask the turn to stop at the next chunk boundary."""
        self.aborted = True


# ---------------------------------------------------------------------------
# Message assembly
# ---------------------------------------------------------------------------


def _attachment_parts(
    attachments: Optional[Sequence[Mapping[str, Any]]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Split the request's attachments into CSV parts and image parts.

    Images become standard ``image_url`` parts so a vision-capable model sees
    the screenshot directly. CSVs become the custom ``attachment_csv`` part,
    which is what gets *persisted*; the provider-bound copy folds it into text
    (with only a sample of the rows) in
    :func:`speculos_harness.history.normalize_for_llm`. Keeping the raw CSV in
    history is what lets the client re-render the attachment chip with its row
    count after a reload.
    """
    csv_parts: list[dict[str, Any]] = []
    image_parts: list[dict[str, Any]] = []
    for item in attachments or ():
        if not isinstance(item, Mapping):
            continue
        kind = item.get("kind")
        if kind == "image":
            url = item.get("dataUrl") or item.get("data_url") or item.get("url")
            if isinstance(url, str) and url:
                image_parts.append({"type": "image_url", "image_url": {"url": url}})
        elif kind == "csv":
            text = item.get("text")
            if isinstance(text, str):
                part: dict[str, Any] = {
                    "type": _CSV_PART,
                    "name": str(item.get("name") or "data.csv"),
                    "text": text,
                }
                rows = item.get("rows")
                if isinstance(rows, int):
                    part["rows"] = rows
                csv_parts.append(part)
    return csv_parts, image_parts


def _user_message(
    text: str, attachments: Optional[Sequence[Mapping[str, Any]]] = None
) -> ChatMessage:
    """The user's turn, in the persisted message shape.

    Plain text with no attachments stays a plain string - the shape most of the
    world's chat history is in, and the cheapest thing to store.
    """
    csv_parts, image_parts = _attachment_parts(attachments)
    if not csv_parts and not image_parts:
        return {"role": "user", "content": text}
    content: list[dict[str, Any]] = []
    if text:
        content.append({"type": "text", "text": text})
    content.extend(csv_parts)
    content.extend(image_parts)
    return {"role": "user", "content": content}


def initial_messages(
    system_prompt: str,
    history: Sequence[ChatMessage],
    user_message: str,
    *,
    attachments: Optional[Sequence[Mapping[str, Any]]] = None,
) -> list[ChatMessage]:
    """Compose the message list that seeds the first LLM call of a turn.

    System prompt, then the sanitized stored history, then the new user message
    with its attachments as content parts. The history is sanitized here rather
    than trusted, because a turn that died mid-flight leaves tool calls with no
    results and every provider rejects that transcript outright.

    The result is the *persisted* shape: ``attachment_csv`` parts intact, no
    cache markers, no elisions. The provider-bound copy is derived from it per
    step by :func:`speculos_harness.history.fit_to_window`, so shaping the
    transcript for the model never rewrites what the user reloads.
    """
    messages: list[ChatMessage] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.extend(sanitize_history(history))
    messages.append(_user_message(user_message, attachments))
    return messages


# ---------------------------------------------------------------------------
# Tool registry
# ---------------------------------------------------------------------------


def _tool_available(tool: AgentTool, ctx: Mapping[str, Any]) -> bool:
    """Whether a tool offers itself for this turn.

    A tool that raises while answering is offered anyway: refusing to run a
    turn because a tool's availability check threw is worse than offering a
    tool whose executor will report the same problem as a normal failure
    result. Mirrors the same rule in the prompt renderer, so the offered set
    and the described set cannot disagree.
    """
    available = getattr(tool, "available", None)
    if not callable(available):
        return True
    try:
        return bool(available(ctx))
    except Exception:
        return True


def build_tool_registry(
    agent: Any,
    principal: Principal,
    ctx: Optional[Mapping[str, Any]] = None,
) -> Sequence[AgentTool]:
    """Assemble the offered tool set for a turn.

    The built-in file/package tools, then every mounted connector's
    contribution, then the host's extra tools - pruned by each tool's
    ``available(ctx)``. Names are unique: a later tool with the same name
    replaces an earlier one, so a host can override a built-in by shipping a
    tool that answers to the same name.

    Returns the concrete list. The caller passes ``None`` (not this list) to
    the provider in plan mode - several providers reject an empty tools array,
    which is why the empty case is expressed as ``None``.
    """
    context = dict(ctx or {})
    context.setdefault("principal", principal)

    candidates: list[AgentTool] = []
    builtins = getattr(agent, "builtin_tools", None)
    if builtins is None:
        builtins = builtin_file_tools(bundler_url=getattr(agent, "bundler_url", None))
    candidates.extend(builtins or ())

    for provider in getattr(agent, "connectors", ()) or ():
        contribute = getattr(provider, "tools", None)
        if not callable(contribute):
            continue
        try:
            candidates.extend(contribute() or ())
        except Exception:
            # A connector that cannot describe its tools still contributes its
            # prompt lines and its runtime bridge; it must not fail the turn.
            continue

    candidates.extend(getattr(agent, "tools", ()) or ())

    by_name: dict[str, AgentTool] = {}
    for tool in candidates:
        name = getattr(tool, "name", "") or ""
        if name:
            by_name[name] = tool
    return tuple(t for t in by_name.values() if _tool_available(t, context))


async def execute_tool(
    tool: AgentTool,
    args: Mapping[str, Any],
    ctx: Mapping[str, Any],
) -> Mapping[str, Any]:
    """Execute a single resolved tool call and normalize its result.

    Every failure mode lands as a result object rather than an exception: a
    tool that raises, times out, or returns something unexpected produces
    ``{"ok": False, "error": ...}``, which the model reads and can correct on
    the next step. One bad tool must never kill the turn.

    The result follows the wire convention exactly - success is
    ``result.get("ok") is not False``, so a tool that returns a bare payload
    with no ``ok`` key is still a success. Whether the call mutated files is
    read by the caller off ``tool.mutates_files``; it is not added to the
    output, because the client's rebuild trigger keys off the tool *name*.
    """
    try:
        result = await asyncio.wait_for(tool.execute(dict(args), ctx), TOOL_TIMEOUT_S)
    except asyncio.CancelledError:
        raise
    except asyncio.TimeoutError:
        name = getattr(tool, "name", "tool")
        return {
            "ok": False,
            "error": f"{name} timed out after {int(TOOL_TIMEOUT_S)}s",
        }
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__}

    if isinstance(result, ToolResult):
        return {"ok": result.ok, **dict(result.extra)}
    if isinstance(result, Mapping):
        return dict(result)
    if result is None:
        return {"ok": True}
    # A tool that returned something scalar still succeeded; carry the value
    # rather than discarding it or calling the tool broken.
    return {"ok": True, "result": result}


# ---------------------------------------------------------------------------
# Streaming helpers
# ---------------------------------------------------------------------------


def _delta_parts(delta: Any) -> tuple[Optional[str], Optional[dict[str, Any]]]:
    """Normalize one provider delta into ``(text, tool_call_fields)``.

    The reference provider yields the :class:`TextDelta` /
    :class:`ToolCallDelta` dataclasses. A provider written against the
    TypeScript interface may yield the mapping form (``{"textDelta": ...}`` /
    ``{"toolCallDelta": {...}}``) instead; both are accepted so a host can port
    an adapter across the two languages without a shim.
    """
    if isinstance(delta, TextDelta):
        return delta.text_delta, None
    if isinstance(delta, ToolCallDelta):
        return None, {
            "index": delta.index,
            "id": delta.id,
            "name": delta.name,
            "args_delta": delta.args_delta,
        }
    if isinstance(delta, Mapping):
        text = delta.get("textDelta", delta.get("text_delta"))
        if isinstance(text, str):
            return text, None
        call = delta.get("toolCallDelta", delta.get("tool_call_delta"))
        if isinstance(call, Mapping):
            return None, {
                "index": call.get("index") or 0,
                "id": call.get("id"),
                "name": call.get("name"),
                "args_delta": call.get("argsDelta", call.get("args_delta")),
            }
    return None, None


def _assistant_message(
    text: str, calls: Mapping[int, Mapping[str, str]]
) -> Optional[ChatMessage]:
    """Assemble the assistant turn from what the stream produced.

    ``None`` when the generation produced nothing at all - an empty assistant
    message is a validation error on several providers, not a harmless no-op.
    """
    message: dict[str, Any] = {"role": "assistant"}
    if text:
        message["content"] = text
    if calls:
        message["tool_calls"] = [
            {
                "id": call.get("id") or f"call_{index}",
                "type": "function",
                "function": {
                    "name": call.get("name") or "",
                    "arguments": call.get("args") or "{}",
                },
            }
            for index, call in sorted(calls.items())
        ]
    if "content" not in message and "tool_calls" not in message:
        return None
    return message


def _friendly(exc: BaseException, prefix: str = "The model call failed") -> str:
    """A readable one-line failure for the ``error`` event.

    The user gets a sentence, never a traceback, but the provider's own text is
    kept (truncated) because "the model is unavailable" and "your key is
    invalid" need different actions from whoever is watching.
    """
    detail = str(exc).strip() or type(exc).__name__
    if len(detail) > 300:
        detail = detail[:300] + "..."
    return f"{prefix}: {detail}"


def _report_generation(
    telemetry: Any,
    stream: Any,
    model: str,
    principal: Principal,
) -> None:
    """Fire ``TelemetrySink.on_generation``, if a sink is mounted.

    Usage rides on the stream object the reference provider returns; a provider
    that yields a bare async generator simply reports zeros rather than
    breaking the turn.
    """
    if telemetry is None:
        return
    hook = getattr(telemetry, "on_generation", None)
    if not callable(hook):
        return
    usage = getattr(stream, "usage", None)
    event = GenerationEvent(
        model=str(getattr(stream, "model", None) or model),
        usage=usage if isinstance(usage, TokenUsage) else TokenUsage(),
        principal=principal,
        latency_ms=float(getattr(stream, "latency_ms", 0.0) or 0.0),
    )
    try:
        hook(event)
    except Exception:
        # Metering is never allowed to fail a build.
        pass


async def connector_summary(provider: Any, principal: Principal) -> Optional[Mapping[str, Any]]:
    """One connector's scoped summary, or ``None`` when it cannot report.

    The reference connectors accept an additive ``principal`` keyword so a
    per-tenant resolver sees the whole caller; a third-party provider written
    to the published interface takes only ``scope``, so both are tried.
    """
    scope = dict(principal.scope or {}) or None
    try:
        try:
            summary = await provider.list(scope, principal=principal)
        except TypeError:
            summary = await provider.list(scope)
    except Exception:
        return None
    return summary if isinstance(summary, Mapping) else None


def detect_used(provider: Any, files: Mapping[str, str]) -> list[str]:
    """Which of this connector's names the project's current files already call."""
    detect = getattr(provider, "detect_used", None)
    if not callable(detect):
        return []
    try:
        return [str(name) for name in (detect(files) or ())]
    except Exception:
        return []


# ---------------------------------------------------------------------------
# The turn
# ---------------------------------------------------------------------------


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

    The frames are ``event: <name>\\ndata: <json>\\n\\n`` bytes, ready to write
    to a streaming response. The sequence is: ``user-message``, then per step a
    run of ``text-delta`` / ``tool-call-delta`` while the model streams, then
    ``tool-call`` + ``tool-result`` for each completed call, repeating until the
    model stops calling tools; ``error`` on failure; ``done`` last, always.

    Three durability properties hold regardless of how the turn ends. History
    is saved before the first token, after every tool result, and at the end -
    and the final save sits in a ``finally`` that survives cancellation, so a
    client that closes the tab mid-turn still finds its partial work on reload.
    A pre-turn snapshot is captured immediately before the first file-mutating
    tool runs, so rollback lands on the state the user actually saw.
    """
    store = agent.store
    llm = agent.llm
    namespace = getattr(agent, "namespace", "app") or "app"
    telemetry = getattr(agent, "telemetry", None)
    steps = max(1, int(max_steps or DEFAULT_MAX_STEPS))

    # The persisted transcript for this turn. Shared with the finally-saver
    # below so a disconnect mid-stream still writes what was assembled.
    new_messages: list[ChatMessage] = []

    async def _persist() -> None:
        """Save the transcript, shielded so a cancelled turn still lands.

        ``asyncio.shield`` keeps the write running when the surrounding task is
        being cancelled - which is exactly the case this exists for, since the
        cancellation *is* the client disconnecting mid-turn.
        """
        if not new_messages:
            return
        payload = sanitize_history(new_messages)
        try:
            await asyncio.shield(store.save_messages(project_id, payload))
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    try:
        project = dict(await store.get_project(project_id) or {})
        files: dict[str, str] = dict(await store.get_files(project_id))
        history = sanitize_history(await store.get_messages(project_id))

        # Captured before anything mutates, so the pre-turn snapshot is the
        # state the user was looking at when they hit send.
        pre_turn_files = dict(files)
        pre_turn_messages = list(history)
        pre_turn_index = len(history)
        snapshot_taken = False

        async def _ensure_snapshot() -> None:
            """Capture the pre-turn snapshot, once, before the first mutation.

            Taken lazily rather than at the top of the turn so a plan-mode turn
            or a question that writes nothing does not fill the timeline with
            snapshots of an unchanged project. Best effort: a store without the
            optional snapshot surface simply has no version timeline.
            """
            nonlocal snapshot_taken
            if snapshot_taken:
                return
            snapshot_taken = True
            create = getattr(store, "create_snapshot", None)
            if not callable(create):
                return
            try:
                await create(
                    project_id,
                    {
                        "messageIndex": pre_turn_index,
                        "kind": "pre-turn",
                        "files": pre_turn_files,
                        "messages": pre_turn_messages,
                    },
                )
            except Exception:
                pass

        # Connector context: what each mounted source offers this caller, plus
        # a static scan of which ones the current files already call.
        summaries: list[Mapping[str, Any]] = []
        used_connectors: list[str] = []
        for provider in getattr(agent, "connectors", ()) or ():
            summary = await connector_summary(provider, principal)
            if summary is not None:
                summaries.append(summary)
            used_connectors.extend(detect_used(provider, files))

        # The context every tool reads its collaborators out of. `files` is the
        # live map: the file tools keep it in step with what they persisted, so
        # two tools in the same turn agree without re-reading the store.
        tool_ctx: dict[str, Any] = {
            "principal": principal,
            "project_id": project_id,
            "projectId": project_id,
            "files": files,
            "namespace": namespace,
            "scope": dict(principal.scope or {}) or None,
            "store": store,
            "bundler_url": getattr(agent, "bundler_url", None),
            "bundler": getattr(agent, "bundler", None),
            "installer": getattr(agent, "installer", None),
            "lang": lang,
            "plan_mode": plan_mode,
        }

        # Plan mode strips the registry entirely: the turn cannot build by
        # construction, not by instruction.
        tools: Sequence[AgentTool] = (
            () if plan_mode else build_tool_registry(agent, principal, ctx=tool_ctx)
        )
        by_name = {getattr(t, "name", ""): t for t in tools if getattr(t, "name", "")}
        # None, never [] - several providers reject an empty tools array.
        tool_schemas = [
            schema for schema in (getattr(t, "schema", None) for t in tools) if schema
        ] or None

        system_prompt = build_system_prompt(
            namespace=namespace,
            instructions=getattr(agent, "instructions", "") or "",
            tools=tools,
            connectors=summaries,
            plan_mode=plan_mode,
            ctx={
                **tool_ctx,
                "dependencies": project.get("dependencies"),
                "template": project.get("template"),
                "used_connectors": used_connectors,
            },
        )

        cfg = llm.config_for(
            {
                "requested_model": requested_model,
                "principal": principal,
                "task": "plan" if plan_mode else "build",
            }
        )
        model = str(cfg.get("model") or getattr(llm, "model", ""))
        supports_cache = bool(cfg.get("supports_prompt_cache", cfg.get("supportsPromptCache")))

        seeded = initial_messages(
            system_prompt, history, message, attachments=attachments
        )
        system_message = seeded[0]
        new_messages.extend(seeded[1:])

        yield sse.user_message(message)
        # Persisted before the first token: a turn that dies immediately is
        # still recorded, and a reload shows the user's own message.
        await _persist()

        context_attempt = 0
        failure: Optional[str] = None

        for _step in range(steps):
            if is_aborted(signal):
                break

            text_parts: list[str] = []
            calls: dict[int, dict[str, str]] = {}
            stream: Any = None

            while True:
                notes: list[str] = []
                prepared = fit_to_window(
                    [system_message, *new_messages],
                    supports_prompt_cache=supports_cache,
                    attempt=context_attempt,
                    on_note=notes.append,
                )
                for note in notes:
                    yield sse.text_delta(f"_{note}_\n\n")

                try:
                    stream = llm.stream(prepared, tool_schemas, cfg, signal)
                    async for delta in stream:
                        text, call = _delta_parts(delta)
                        if text:
                            text_parts.append(text)
                            yield sse.text_delta(text)
                        elif call is not None:
                            index = int(call.get("index") or 0)
                            slot = calls.setdefault(
                                index, {"id": "", "name": "", "args": ""}
                            )
                            if call.get("id"):
                                slot["id"] = str(call["id"])
                            if call.get("name"):
                                slot["name"] = str(call["name"])
                            args_delta = call.get("args_delta")
                            if args_delta:
                                slot["args"] += str(args_delta)
                                yield sse.tool_call_delta(index, str(args_delta))
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    produced = bool(text_parts or calls)
                    # Only retry a step that produced nothing: a context-window
                    # error always lands before the first token, and retrying
                    # after partial output would duplicate it on the client.
                    if (
                        not produced
                        and context_attempt < MAX_CONTEXT_RETRIES
                        and llm.is_context_window_error(exc)
                    ):
                        context_attempt += 1
                        continue
                    failure = _friendly(exc)
                break

            if stream is not None:
                # Reported even for a generation that ended in an error: the
                # tokens up to the failure were still spent and still billed.
                _report_generation(telemetry, stream, model, principal)

            if failure is not None:
                break

            assistant = _assistant_message("".join(text_parts), calls)
            if assistant is not None:
                new_messages.append(assistant)

            # Driven by the presence of tool calls, not by finish_reason: some
            # providers emit tool-call deltas alongside finish_reason="stop",
            # and trusting that would leave unanswered tool calls in history.
            if not calls:
                break

            for index in sorted(calls):
                slot = calls[index]
                tool_call_id = slot.get("id") or f"call_{index}"
                name = slot.get("name") or ""
                raw_args = slot.get("args") or ""

                args: dict[str, Any] = {}
                parse_error: Optional[str] = None
                if raw_args.strip():
                    try:
                        parsed = json.loads(raw_args)
                    except json.JSONDecodeError as exc:
                        parse_error = f"could not parse the tool arguments as JSON: {exc}"
                    else:
                        if isinstance(parsed, Mapping):
                            args = dict(parsed)
                        else:
                            parse_error = (
                                "tool arguments must be a JSON object, got "
                                f"{type(parsed).__name__}"
                            )

                # Emitted even when the arguments did not parse, so the client's
                # pending card - keyed by index while the args streamed - is
                # always paired and resolved rather than left spinning.
                yield sse.tool_call(tool_call_id, name, args)

                tool = by_name.get(name)
                if parse_error is not None:
                    output: Mapping[str, Any] = {"ok": False, "error": parse_error}
                elif tool is None:
                    output = {
                        "ok": False,
                        "error": f"unknown tool {name!r}",
                        "available": ", ".join(sorted(n for n in by_name if n)),
                    }
                else:
                    if getattr(tool, "mutates_files", False):
                        await _ensure_snapshot()
                    output = await execute_tool(tool, args, tool_ctx)

                yield sse.tool_result(tool_call_id, name, output)
                new_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": json.dumps(
                            dict(output), ensure_ascii=False, default=str
                        ),
                    }
                )
                # Per-tool save: an interruption after this point loses at most
                # the tokens in flight, never completed work.
                await _persist()

                if is_aborted(signal):
                    break
        else:
            # The step cap was reached while the model was still calling tools.
            # Say so in the transcript rather than stopping silently, so the
            # user knows the build is unfinished and can ask it to continue.
            note = (
                f"I stopped after {steps} tool steps to avoid running away. "
                "Tell me to continue if the build is unfinished."
            )
            yield sse.text_delta(note)
            new_messages.append({"role": "assistant", "content": note})

        if failure is not None:
            yield sse.error(failure)

        await _persist()
        yield sse.done()

    except asyncio.CancelledError:
        # The client went away. The finally below persists what we have; the
        # cancellation itself must propagate so the server can tear the
        # response down.
        raise
    except Exception as exc:  # noqa: BLE001 - the turn's last line of defense
        yield sse.error(_friendly(exc, "The turn failed"))
        yield sse.done()
    finally:
        await _persist()
