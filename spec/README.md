# Speculos Harness wire protocol

This directory is the language-neutral specification for the contract between a
Speculos Harness chat client and a Speculos Harness agent server: the streaming
chat call, the preview bridge, the bundle service, the message format on disk,
the capability handshake, and the security invariants that hold the whole thing
together.

It is the source of truth. The npm package (`@speculosai/spec_harness`, with its
`/preview` host and `/protocol` types), the Python kit (`speculos-harness` on
PyPI), and the build service (the `speculosai/harness-bundler` image) are
implementations of what is written here. A third party may implement either side
from this spec alone and interoperate. This is the same contract the production
engine behind Speculos speaks, which is what lets that engine qualify as a
conforming server.

## Version

**Spec version: 1.** The wire protocol is at integer version **1**, carried on
the `Harness-Protocol: 1` header. The shapes described here are the ones the
published code implements. This prose gains clarifications; the wire does not
change without an integer bump.

## What each document covers

| Document | Scope |
|---|---|
| [chat-protocol.md](./chat-protocol.md) | `POST {base}/chat` - the request body, the two auth modes, the seven SSE events with exact payloads, the normative client rules, plan mode, and the no-capabilities fallback. |
| [preview-bridge.md](./preview-bridge.md) | The null-origin `srcdoc` iframe, the normative `sandbox` attribute, the `postMessage` envelope with correlation ids and timeouts, the never-throw connector stubs, and the `namespace` constant. |
| [bundle.md](./bundle.md) | The proxy bundle endpoint and the raw sidecar contract, `/packages/install`, the `caps` descriptor, the baked base dependency set, and the security-load-bearing bundler invariants. |
| [message-format.md](./message-format.md) | The OpenAI chat shape used on the wire and on disk, the `attachment_csv` content part, the `harness-choices` fenced block, and persistence timing. |
| [capabilities.md](./capabilities.md) | `GET {base}/capabilities` - every field, and the 404 fallback defaults. |
| [security.md](./security.md) | The threat model: untrusted generated code, untrusted model inputs, credential handling, share tokens, and the cross-origin embed recipe. |
| [schema/](./schema/) | Where machine-readable JSON Schemas for the wire types will live. Planned; today the prose here plus the `@speculosai/spec_harness/protocol` types are the source of truth. |

## How the protocol is versioned

The version rules are deliberately simple, so a mismatch fails loudly instead of
silently returning a preview with no data.

- **Every response carries `Harness-Protocol: <n>`**, an integer. A client and a
  server agree when they share the same integer.
- **Additive, backward-compatible changes bump the spec minor** (a new optional
  field, a new capability flag, a new advisory event a conforming client already
  ignores when unknown). The integer on the header does not change. A v1.0 client
  and a v1.3 server interoperate.
- **Breaking changes bump the integer** (a removed field, a changed event
  payload, a new required request field). A v1 client and a v2 server do not
  silently limp along; they refuse each other at the handshake.
- **Unknown SSE event names MUST be ignored, not fatal.** This is what makes
  additive minor versions safe: an older client skips an event a newer server
  emits rather than crashing.

The header is the handshake. A client that reads a `Harness-Protocol` integer it
was not built for should surface a clear "protocol mismatch" error rather than
attempting to parse the stream.

## Conformance

Conformance is defined by this prose plus the
`@speculosai/spec_harness/protocol` types, and demonstrated by the reference
implementations: the TypeScript client and the Python kit both speak exactly what
is written here, and a third party can implement either side from the spec alone
and interoperate.

The awkward cases a fresh reimplementation tends to get wrong are called out
inline where they matter and handled by both reference sides: a legacy
`speculos_csv` attachment part (see [message-format.md](./message-format.md)), a
legacy `speculos-choices` fenced block, and a no-capabilities server (see
[capabilities.md](./capabilities.md)).

A set of golden fixtures - recorded SSE transcripts and request/response pairs
that both sides could replay - is planned; see [ROADMAP.md](../ROADMAP.md). Until
it lands, the prose and the reference implementations are the contract.

## Reading order

If you are implementing a client, read [chat-protocol.md](./chat-protocol.md),
then [message-format.md](./message-format.md), then
[preview-bridge.md](./preview-bridge.md). If you are implementing a server, add
[bundle.md](./bundle.md) and [capabilities.md](./capabilities.md). Everyone
should read [security.md](./security.md) - several of its invariants are
non-negotiable, and a startup self-check in the reference implementations refuses
to run when they are violated.
