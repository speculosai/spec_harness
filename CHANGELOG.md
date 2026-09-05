# Changelog

The three artifacts (npm `@speculosai/spec_harness`, pip `speculos-harness`,
image `speculosai/harness-bundler`) share one version number, and CI fails on
drift between them. npm, the Python kit and the image are all at 0.1.6; **the PyPI publish is
still pending**, so the Python kit installs from this repository.

## 0.1.6 - 2026-09-05

The bundler image `speculosai/harness-bundler` is published as 0.1.6 and
`latest` (multi-arch, linux/amd64 + linux/arm64); its contents are those of
0.1.2 plus the pm2 entrypoint `start.sh`.

- The model picker shows only when the server offers two or more models. With
  one model it offered "Server default" and that same model, which was not a
  choice; three docstrings said it hid, and the code did not.
- Documentation audit against the code: the `allowed_models` semantics, the
  `connectors` prop (unclaimed kinds are proxied to the router), what the
  client adapts to from `/capabilities`, the exported overlay components and
  hooks, the snapshot detail route in the Python README, the shipped
  `package_allowlist` on the roadmap, and a botched find-and-replace in the
  bundler's name across four files.

## 0.1.5 - 2026-09-05

- The version timeline's Changes and Restore are icon buttons on the row
  itself; labelled buttons wrapped onto lines of their own in the rail.
- When a host provides `composerHeader`, the model picker joins that row
  instead of taking a line of its own under the text box.
- `<Builder toolbar={false}>` drops the workspace's own toolbar for a host
  whose chrome already carries the brand and a files toggle; `filesOpen`
  controls the file panel from outside.

## 0.1.4 - 2026-09-05

- `useHarness`, `useAgentBusy` and `useRebuildKey` are exported. A host's own
  component rendered into `chatHeader` or `composerHeader` needs the bus
  (`requestFill`) and the busy flag, and 0.1.3 offered the slots without the
  hooks that make them useful. No other change.

## 0.1.3 - 2026-09-05

npm and the Python kit move to 0.1.3; the bundler image is unchanged and stays
at 0.1.2 (nothing in `packages/bundler` changed).

- **A real file view.** Selecting a file in the explorer opens it full size over
  the workspace - line numbers, the whole file - instead of a 260px scroll box
  in the rail. Its **Changes** tab diffs the file against any earlier version.
- **Diffs on the timeline.** Every version has a **Changes** button showing
  exactly which files differ from the app as it is now, with a unified diff per
  file. After a restore, the undo point shows what the restore undid.
- **`GET /projects/{id}/snapshots/{snapshotId}`** on the reference router: one
  snapshot with its `files` and `messages`. The list endpoint still carries
  none; the client fetches a snapshot only when it is about to diff it.
- **Two slots on `<Builder>`:** `chatHeader` (top of the log) and
  `composerHeader` (inside the composer, above the text box, beside Send), and
  `bus.requestFill(projectId, text)` to put a suggestion in the composer
  without sending it. A host can now show the data sources a turn will use
  where the turn is written, and offer starters on an empty project.
- The starter placeholder's mark is a light outline rather than a solid dark
  square, which read as a broken image. The first-build note now keys on the
  placeholder's heading, so a host that swaps in its own logo still gets it.
- `lineDiff`, `diffHunks`, `diffStats`, `changesBetween` and the overlay
  components are exported for hosts that want them elsewhere.

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
