#!/usr/bin/env bash
# Rebuilds Project Vault and replaces the /Applications copy, then relaunches
# it — the practical substitute for a real auto-updater. A real one
# (electron-updater) needs the app code-signed with a paid Apple Developer
# account to work on macOS; without that, this one-command rebuild+swap is
# the closest thing to "it just updates" for a personal, unsigned app.
set -euo pipefail

cd "$(dirname "$0")/.."

APP_NAME="Project Vault.app"
INSTALLED="/Applications/$APP_NAME"

echo "Quitting $APP_NAME if it's running..."
osascript -e 'quit app "Project Vault"' 2>/dev/null || true
sleep 1

echo "Building..."
npm run dist

BUILT_DIR=$(find dist -maxdepth 1 -type d -name 'mac*' | head -1)
if [ -z "$BUILT_DIR" ]; then
  echo "Error: no dist/mac* build output found." >&2
  exit 1
fi
BUILT="$BUILT_DIR/$APP_NAME"

echo "Installing to $INSTALLED..."
rm -rf "$INSTALLED"
cp -R "$BUILT" "$INSTALLED"

echo "Relaunching..."
open "$INSTALLED"

echo "Done — Project Vault updated and relaunched."
