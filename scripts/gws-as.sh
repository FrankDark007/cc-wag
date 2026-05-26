#!/bin/bash
# gws-as.sh — Run gws commands as a specific account
# Usage: gws-as.sh <account> <gws commands...>
# Accounts: work, personal

ACCOUNT="$1"
shift

case "$ACCOUNT" in
  work)     CONFIG_DIR="$HOME/.config/gws-work" ;;
  personal) CONFIG_DIR="$HOME/.config/gws-personal" ;;
  *)
    echo "Usage: gws-as.sh <work|personal> <gws commands...>" >&2
    exit 1
    ;;
esac

exec env \
  GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file \
  GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$CONFIG_DIR" \
  gws "$@"
