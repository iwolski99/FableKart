#!/usr/bin/env bash
# Double-click this file to launch FableKart (macOS/Linux).
# First run installs dependencies automatically; every run after that is instant.
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "First run — installing dependencies (this can take a minute)..."
  npm install
fi

echo ""
echo "Starting FableKart... a browser tab will open automatically."
echo "Keep this window open while you play. Close it (or press Ctrl+C) to stop."
echo ""

( sleep 2
  if command -v open >/dev/null 2>&1; then open http://localhost:5173/
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:5173/
  fi
) &

npm run dev
