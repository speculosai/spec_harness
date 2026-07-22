# JSON Schemas

This directory is the future home of the machine-readable JSON Schemas for the
wire data types — the SSE event payloads, `Project`, `Snapshot`, the capabilities
response, `ConnectorSummary`, and the message-format parts. With the v0.1 code
drop these are **emitted by CI from the zod source of truth** in
`@speculos-harness/protocol`; the Python kit's pydantic wire models generate from
the same JSON, so the two languages genuinely cannot drift. Until v0.1 lands this
directory is intentionally empty — the prose specs in the parent directory are
the authoritative description of these shapes in the meantime.
