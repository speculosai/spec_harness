# Contributing to Speculos Harness

Thanks for looking. Speculos Harness is the production engine behind [Speculos](https://speculos.ai), open source under Apache-2.0. Issues, discussions, and pull requests are open.

## Where to start

- **Bug reports.** Say what you expected, what happened, and where. A minimal repro against [`examples/minimal`](./examples/minimal) is the fastest path to a fix.
- **Adapters.** Storage, LLM providers, connectors, bundlers, auth. The interfaces live in [`packages/spec_harness/src/protocol.ts`](./packages/spec_harness/src/protocol.ts) - the `@speculosai/spec_harness/protocol` entry point - and are mirrored 1:1 as Python protocols in the agent kit. New adapters are the most welcome kind of PR.
- **Protocol feedback.** Read [`spec/`](./spec). If an event, a field, a method, or a capability is wrong, ambiguous, or missing, open an issue. The wire contract is versioned, so getting it right saves everyone downstream a migration.
- **Examples and docs.** Integration stories from your stack, typo fixes, unclear passages, broken links. All welcome as small PRs.

## Build and test

The agent kit, including an end-to-end drive of the router with a scripted model:

```bash
pip install -e "py/speculos_harness[dev]"
pytest py/speculos_harness/tests
```

The bundle test needs a running build service and skips without one. To include it,
start the service first and point the suite at it:

```bash
docker compose up -d bundler
BUNDLER_URL=http://127.0.0.1:8081 pytest py/speculos_harness/tests
```

TypeScript - the workspace resolves locally through npm workspaces:

```bash
npm install
npm run typecheck    # tsc --noEmit across every package
```

The preview host carries its own self-check, including the sandbox escaping
rules. It is worth running after any change to the iframe host:

```bash
bun run packages/spec_harness/src/preview.self-check.ts
```

The client's pure helpers (the line diff behind the file viewer and the
version timeline) have unit tests, run with bun:

```bash
bun test ./packages/spec_harness/src
```

A change to the wire protocol needs a matching change on both sides: the spec in [`spec/`](./spec), the TypeScript types in [`packages/spec_harness/src/protocol.ts`](./packages/spec_harness/src/protocol.ts), and the Python protocols in the agent kit. A PR that moves one without the others will get sent back.

## How to file an issue

- **Bugs and spec problems** - use the issue tracker. Say what you expected, what the spec says, and where.
- **Ideas and questions** - use Discussions.
- **Security vulnerabilities** - do **not** open a public issue. See [SECURITY.md](./SECURITY.md) and email security@speculos.ai.

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

- **License** - the project is Apache-2.0. Contributions are accepted under the same license; do not add code under an incompatible license.
- **Tone in docs** - plain and direct. No hype words. Sentence-case headers. Money examples in USD.
- **Naming** - the project is Speculos Harness: `@speculosai/spec_harness` on npm, `speculos-harness` on PyPI (publish pending), `speculosai/harness-bundler` as the build-service image. The runtime namespace defaults to `app`. Do not hard-code branding into the shipped packages - branding flows through `brand`, `strings`, and the `namespace` config.
- **Commits** - small, focused, with a clear message describing the change and the why.
- **Respect the invariants.** Anything that touches the security-load-bearing invariants in [SECURITY.md](./SECURITY.md) (the sandbox attributes, `--ignore-scripts`, the CORS rule) needs an explicit, reviewed justification. These are enforced by a startup self-check and checked in code review; a PR that weakens one will be sent back.

## Code of Conduct

Participation is governed by our [Code of Conduct](./CODE_OF_CONDUCT.md). Be kind.
