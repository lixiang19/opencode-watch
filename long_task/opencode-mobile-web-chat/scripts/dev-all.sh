#!/usr/bin/env bash

set -euo pipefail

WEB_PORT="${VITE_PORT:-5173}"
SERVER_PORT="${OPENCODE_SERVER_PORT:-4096}"
SERVER_ROOT="${OPENCODE_SERVER_ROOT:-$HOME}"

cleanup() {
  jobs -pr | xargs kill 2>/dev/null || true
}

trap cleanup EXIT INT TERM

if ! command -v opencode >/dev/null 2>&1; then
  echo "opencode 未安装，无法启动服务。" >&2
  exit 1
fi

(
  cd "$SERVER_ROOT"
  opencode serve \
    --hostname=127.0.0.1 \
    --port="$SERVER_PORT" \
    --cors "http://127.0.0.1:${WEB_PORT}" \
    --cors "http://localhost:${WEB_PORT}"
) &

npm run dev -- --host 0.0.0.0 --port "$WEB_PORT" &

wait
