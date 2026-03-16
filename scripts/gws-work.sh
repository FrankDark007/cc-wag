#!/bin/bash
# gws-work: Run gws commands against frankd@flooddoctorva.com
# Uses GOOGLE_WORKSPACE_CLI_TOKEN env var to bypass credential file swapping
# Token is fetched fresh each time from the work credentials

GWS_DIR="/Users/ghost/.config/gws"
WORK_DIR="/Users/ghost/.config/gws-work"

# Get a fresh access token from work credentials
# Temporarily swap, get token, swap back
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
