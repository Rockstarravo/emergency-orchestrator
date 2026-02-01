#!/usr/bin/env bash
set -euo pipefail

# Kill anything already bound to the ports we use
PORTS=(3000 3001 4001 4002 4003 4004 4010)
for p in "${PORTS[@]}"; do
  if lsof -ti tcp:"$p" >/dev/null 2>&1; then
    echo "Killing processes on port $p"
    lsof -ti tcp:"$p" | xargs kill -9 || true
  fi
done

trap 'kill 0' EXIT

echo "Starting incident service..."
(cd "$(dirname "$0")/../services/incident" && npm run dev) &

echo "Starting hospital service..."
(cd "$(dirname "$0")/../services/hospital" && npm run dev) &

echo "Starting ambulance service..."
(cd "$(dirname "$0")/../services/ambulance" && npm run dev) &

echo "Starting guardian service..."
(cd "$(dirname "$0")/../services/guardian" && npm run dev) &

echo "Starting realtime gateway..."
(cd "$(dirname "$0")/../agent" && npm run build:gateway && npm run dev:gateway) &

echo "Starting Emergency UI..."
(cd "$(dirname "$0")/../web/emergency" && npm run dev) &

echo "Starting agent daemon..."
(cd "$(dirname "$0")/../agent" && npm run daemon) &


wait
