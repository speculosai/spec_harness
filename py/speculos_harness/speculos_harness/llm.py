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

from typing import Any, AsyncIterable, Mapping, Optional, Sequence

from .interfaces import (
    ChatMessage,
    LLMCallConfig,
    LLMDelta,
    LLMProvider,
    Principal,
    ToolSchema,
)

_NOT_IMPLEMENTED = "speculos_harness.llm: implementation pending"


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
        # TODO: validate the model id and (lazily) import litellm.

    def config_for(self, ctx: Mapping[str, Any]) -> LLMCallConfig:
        """Resolve the per-call config for one turn.

        TODO: pick ``requested_model`` when it is allowed, else the default;
        attach api_key / api_base / supports_prompt_cache.
        """
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def allowed_models(self, principal: Principal) -> Sequence[str]:
        """The model picker's menu for this principal.

        TODO: return the configured menu (may narrow by principal).
        """
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def stream(
        self,
        messages: Sequence[ChatMessage],
        tools: Optional[Sequence[ToolSchema]],
        cfg: LLMCallConfig,
        signal: Any,
    ) -> AsyncIterable[LLMDelta]:
        """Stream a completion as ``LLMDelta`` items.

        TODO: litellm.acompletion(stream=True) -> yield LLMDelta items.
        ``tools`` is ``None`` (never ``[]``) in plan mode.
        """
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def is_context_window_error(self, err: BaseException) -> bool:
        """Whether ``err`` is a context-window overflow.

        TODO: classify context-window overflows across providers.
        """
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def route_for(self, ctx: Mapping[str, Any]) -> Optional[str]:
        """Pick a model for one task. OPTIONAL: the open seam for routing.

        Subclass and implement it to run your own policy; an explicit user pick
        always wins and the routed choice must come from ``allowed_models``.
        Speculos's ready-made routing policy is a closed-beta module.

        TODO: per-task routing within allowed_models.
        """
        raise NotImplementedError(_NOT_IMPLEMENTED)
