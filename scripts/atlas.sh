#!/bin/bash
# Atlas — Monitor or start CC-WAG WhatsApp Gateway

# Check if daemon is already running
if launchctl list 2>/dev/null | grep -q com.flooddoctor.cc-wag; then
  echo "🔱 Atlas is running as a daemon. Tailing logs... (Ctrl+C to stop watching)"
  echo ""
  tail -f /Users/ghost/Projects/cc-wag/logs/gateway.log
else
  echo "🔱 Atlas daemon not running. Starting directly..."
  cd /Users/ghost/Projects/cc-wag && node src/gateway.js
fi
