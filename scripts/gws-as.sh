#!/bin/bash
# gws-as.sh — Run gws commands as a specific account
# Usage: gws-as.sh <account> <gws commands...>
# Accounts: work, personal, atlas

ACCOUNT="$1"
shift

GWS_DIR="/Users/ghost/.config/gws"
LOCK_FILE="/tmp/gws-as.lock"

case "$ACCOUNT" in
  work)    SRC_DIR="/Users/ghost/.config/gws-work" ;;
  personal) SRC_DIR="/Users/ghost/.config/gws-personal" ;;
  atlas)   SRC_DIR="/Users/ghost/.config/gws-atlas" ;;
  *)
    echo "Usage: gws-as.sh <work|personal|atlas> <gws commands...>" >&2
    exit 1
    ;;
esac

cleanup() {
  if [ -f "$GWS_DIR/credentials.enc.bak" ]; then
    mv "$GWS_DIR/credentials.enc.bak" "$GWS_DIR/credentials.enc"
    rm -f "$GWS_DIR/token_cache.json"
    rm -rf "$GWS_DIR/cache"
  fi
  rm -f "$LOCK_FILE"
}
trap cleanup SIGINT SIGTERM EXIT

# Acquire lock with 30s timeout
TRIES=0
while ! shlock -f "$LOCK_FILE" -p $$; do
  TRIES=$((TRIES + 1))
  if [ $TRIES -ge 30 ]; then
    echo "Failed to acquire lock after 30s" >&2
    exit 1
  fi
  sleep 1
done

# Swap credentials
cp "$GWS_DIR/credentials.enc" "$GWS_DIR/credentials.enc.bak"
cp "$SRC_DIR/credentials.enc" "$GWS_DIR/credentials.enc"
rm -f "$GWS_DIR/token_cache.json"
rm -rf "$GWS_DIR/cache"

# Run command
gws "$@"
EXIT_CODE=$?

# Restore original (handled by trap/cleanup)
exit $EXIT_CODE
