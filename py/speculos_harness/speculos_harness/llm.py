"""``LiteLLMProvider`` - the reference ``LLMProvider``.

LiteLLM speaks a single API across providers, so one provider class reaches
Anthropic, OpenAI, Bedrock, open-weights models, and anything behind a LiteLLM
proxy. Adding a model is a configuration change, not a code change. Inference
is billed by your provider, on your keys - no markup.

What this module does:

* ``config_for`` - resolve the per-call config, honoring an explicit per-turn
  ``requested_model`` only if it is in ``allowed_models``, else the default.
* ``allowed_models`` - the in-chat picker's menu; surfaced via
  ``/capabilities``.
* ``stream`` - call ``litellm.acompletion(..., stream=True)`` and re-yield each
  chunk as an :class:`~speculos_harness.interfaces.LLMDelta`. Passes ``tools``
  straight through, honoring the ``None``-not-``[]`` rule the loop enforces for
  plan mode.
* ``is_context_window_error`` - classify provider errors so the loop can shrink
  history and retry.
* ``route_for`` - the optional per-task routing seam. Implement it to pick a
  model per task; Speculos's ready-made routing policy is a closed-beta module
  (https://speculos.ai/enterprise).

Point ``api_base`` at an existing LiteLLM proxy to inherit its keys, budgets,
rate limits, and spend logs.
"""

from __future__ import annotations

import time
from typing import Any, AsyncIterable, AsyncIterator, Mapping, Optional, Sequence

from .interfaces import (
    ChatMessage,
    LLMCallConfig,
    LLMDelta,
    LLMProvider,
    Principal,
    TextDelta,
    TokenUsage,
    ToolCallDelta,
    ToolSchema,
)

__all__ = ["LiteLLMProvider", "is_aborted"]


#: Substrings that identify a context-window overflow across providers. The
#: wording differs per vendor and LiteLLM does not normalize all of them, so
#: the classifier is a substring match over the error text plus a check on the
#: exception class. Deliberately narrow: a false positive here silently trims
#: the user's conversation for an error that had nothing to do with length.
_CONTEXT_WINDOW_MARKERS = (
    "contextwindowexceeded",
    "context_length_exceeded",
    "context length exceeded",
    "maximum context length",
    "context window",
    "prompt is too long",
    "too many tokens",
    "input length and `max_tokens` exceed context limit",
    "reduce the length of the messages",
)


def _litellm() -> Any:
    """Import LiteLLM on first use.

    Imported lazily because it is heavy (a few hundred milliseconds and a large
    import graph) and because a host that swapped in its own ``LLMProvider``
    should never pay for it.
    """
    import litellm  # noqa: PLC0415 - deliberately deferred

    return litellm


def _field(obj: Any, name: str) -> Any:
    """Read ``name`` off a chunk that may be an object or a plain mapping.

    LiteLLM returns pydantic models for most providers and dicts for a few
    proxy paths, and the difference is not worth branching on at every call
    site.
    """
    if obj is None:
        return None
    if isinstance(obj, Mapping):
        return obj.get(name)
    return getattr(obj, name, None)


def is_aborted(signal: Any) -> bool:
    """Whether an abort handle says to stop.

    The interface types ``signal`` as ``Any`` so a host can pass whatever it
    already has. Three shapes are understood: an object with an ``aborted``
    flag (the loop's own :class:`~speculos_harness.loop.AbortSignal`), anything
    with ``is_set()`` (``asyncio.Event``, ``threading.Event``), and a plain
    callable predicate. Anything else counts as "not aborted" - a signal that
    cannot be read must never look like a cancellation.
    """
    if signal is None:
        return False
    flag = getattr(signal, "aborted", None)
    if isinstance(flag, bool):
        return flag
    is_set = getattr(signal, "is_set", None)
    if callable(is_set):
        try:
            return bool(is_set())
        except Exception:
            return False
    if callable(signal):
        try:
            return bool(signal())
        except Exception:
            return False
    return False


def _usage_from(raw: Any) -> Optional[TokenUsage]:
    """Normalize a provider usage object into :class:`TokenUsage`.

    Cache buckets are reported under three different names depending on the
    provider and the LiteLLM version (``prompt_tokens_details.cached_tokens``,
    the private ``_cache_read_input_tokens``, or a plain
    ``cache_read_input_tokens``), and they are billed differently from fresh
    input tokens, so they are worth chasing rather than folding into the input
    count.
    """
    if raw is None:
        return None
    prompt = _field(raw, "prompt_tokens")
    completion = _field(raw, "completion_tokens")
    if prompt is None and completion is None:
        return None

    details = _field(raw, "prompt_tokens_details")
    cache_read = (
        _field(details, "cached_tokens")
        or _field(raw, "cache_read_input_tokens")
        or getattr(raw, "_cache_read_input_tokens", None)
        or 0
    )
    cache_write = (
        _field(raw, "cache_creation_input_tokens")
        or getattr(raw, "_cache_creation_input_tokens", None)
        or 0
    )

    def _int(value: Any) -> int:
        try:
            return max(0, int(value or 0))
        except (TypeError, ValueError):
            return 0

    return TokenUsage(
        input_tokens=_int(prompt),
        output_tokens=_int(completion),
        cache_read_tokens=_int(cache_read),
        cache_write_tokens=_int(cache_write),
    )


