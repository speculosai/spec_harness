# Contributing to Speculos Harness

Thanks for looking. Speculos Harness is the production engine behind [Speculos](https://speculos.ai), being open-sourced. This document explains how to help — and, because we are pre-release, what to expect at each stage.

> [!IMPORTANT]
> **We are pre-release.** The repository is published spec-first: the structure, the versioned wire protocol, the public interfaces, and typed stubs are here; the implementation lands with the v0.1 code drop. Right now the single most valuable contribution is **feedback on the protocol and the interfaces, while they are still soft.** Code contributions open once v0.1 is out.

## What we want right now (before the code drop)

- **Spec feedback.** Read [`spec/`](./spec) and the interfaces in [`packages/protocol`](./packages/protocol). If an event, a field, an interface method, or a capability is wrong, ambiguous, or missing, open an issue or a discussion. This is the cheapest time to change the contract, and it is versioned — so getting it right now saves everyone a migration later.
- **Integration stories.** Tell us how you would embed this: your stack, your auth model, your data sources. Gaps you can name now are seams we can design in before v0.1.
- **Docs corrections.** Typos, unclear passages, broken links — all welcome as small PRs.
- **Bug reports against the docs and stubs.** If a stub's signature does not match the spec, or a docstring describes the wrong behavior, that is a real bug. File it.

Please **do not** open PRs that implement features yet. The implementation is coming as a coordinated drop from the production codebase; a parallel community implementation would fork the one loop we are deliberately keeping single. After v0.1, that changes.

## What opens with v0.1

Once the code drop lands, code contributions are open: bug fixes, adapters (storage, LLM providers, connectors, bundlers), examples, and tests against the conformance kit. We will expand this document with build and test instructions at that point.

## How to file an issue

- **Bugs / spec problems** — use the issue tracker. Say what you expected, what the spec or stub says, and where.
- **Ideas / questions** — use Discussions.
- **Security vulnerabilities** — do **not** open a public issue. See [SECURITY.md](./SECURITY.md) and email security@speculos.ai.

## Developer Certificate of Origin (DCO)

All commits must be signed off under the [Developer Certificate of Origin](https://developercertificate.org/). By signing off you certify that you wrote the contribution or otherwise have the right to submit it under the project's license.

Add the sign-off automatically with:

```
git commit -s -m "your message"
```

This appends a line to your commit message:

```
Signed-off-by: Your Name <you@example.com>
```

Use your real name and an email you can be reached at. PRs whose commits are not signed off will be asked to amend before merge.

## Style

- **License** — the project is Apache-2.0. Contributions are accepted under the same license; do not add code under an incompatible license.
- **Tone in docs** — plain and direct. No hype words. Sentence-case headers. Money examples in USD.
- **Naming** — the project is `speculos-harness`; the runtime namespace defaults to `app`. Do not hard-code branding into shared packages — branding flows through `brand`, `strings`, and the `namespace` config.
- **Commits** — small, focused, with a clear message describing the change and the why.
- **Respect the invariants.** Anything that touches the security-load-bearing invariants in [SECURITY.md](./SECURITY.md) (the sandbox attributes, `--ignore-scripts`, the CORS rule) needs an explicit, reviewed justification. These are enforced by a startup self-check and by CI; a PR that weakens one will not merge.

## Code of Conduct

Participation is governed by our [Code of Conduct](./CODE_OF_CONDUCT.md). Be kind.
