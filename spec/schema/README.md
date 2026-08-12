# JSON Schemas

Machine-readable JSON Schemas for the wire data types - the SSE event payloads,
`Project`, `Snapshot`, the capabilities response, `ConnectorSummary`, and the
message-format parts - will live here.

They are planned, not shipped: this directory currently holds only this note. The
source of truth today is the prose specs in the parent directory together with
the TypeScript types at `@speculosai/spec_harness/protocol`, mirrored by hand as
Python protocols in the agent kit. When the schemas land, the prose will still
explain the shapes and the schemas will be the machine-checkable form of the same
contract. See [ROADMAP.md](../../ROADMAP.md).
