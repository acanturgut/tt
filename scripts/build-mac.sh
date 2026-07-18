#!/usr/bin/env bash
# Build the macOS app AND inject the Liquid Glass icon in one step.
# Use this instead of `npm run tauri build` when you want the glass icon.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/dev-env.sh"
cd "$ROOT"

npm run tauri build -- "$@"

APP="$(ls -d src-tauri/target/release/bundle/macos/*.app 2>/dev/null | head -1)"
[ -n "$APP" ] || { echo "no .app produced by tauri build"; exit 1; }

"$ROOT/scripts/mac-liquid-icon.sh" "$APP"
echo "Done → $APP"
