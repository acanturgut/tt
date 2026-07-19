#!/usr/bin/env bash
# Run the tt app. Fixes the non-interactive shell PATH (nvm node + cargo
# aren't loaded), then launches the native Tauri Mac app by default.
#   ./dev.sh        native Mac app (tauri dev)
#   ./dev.sh web    vite dev server only (browser at http://localhost:1420)
set -e
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$(ls -d "$HOME"/.nvm/versions/node/*/bin | tail -1):$PATH"

case "$1" in
  web) exec ./node_modules/.bin/vite --host ;;
  *)   exec ./node_modules/.bin/tauri dev ;;
esac
