#!/bin/bash
# gws-work: Run gws commands against frankd@flooddoctorva.com
# Uses credential file swapping with flock for concurrency safety

GWS_DIR="/Users/ghost/.config/gws"
WORK_DIR="/Users/ghost/.config/gws-work"
LOCK_FILE="/tmp/gws-work.lock"

# Ensure lock file exists
touch "$LOCK_FILE"

# Trap to restore credentials on interrupt
cleanup() {
  if [ -f "$GWS_DIR/credentials.enc.tmp" ]; then
    mv "$GWS_DIR/credentials.enc.tmp" "$GWS_DIR/credentials.enc"
    mv "$GWS_DIR/token_cache.json.tmp" "$GWS_DIR/token_cache.json" 2>/dev/null
    rm -rf "$GWS_DIR/cache"
  fi
  exit 1
}
trap cleanup SIGINT SIGTERM

# Use flock to prevent concurrent credential swaps
(
  flock -w 30 200 || { echo "Failed to acquire lock after 30s" >&2; exit 1; }

  # Swap to work credentials
  cp "$GWS_DIR/credentials.enc" "$GWS_DIR/credentials.enc.tmp"
  cp "$GWS_DIR/token_cache.json" "$GWS_DIR/token_cache.json.tmp" 2>/dev/null

  cp "$WORK_DIR/credentials.enc" "$GWS_DIR/credentials.enc"
  rm -f "$GWS_DIR/token_cache.json"
  rm -rf "$GWS_DIR/cache"

  # Run command
  gws "$@"
  EXIT_CODE=$?

  # Restore personal immediately
  mv "$GWS_DIR/credentials.enc.tmp" "$GWS_DIR/credentials.enc"
  mv "$GWS_DIR/token_cache.json.tmp" "$GWS_DIR/token_cache.json" 2>/dev/null
  rm -rf "$GWS_DIR/cache"

  exit $EXIT_CODE
) 200>"$LOCK_FILE"
