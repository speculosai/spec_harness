"""``LiteLLMProvider`` — the reference ``LLMProvider``.

LiteLLM speaks a single API across providers, so one provider class reaches
OpenAI, Anthropic, Bedrock, Ollama, and anything behind a LiteLLM proxy. New
models are a configuration change, not a code change.

What lands here at v0.1:

* ``config_for`` — resolve the per-call config, honoring an explicit per-turn
  ``requested_model`` only if it is in ``allowed_models``, else the default.
* ``allowed_models`` — the in-chat picker's menu; surfaced via
  ``/capabilities``.
* ``stream`` — call ``litellm.acompletion(..., stream=True)`` and re-yield each
  chunk as an :class:`~speculos_harness.interfaces.LLMDelta`. Passes ``tools``
  straight through, honoring the ``None``-not-``[]`` rule the loop enforces for
  plan mode.
* ``is_context_window_error`` — classify provider errors so the loop can shrink
  history and retry.
* ``route_for`` — optional, post-0.1: dynamic per-task model routing.

Point ``api_base`` at an existing LiteLLM proxy to inherit its keys, budgets,
rate limits, and spend logs. Every method is a stub until the v0.1 code drop.
"""

from __future__ import annotations

from typing import Any, AsyncIterable, Mapping, Optional, Sequence

from .interfaces import (
    ChatMessage,
    LLMCallConfig,
    LLMDelta,
    LLMProvider,
    Principal,
    ToolSchema,
)

_NOT_IMPLEMENTED = (
    "speculos-harness: not yet implemented — arrives with the v0.1 code drop"
)


class LiteLLMProvider(LLMProvider):
    """A LiteLLM-backed model provider.

    Args:
        model: The company-wide default model id in LiteLLM notation
            (e.g. ``"anthropic/claude-sonnet-5"``, ``"openai/gpt-4.1"``,
            ``"ollama/llama3.3"``).
        api_key: Provider API key. Use an obvious placeholder like
            ``"sk-your-key-here"`` in examples.
        api_base: Optional base URL — set it to route through an existing
            LiteLLM proxy so its budgets/keys/spend logs apply.
        allowed_models: The model picker's menu. Defaults to ``[model]``.
        supports_prompt_cache: Whether to place prompt-cache breakpoints for
            this provider (cache reads are billed separately).
    """

    def __init__(
        self,
        model: str,
        *,
        api_key: Optional[str] = None,
        api_base: Optional[str] = None,
        allowed_models: Optional[Sequence[str]] = None,
        supports_prompt_cache: bool = False,
    ) -> None:
        self.model = model
        self.api_key = api_key
        self.api_base = api_base
        self._allowed_models: Sequence[str] = tuple(allowed_models or (model,))
        self.supports_prompt_cache = supports_prompt_cache
        # TODO(v0.1): validate the model id and (lazily) import litellm.

    def config_for(self, ctx: Mapping[str, Any]) -> LLMCallConfig:
        """TODO(v0.1): pick requested_model if allowed, else the default; attach
        api_key / api_base / supports_prompt_cache."""
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def allowed_models(self, principal: Principal) -> Sequence[str]:
        """TODO(v0.1): return the configured menu (may narrow by principal)."""
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def stream(
        self,
        messages: Sequence[ChatMessage],
        tools: Optional[Sequence[ToolSchema]],
        cfg: LLMCallConfig,
        signal: Any,
    ) -> AsyncIterable[LLMDelta]:
        """TODO(v0.1): litellm.acompletion(stream=True) → yield LLMDelta items.
        ``tools`` is ``None`` (never ``[]``) in plan mode."""
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def is_context_window_error(self, err: BaseException) -> bool:
        """TODO(v0.1): classify context-window overflows across providers."""
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def route_for(self, ctx: Mapping[str, Any]) -> Optional[str]:
        """OPTIONAL, post-0.1. TODO(v0.1+): per-task routing within allowed_models."""
        raise NotImplementedError(_NOT_IMPLEMENTED)
