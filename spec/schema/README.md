# JSON Schemas

Machine-readable JSON Schemas for the wire data types - the SSE event payloads,
`Project`, `Snapshot`, the capabilities response, `ConnectorSummary`, and the
message-format parts. CI emits them from the zod source of truth in
`@speculos-harness/protocol`, and the Python kit's pydantic wire models generate
from the same JSON, so the two languages cannot drift. The prose specs in the
parent directory explain these shapes; the schemas are the machine-checkable form
of the same contract.
