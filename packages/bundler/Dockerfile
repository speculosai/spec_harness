# speculosai/harness-bundler (the build-service image) - the locked-down build-service container.
#
# Published as `speculosai/harness-bundler`. This is the one component that executes
# untrusted dependency code: `bun add` runs arbitrary npm, and Bun.build resolves the
# app's imports against this box's own node_modules. So it ships only as this hardened
# image - a naive setup (root, install scripts enabled, temp dir moved out from under
# cwd) is what turns a bundle request into remote code execution. The entrypoint runs a
# startup self-check and exits non-zero if any invariant below is misconfigured away.
#
# THE INVARIANTS
# --------------
#   * Runs as a NON-ROOT user (a dedicated unprivileged account, never UID 0).
#   * All installs run with --ignore-scripts, always - a package cannot execute
#     install-time scripts on the build box. This flag is not configurable off.
#   * Package name and version are regex-validated before they ever reach `bun add`.
#   * Builds happen in an EPHEMERAL directory UNDER the process cwd (load-bearing: it is
#     what lets node_modules resolve) and are wiped per request.
#   * The base dependency set the system prompt promises is BAKED at image build time
#     (react 19, recharts, @tanstack/react-table, date-fns, lucide-react, ...), from the
#     same single list the prompt's LIBRARIES block is generated from; the startup
#     self-check asserts every promised package resolves.
#   * Only the bundler port is exposed; no secrets are baked into the image.
#
# See spec/bundle.md and spec/security.md for the normative bundle contract and the
# non-negotiable build-service safety rules.

# ---------------------------------------------------------------------------
# Stage 1 - render the baked base manifest from the service's own dependency list.
#
# The list lives in exactly one place per language (BASE_DEPENDENCIES in src/index.ts,
# LIBRARIES in the Python kit) so the image and the system prompt cannot drift into
# promising a package the build service does not have. Rendering it here, rather than
# copying a checked-in file, also keeps the install layer cacheable: the layer below
# only re-runs when the rendered dependency set actually changes.
# ---------------------------------------------------------------------------
FROM oven/bun:1.3.12 AS manifest
WORKDIR /gen
COPY src/index.ts ./src/index.ts
RUN bun --eval 'const { BASE_DEPENDENCIES } = await import("./src/index.ts"); \
      await Bun.write("base-package.json", JSON.stringify({ name: "harness-bundler-base", private: true, dependencies: BASE_DEPENDENCIES }, null, 2) + "\n")'

# ---------------------------------------------------------------------------
# Stage 2 - the runtime image.
#
# Both stages pin a concrete Bun release rather than the floating `1` tag: this is the
# one component that runs untrusted dependency code, so its runtime and OS packages must
# not change from under it between rebuilds. Bump the tag deliberately, not by drift.
# ---------------------------------------------------------------------------
FROM oven/bun:1.3.12 AS runtime

# A dedicated unprivileged account. The build never runs as root; the self-check in
# src/index.ts refuses to start if it finds itself at UID 0.
RUN useradd --create-home --shell /usr/sbin/nologin bundler
WORKDIR /home/bundler/app

# The promised base dependencies, baked from one shared list. --ignore-scripts here for
# the same reason it is enforced at runtime: an install script is arbitrary code.
COPY --from=manifest /gen/base-package.json ./package.json
RUN bun install --ignore-scripts

# The sidecar itself: the serve() entrypoint from src/index.ts. It runs when executed
# directly, so there is no separate bundle step to keep in sync.
COPY src ./src

# The image is publicly distributed, so it carries its license terms.
COPY LICENSE NOTICE ./
LABEL org.opencontainers.image.licenses="Apache-2.0"

# The working directory is the resolution root: `bun add` writes package.json, the
# lockfile and node_modules into it at runtime, and builds happen in .builds/ beneath
# it. It has to be owned by the account that does the work.
RUN chown -R bundler:bundler /home/bundler/app

USER bundler
ENV PORT=8081
EXPOSE 8081

# Cheap and dependency-free: the health route is the same one the startup self-check
# has already had to pass for the process to be listening at all. Exec form, so no
# shell is involved.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["bun", "--eval", "const port = process.env.PORT || 8081; const r = await fetch('http://127.0.0.1:' + port + '/health').catch(() => null); process.exit(r && r.ok ? 0 : 1)"]

CMD ["bun", "run", "src/index.ts"]
