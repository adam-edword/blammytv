#!/bin/bash
# Install workspace dependencies so lint / tests / typecheck work in
# Claude Code on the web sessions.
set -euo pipefail

# Only needed in remote (web) sessions; local dev manages its own deps.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# pnpm monorepo — installs the root + all workspace packages. `pnpm install`
# (not --frozen-lockfile) keeps the cached container friendly and is idempotent.
pnpm install
