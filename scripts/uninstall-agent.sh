#!/bin/bash
set -euo pipefail
for label in com.krankie.dashboard com.krankie.dashboard.asc-sync com.krankie.dashboard.td-sync; do
  target="$HOME/Library/LaunchAgents/$label.plist"
  if [ -f "$target" ]; then
    launchctl unload -w "$target" 2>/dev/null || true
    rm -f "$target"
    echo "removed $label"
  fi
done
