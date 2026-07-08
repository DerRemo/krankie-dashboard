#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
BIN="$ROOT/dist/krankie-dashboard"
if [ ! -x "$BIN" ]; then
  echo "build first: bun run build" >&2
  exit 1
fi
mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$HOME/Library/Logs/krankie-dashboard"

# Pick up .env so this installer sees KRANKIE_BIN / KRANKIE_DB / TELEMETRYDECK_API_TOKEN
# the same way the app would. (The compiled binary under launchd reads its config from the
# plist EnvironmentVariables we render below, not from .env.)
if [ -f .env ]; then set -a; . ./.env; set +a; fi

# Resolve krankie to an ABSOLUTE path so the dashboard finds it regardless of the launchd
# agent's PATH. The bun-global shim lives in ~/.bun/bin, which isn't on launchd's default PATH.
KRANKIE_BIN_PATH="${KRANKIE_BIN:-krankie}"
if [ "$KRANKIE_BIN_PATH" = "krankie" ]; then
  KRANKIE_BIN_PATH=$(command -v krankie 2>/dev/null || true)
  [ -z "$KRANKIE_BIN_PATH" ] && [ -x "$HOME/.bun/bin/krankie" ] && KRANKIE_BIN_PATH="$HOME/.bun/bin/krankie"
  KRANKIE_BIN_PATH="${KRANKIE_BIN_PATH:-krankie}"
fi
KRANKIE_DB_PATH="${KRANKIE_DB:-$HOME/.krankie/krankie.db}"

# krankie is a Bun TS shim (#!/usr/bin/env bun); the agent needs bun on PATH to spawn it.
AGENT_PATH="$HOME/.bun/bin:$PATH"

install_plist() {
  local label="$1"
  local source="$2"
  local target="$HOME/Library/LaunchAgents/$label.plist"
  sed \
    -e "s|__BIN__|$BIN|" \
    -e "s|__CWD__|$ROOT|" \
    -e "s|__HOME__|$HOME|g" \
    -e "s|__KRANKIE_BIN__|$KRANKIE_BIN_PATH|" \
    -e "s|__KRANKIE_DB__|$KRANKIE_DB_PATH|" \
    -e "s|__PATH__|$AGENT_PATH|g" \
    "$source" > "$target"
  launchctl unload -w "$target" 2>/dev/null || true
  launchctl load -w "$target"
  echo "loaded $label"
}

install_plist "com.krankie.dashboard"          "launchd/com.krankie.dashboard.plist"
install_plist "com.krankie.dashboard.asc-sync" "launchd/com.krankie.dashboard.asc-sync.plist"

# Only run the hourly TelemetryDeck sync when a token is configured. Without it the agent
# would just wake hourly and log "TelemetryDeck not configured". Remove any stale agent too.
if [ -n "${TELEMETRYDECK_API_TOKEN:-}" ]; then
  install_plist "com.krankie.dashboard.td-sync" "launchd/com.krankie.dashboard.td-sync.plist"
else
  TD_TARGET="$HOME/Library/LaunchAgents/com.krankie.dashboard.td-sync.plist"
  launchctl unload -w "$TD_TARGET" 2>/dev/null || true
  rm -f "$TD_TARGET"
  echo "skipped td-sync (TELEMETRYDECK_API_TOKEN not set)"
fi
echo "→ http://localhost:3737"