class _LiteLLMStream:
    """One streamed generation, as an async-iterable of ``LLMDelta``.

    A plain async generator would do the streaming, but the loop also needs the
    token usage the provider reports on the final chunk (for
    ``TelemetrySink.on_generation``) and the model that actually ran. Those
    ride as attributes on this object, readable after iteration finishes:
    ``usage``, ``model``, ``latency_ms``. A different ``LLMProvider`` that
    returns a bare async generator still works - the loop reads the attributes
    with ``getattr`` and reports zeros when they are absent.
    """

    def __init__(
        self,
        provider: "LiteLLMProvider",
        messages: Sequence[ChatMessage],
        tools: Optional[Sequence[ToolSchema]],
        cfg: LLMCallConfig,
        signal: Any,
    ) -> None:
        self._provider = provider
        self._messages = list(messages)
        # The None-not-[] rule, enforced once here so no caller can get it
        # wrong: several providers reject an empty tools array outright.
        self._tools: Optional[list[ToolSchema]] = list(tools) if tools else None
        self._cfg = dict(cfg or {})
        self._signal = signal
        self.model: str = str(self._cfg.get("model") or provider.model)
        self.usage: TokenUsage = TokenUsage()
        self.latency_ms: float = 0.0

    # -- request assembly ----------------------------------------------------

    def _kwargs(self) -> dict[str, Any]:
        cfg = self._cfg
        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": self._messages,
            "tools": self._tools,
            "stream": True,
            # Ask for usage on the final chunk. Providers that do not support
            # it have the parameter dropped rather than erroring, because of
            # drop_params below.
            "stream_options": {"include_usage": True},
            # Per-call rather than the litellm.drop_params global: a host may
            # be using LiteLLM elsewhere in the same process and a global would
            # silently change the behavior of those calls too.
            "drop_params": True,
        }
        api_key = cfg.get("api_key", cfg.get("apiKey"))
        if api_key:
            kwargs["api_key"] = api_key
        api_base = cfg.get("api_base", cfg.get("apiBase"))
        if api_base:
            kwargs["api_base"] = api_base
        extra = cfg.get("extra")
        if isinstance(extra, Mapping):
            kwargs.update(dict(extra))
        return kwargs

    # -- iteration -----------------------------------------------------------

    def _absorb_usage(self, chunk: Any) -> None:
        usage = _usage_from(_field(chunk, "usage"))
        if usage is not None:
            self.usage = usage

    async def __aiter__(self) -> AsyncIterator[LLMDelta]:
        litellm = _litellm()
        started = time.monotonic()
        stream = await litellm.acompletion(**self._kwargs())
        try:
            async for chunk in stream:
                if is_aborted(self._signal):
                    break
                self._absorb_usage(chunk)

                choices = _field(chunk, "choices") or []
                if not choices:
                    continue
                delta = _field(choices[0], "delta")
                if delta is None:
                    continue

                text = _field(delta, "content")
                if isinstance(text, str) and text:
                    yield TextDelta(text_delta=text)

                for call in _field(delta, "tool_calls") or []:
                    index = _field(call, "index")
                    function = _field(call, "function")
                    name = _field(function, "name")
                    args = _field(function, "arguments")
                    yield ToolCallDelta(
                        index=int(index or 0),
                        id=_field(call, "id") or None,
                        name=name or None,
                        args_delta=args if isinstance(args, str) and args else None,
                    )
        finally:
            self.latency_ms = (time.monotonic() - started) * 1000.0
            # Release the upstream HTTP connection promptly on an abort or an
            # exception; a stream left open holds a socket until GC runs.
            close = getattr(stream, "aclose", None) or getattr(stream, "close", None)
            if callable(close):
                try:
                    result = close()
                    if hasattr(result, "__await__"):
                        await result
                except Exception:
                    pass


