#!/bin/bash
# Atlas — Monitor or start CC-WAG WhatsApp Gateway

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="${ATLAS_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

# Check if daemon is already running
if launchctl list 2>/dev/null | grep -q com.flooddoctor.cc-wag; then
  echo "🔱 Atlas is running as a daemon. Tailing logs... (Ctrl+C to stop watching)"
  echo ""
  tail -f "$PROJECT_ROOT/logs/gateway.log"
else
  echo "🔱 Atlas daemon not running. Starting directly..."
  cd "$PROJECT_ROOT" && node src/gateway.js
fi
