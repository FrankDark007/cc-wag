#!/bin/bash
# Wrapper script for launchd — sources .env then starts the gateway
set -euo pipefail

cd /Users/ghost/Projects/cc-wag

# Source .env file
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

exec /opt/homebrew/bin/node /Users/ghost/Projects/cc-wag/src/gateway.js
