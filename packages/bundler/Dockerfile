# @speculos-harness/bundler - the locked-down build-service container.
#
# Published as `speculos/harness-bundler`. This is the one component that executes
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

FROM oven/bun:1 AS base

# A dedicated unprivileged account. The build never runs as root.
RUN useradd --create-home --shell /usr/sbin/nologin bundler
WORKDIR /home/bundler/app

# The promised base dependencies, baked from one shared list. --ignore-scripts here for
# the same reason it is enforced at runtime.
COPY base-package.json ./package.json
RUN bun install --ignore-scripts

# The sidecar itself: the serve() entrypoint from src/index.ts.
COPY --chown=bundler:bundler dist ./dist

USER bundler
EXPOSE 8081

# TODO: the build steps that emit dist/serve.js and the generated base-package.json from
# the shared library list, so the image and the system prompt's LIBRARIES block cannot
# drift. The entrypoint runs the startup self-check first, then starts the server.
CMD ["bun", "dist/serve.js"]
