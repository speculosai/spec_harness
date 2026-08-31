# Changelog

The three artifacts (npm `@speculosai/spec_harness`, pip `speculos-harness`,
image `speculosai/harness-bundler`) share one version number, and CI fails on
drift between them. npm and the image are at 0.1.2; **the PyPI publish is still
pending**, so the Python kit installs from this repository.

## 0.1.2 - 2026-08-31

npm and the image are published. The image is a multi-arch manifest
(linux/amd64 + linux/arm64) under both `0.1.2` and `latest`, matching what
0.1.0 and 0.1.1 shipped.

Build it the same way it was published - a plain `docker build` on an x86 host
produces an amd64-only image, and pushing that to `latest` silently drops
arm64 support for every Apple Silicon and Graviton user:

    docker buildx build --platform linux/amd64,linux/arm64 \
      -t speculosai/harness-bundler:<version> --push packages/bundler

- The npm README no longer claims the Python kit is on PyPI - it is not, and
  0.1.1 shipped that claim to the registry page where a commit could not reach
  it. `NOTICE` now ships in the tarball too.
- The image carries its own `LICENSE` and `NOTICE` and an
  `org.opencontainers.image.licenses` label. It is publicly distributed, so it
  has to carry its terms; 0.1.1 shipped without them.

- The five Cloud behaviours the platform plan lists as drift ports: anti-stall
  ("act, don't narrate"), the inlined-dataset write guard, the Tailwind font
  autofix, the template UI kit with the inline-small-files path, and the
  `edit_file` no-op guard. All mutation-tested.
- `LiteLLMProvider(cache_ttl=...)` plumbs an extended prompt-cache TTL through
  `config_for` -> the loop -> `fit_to_window` -> `cache_breakpoint`. Validated
  on the way in (`5m`, `1h`); an unrecognised value raises rather than being
  stamped onto every request. Without it a host paying for an extended cache
  window silently got the provider default.
- The anti-stall predicate no longer fires on prose that introduces an answer
  ("Let me explain..."), which forced a tool call on a question and turned it
  into an unrequested edit.

## 0.1.1 - 2026-08

- Fixes and hardening across the kit, workspace, bundler, and docs.
- Frontend-only example: three click-through demos, no backend.

## 0.1.0 - 2026-08

- First public release: one npm package (workspace, preview host, protocol
  types, MCP connector), the Python agent kit with its mountable FastAPI
  router, and the multi-arch build-service image.
