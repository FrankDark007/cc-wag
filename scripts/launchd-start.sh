#!/bin/bash
# Wrapper script for launchd — sources .env then starts the gateway
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${ATLAS_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

# Source .env file
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

NODE_BIN="${NODE_BIN:-$(command -v node || echo /opt/homebrew/bin/node)}"
exec "$NODE_BIN" src/gateway.js
