"""The templated system prompt, with injection points.

The system prompt tells the model how to build apps in the sandbox: the file
conventions, the runtime namespace (``window.<ns>``), the available tools and
connectors, and the host's standing rules. It is assembled per turn from a
neutral base template plus injected fragments.

What lands here at v0.1:

* ``build_system_prompt`` — compose the base template with, in order: the
  host ``instructions`` brief (currency, fiscal year, house rules, design
  system — set once by an admin, included on every build), the bound
  ``namespace``, each tool's ``prompt_fragment(ctx)``, and each connector's
  contribution from ``ConnectorProvider.list(scope)``. Plan mode swaps in a
  variant that asks the model to propose a plan (as a fenced ``harness-choices``
  block) before writing code.
* The template ships neutral copy — no brand names, no product-specific
  wording; the namespace and instructions are the only host-specific inputs.

Every function is a stub until the v0.1 code drop.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional, Sequence

from .interfaces import AgentTool, ConnectorSummary

_NOT_IMPLEMENTED = (
    "speculos-harness: not yet implemented — arrives with the v0.1 code drop"
)


def build_system_prompt(
    *,
    namespace: str = "app",
    instructions: str = "",
    tools: Optional[Sequence[AgentTool]] = None,
    connectors: Optional[Sequence[ConnectorSummary]] = None,
    plan_mode: bool = False,
    ctx: Optional[Mapping[str, Any]] = None,
) -> str:
    """Assemble the full system prompt for one turn.

    TODO(v0.1): render the base template with the injection points described in
    the module docstring, binding ``namespace`` into every reference to the
    runtime shim and generated-code conventions.
    """
    raise NotImplementedError(_NOT_IMPLEMENTED)


def render_instructions(instructions: str) -> str:
    """Normalize and frame the host ``instructions`` brief for injection.

    TODO(v0.1): trim, and wrap in the delimited section the base template
    expects so host rules are clearly scoped.
    """
    raise NotImplementedError(_NOT_IMPLEMENTED)


def render_connector_context(
    connectors: Sequence[ConnectorSummary], *, namespace: str
) -> str:
    """Render the connector chips + their prompt lines into the prompt.

    TODO(v0.1): one section per connector describing what it exposes and how to
    reach it through ``window.<namespace>``.
    """
    raise NotImplementedError(_NOT_IMPLEMENTED)
