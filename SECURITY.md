# Security policy

Speculos Harness runs code an AI wrote, in a sandbox, against real data. Security is not an afterthought in this project — several of its design decisions exist specifically to contain that risk. This document tells you how to report a problem, and lists the invariants that must never be weakened.

## Reporting a vulnerability

**Please report vulnerabilities privately. Do not open a public issue, discussion, or pull request for a security problem.**

Email **security@speculos.ai** with:

- a description of the issue and its impact,
- the steps or a proof-of-concept to reproduce it,
- the affected package(s) and version(s), and
- any suggested remediation, if you have one.

### What to expect

- **Acknowledgement within 3 business days** that we received your report.
- **An initial assessment within 10 business days** — whether we can reproduce it, and a rough severity.
- **Coordinated disclosure.** We will work with you on a fix and a disclosure timeline, and credit you when the fix ships unless you ask us not to. Please give us reasonable time to release a fix before any public disclosure.

> [!NOTE]
> **Pre-release.** The implementation lands with the v0.1 code drop. Until then there is little running code to attack — but the specs and interfaces are live, and design-level security feedback (a hole in the sandbox model, the bridge, or the auth modes) is genuinely valuable and just as welcome as an implementation bug.

## Non-negotiable invariants

These properties are what make it safe to run generated code and to embed the workspace in another product. They are enforced by a startup self-check that refuses to run when one is misconfigured, and by CI. A change that weakens any of them will not be accepted without an explicit, reviewed security justification — and most of them simply must not change at all.

1. **The preview sandbox is null-origin.** The generated app runs in a `srcdoc` iframe with the sandbox attribute
   `allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-top-navigation-by-user-activation`.
   **`allow-same-origin` must never be added** — that omission is *why* the data bridge exists. Ungated `allow-top-navigation` must never be added either. This string is security-load-bearing and non-configurable.

2. **Credentials never enter the sandbox.** Generated code has no network identity of its own and never holds a secret. All data access is proxied through a `postMessage` bridge in the parent page, where every request is authenticated, scoped to the caller's `Principal`, and timed out (60 seconds). Connector credentials stay server-side, in the connector.

3. **Package installs run with `--ignore-scripts`, always.** The bundler must not execute install-time scripts, and package name/version are regex-validated. The build service ships only as a locked-down container: non-root, with an ephemeral build directory. This is the supply-chain boundary; removing `--ignore-scripts` is a startup-abort condition.

4. **No `Access-Control-Allow-Origin: *` with credentials.** Cookie-mode (credentialed) cross-origin embeds require a per-origin CORS allowlist plus `SameSite=None`. The wildcard-origin-plus-credentials combination is insecure and is refused at startup rather than shipped as a broken embed. Bearer mode (`credentials: 'omit'`) is the default for cross-origin.

## Treat connector and tool output as untrusted

The agent consumes untrusted input on every turn — rows from user databases, MCP tool results, uploaded CSVs — while holding file-writing and package-installing tools. Hosts running Speculos Harness should treat connector output as untrusted model input and consider the available backstops: a curated dependency allowlist to constrain `install_package`, and the optional write-validator seam for deterministic checks on generated code. No model-side mitigation is treated as sufficient on its own; the residual prompt-injection risk is documented, not hidden. See [`spec/security.md`](./spec/security.md) for the full treatment.

## Supported versions

Until v0.1 ships there are no released versions to support. Once releases begin, this section will state which versions receive security fixes.
