#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
bun run build
./scripts/install-agent.sh >/dev/null
launchctl kickstart -k "gui/$(id -u)/com.krankie.dashboard"
# asc-sync and td-sync run on schedule, no kickstart needed in normal reload
echo "reloaded dashboard"
