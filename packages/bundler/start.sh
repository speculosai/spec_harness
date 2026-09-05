#!/usr/bin/env bash
# The process manager's entrypoint for a bare-metal deployment (no Docker).
#
# pm2 runs this so bun executes src/index.ts as the TRUE entrypoint: the server
# only starts under import.meta.main, which is false when pm2 wraps the module
# itself. Nothing else is configured here - the working directory is the
# resolution root, exactly as in the Dockerfile.
#
# This file used to exist only on the production box. It is the one thing a
# rebuild of that box could not have recovered from the repo.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.bun/bin:$PATH"
exec bun run src/index.ts
