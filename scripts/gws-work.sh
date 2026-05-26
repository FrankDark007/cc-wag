#!/bin/bash
# gws-work: Run gws commands against frankd@flooddoctorva.com
# Uses credential file swapping with shlock (macOS) for concurrency safety

GWS_DIR="$HOME/.config/gws"
WORK_DIR="$HOME/.config/gws-work"
LOCK_FILE="/tmp/gws-work.lock"

# Trap to restore credentials on interrupt
cleanup() {
  if [ -f "$GWS_DIR/credentials.enc.tmp" ]; then
    mv "$GWS_DIR/credentials.enc.tmp" "$GWS_DIR/credentials.enc"
    mv "$GWS_DIR/token_cache.json.tmp" "$GWS_DIR/token_cache.json" 2>/dev/null
    rm -rf "$GWS_DIR/cache"
  fi
  rm -f "$LOCK_FILE"
  exit 1
}
trap cleanup SIGINT SIGTERM

# Acquire lock using shlock (macOS native) with 30s timeout
TRIES=0
while ! shlock -f "$LOCK_FILE" -p $$; do
  TRIES=$((TRIES + 1))
  if [ $TRIES -ge 30 ]; then
    echo "Failed to acquire lock after 30s" >&2
    exit 1
  fi
  sleep 1
done

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

# Release lock
rm -f "$LOCK_FILE"

exit $EXIT_CODE
