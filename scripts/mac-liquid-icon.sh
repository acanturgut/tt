#!/usr/bin/env bash
# Inject the Liquid Glass app icon (src-tauri/tt.icon, authored in Icon Composer)
# into an already-built .app bundle. Tauri ships a classic .icns; macOS 26 needs
# the compiled asset catalog + CFBundleIconName to render the glass icon.
#
# Usage: scripts/mac-liquid-icon.sh /path/to/tt.app
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICON="$ROOT/src-tauri/tt.icon"
NAME="tt"
APP="${1:?usage: mac-liquid-icon.sh /path/to/App.app}"

[ -d "$ICON" ] || { echo "missing $ICON"; exit 1; }
[ -d "$APP" ] || { echo "no app bundle at $APP"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Compile the .icon -> Assets.car (+ fallback .icns) for macOS 26.
xcrun actool "$ICON" \
  --compile "$TMP" \
  --app-icon "$NAME" \
  --platform macosx \
  --minimum-deployment-target 26.0 \
  --target-device mac \
  --output-partial-info-plist "$TMP/partial.plist" >/dev/null

RES="$APP/Contents/Resources"
mkdir -p "$RES"
cp "$TMP/Assets.car" "$RES/Assets.car"
[ -f "$TMP/$NAME.icns" ] && cp "$TMP/$NAME.icns" "$RES/$NAME.icns"

PLIST="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconFile" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string $NAME" "$PLIST"
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleIconName string $NAME" "$PLIST"

# Re-sign (ad-hoc) so the modified bundle still launches.
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
# Nudge the icon cache.
touch "$APP"

echo "✓ Injected Liquid Glass icon into $APP"