class LiteLLMProvider(LLMProvider):
    """A LiteLLM-backed model provider.

    Args:
        model: The company-wide default model id in LiteLLM notation
            (e.g. ``"anthropic/claude-fable-5"``, ``"openai/gpt-5.6-sol"``,
            ``"zai/glm-5.2"`` for open weights).
        api_key: Provider API key. Use an obvious placeholder like
            ``"sk-ant-..."`` in examples.
        api_base: Optional base URL - set it to route through an existing
            LiteLLM proxy so its budgets/keys/spend logs apply.
        allowed_models: The model picker's menu. Defaults to ``[model]``.
        supports_prompt_cache: Whether to place prompt-cache breakpoints for
            this provider (cache reads are billed separately).
        extra: Provider passthrough merged into every call (``temperature``,
            ``reasoning_effort``, ``aws_region_name``, ...). Unsupported
            parameters are dropped by LiteLLM rather than raising.
    """

    def __init__(
        self,
        model: str,
        *,
        api_key: Optional[str] = None,
        api_base: Optional[str] = None,
        allowed_models: Optional[Sequence[str]] = None,
        supports_prompt_cache: bool = False,
        extra: Optional[Mapping[str, Any]] = None,
    ) -> None:
        if not isinstance(model, str) or not model.strip():
            raise ValueError(
                "model is required, in LiteLLM notation - e.g. "
                "'anthropic/claude-fable-5'"
            )
        self.model = model.strip()
        self.api_key = api_key
        self.api_base = api_base
        menu = tuple(str(m).strip() for m in (allowed_models or ()) if str(m).strip())
        # The default is the single configured model, so a per-turn override is
        # rejected unless a host deliberately publishes a menu.
        self._allowed_models: Sequence[str] = menu or (self.model,)
        self.supports_prompt_cache = supports_prompt_cache
        self.extra: Mapping[str, Any] = dict(extra or {})

    def config_for(self, ctx: Mapping[str, Any]) -> LLMCallConfig:
        """Resolve the per-call config for one turn.

        Precedence is fixed and not negotiable, because a surprising model
        switch is worse than none: an explicit ``requested_model`` wins when it
        is in ``allowed_models``; otherwise :meth:`route_for` is consulted and
        its answer is accepted only if it is also in ``allowed_models``;
        otherwise the configured default. A ``requested_model`` that is *not*
        allowed is ignored rather than rejected, so a stale client cannot break
        a user's turn.
        """
        principal = ctx.get("principal")
        allowed = tuple(self.allowed_models(principal) if principal is not None else self._allowed_models)

        requested = ctx.get("requested_model", ctx.get("requestedModel"))
        requested = requested.strip() if isinstance(requested, str) else ""

        model: Optional[str] = requested if requested and requested in allowed else None
        if model is None and not requested:
            routed = None
            try:
                routed = self.route_for(
                    {"task": ctx.get("task") or "build", "principal": principal}
                )
            except Exception:
                # A routing policy that throws must not take down the turn.
                routed = None
            if isinstance(routed, str) and routed in allowed:
                model = routed

        cfg: dict[str, Any] = {
            "model": model or self.model,
            "supports_prompt_cache": bool(self.supports_prompt_cache),
        }
        if self.api_key:
            cfg["api_key"] = self.api_key
        if self.api_base:
            cfg["api_base"] = self.api_base
        if self.extra:
            cfg["extra"] = dict(self.extra)
        return cfg

    def allowed_models(self, principal: Principal) -> Sequence[str]:
        """The model picker's menu for this principal.

        The base implementation ignores ``principal`` and returns the
        configured menu. Subclass it to narrow the menu per caller - a plan
        tier, a tenant policy - and ``/capabilities`` follows automatically.
        """
        return tuple(self._allowed_models)

    def stream(
        self,
        messages: Sequence[ChatMessage],
        tools: Optional[Sequence[ToolSchema]],
        cfg: LLMCallConfig,
        signal: Any,
    ) -> AsyncIterable[LLMDelta]:
        """Stream a completion as ``LLMDelta`` items.

        ``tools`` is ``None`` (never ``[]``) in plan mode - and an empty
        sequence is normalized to ``None`` here as well, since several
        providers reject an empty tools array outright.

        The returned object carries ``usage``, ``model``, and ``latency_ms``
        once iteration completes, which is what the loop reports to
        ``TelemetrySink.on_generation``.
        """
        return _LiteLLMStream(self, messages, tools, cfg, signal)

    def is_context_window_error(self, err: BaseException) -> bool:
        """Whether ``err`` is a context-window overflow.

        Drives the shrink-and-retry path: on ``True`` the loop trims history
        with :func:`speculos_harness.history.fit_to_window` and retries instead
        of surfacing an error to the user.
        """
        if err is None:
            return False
        if "contextwindow" in type(err).__name__.lower():
            return True
        try:
            from litellm.exceptions import (  # noqa: PLC0415 - optional at runtime
                ContextWindowExceededError,
            )
        except Exception:
            ContextWindowExceededError = ()  # type: ignore[assignment]
        if ContextWindowExceededError and isinstance(err, ContextWindowExceededError):
            return True
        text = str(err).lower()
        return any(marker in text for marker in _CONTEXT_WINDOW_MARKERS)

    def route_for(self, ctx: Mapping[str, Any]) -> Optional[str]:
        """Pick a model for one task. OPTIONAL: the open seam for routing.

        Subclass and implement it to run your own policy; an explicit user pick
        always wins and the routed choice must come from ``allowed_models``.
        Speculos's ready-made routing policy is a closed-beta module.

        The default returns ``None`` - no routing - which is what makes
        ``/capabilities`` advertise no ``routing`` flag on a stock deployment.
        ``ctx`` carries ``task`` (``"plan" | "build" | "analyze"``) and
        ``principal``.
        """
        return None
