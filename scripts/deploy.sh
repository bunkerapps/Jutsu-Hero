#!/usr/bin/env bash
# Deploy Jutsu Hero to bunkerapps hosting.
#
# WHY this exists: `npm run build` run directly on the shared-hosting
# server gets OOM-killed by the account's CloudLinux LVE memory limit
# during Vite's minify step. So we always build LOCALLY (unconstrained
# memory) and ship only the static output (../Builds/WebApp) to the
# server — the server never runs Vite/tsc itself.
#
# Usage:
#   scripts/deploy.sh          # build current working tree, sync, restart
#   scripts/deploy.sh --full   # force a full re-sync (all assets, not just
#                               # index.html/JS) — use after changing
#                               # anything under public/ (art, audio, wasm)
#
# NOTE: this builds whatever is currently on disk, uncommitted changes
# included. If you have unfinished/WIP changes you don't want to ship,
# `git stash -u` them first, run this script, then `git stash pop`.

set -euo pipefail

REMOTE_HOST="bunkerapps"
REMOTE_APP_DIR="/home/bunkerap/Jutsu-Hero"
REMOTE_BUILD_DIR="/home/bunkerap/Builds/WebApp"
LIVE_URL="https://jutsu-hero.bunkerapps.net/"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_BUILD_DIR="$(cd "$REPO_DIR/.." && pwd)/Builds/WebApp"

FULL_SYNC=false
if [[ "${1:-}" == "--full" ]]; then
  FULL_SYNC=true
fi

echo "==> Building locally (this can take a few seconds)..."
cd "$REPO_DIR"
npm run build

if [[ ! -f "$LOCAL_BUILD_DIR/index.html" ]]; then
  echo "ERROR: build did not produce $LOCAL_BUILD_DIR/index.html" >&2
  exit 1
fi

if $FULL_SYNC; then
  echo "==> Full sync: copying entire build directory to $REMOTE_HOST:$REMOTE_BUILD_DIR ..."
  ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_BUILD_DIR'"
  scp -rq "$LOCAL_BUILD_DIR/." "$REMOTE_HOST:$REMOTE_BUILD_DIR/"
else
  echo "==> Quick sync: copying index.html + JS bundle to $REMOTE_HOST:$REMOTE_BUILD_DIR ..."
  ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_BUILD_DIR/assets'"
  scp -q "$LOCAL_BUILD_DIR/index.html" "$REMOTE_HOST:$REMOTE_BUILD_DIR/index.html"
  scp -q "$LOCAL_BUILD_DIR"/assets/*.js "$REMOTE_HOST:$REMOTE_BUILD_DIR/assets/" 2>/dev/null || true
fi

echo "==> Restarting app (Passenger) on $REMOTE_HOST..."
ssh "$REMOTE_HOST" "touch '$REMOTE_APP_DIR/tmp/restart.txt'"

echo "==> Waiting for app to come back up..."
sleep 3

HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$LIVE_URL")
if [[ "$HTTP_CODE" == "200" ]]; then
  echo "==> OK: $LIVE_URL responded 200"
else
  echo "==> WARNING: $LIVE_URL responded $HTTP_CODE — check manually" >&2
fi

echo "Done."
