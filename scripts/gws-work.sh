#!/bin/bash
# gws-work: Run gws commands against frankd@flooddoctorva.com
# Uses direct config-dir approach (no credential swapping needed)

exec env \
  GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file \
  GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$HOME/.config/gws-work" \
  gws "$@"
