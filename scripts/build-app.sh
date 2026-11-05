#!/usr/bin/env bash
# Builds build/Bestie.app. Signs with the first "Apple Development" identity if available
# (keeps mic / screen-recording permissions and the keychain entry across rebuilds), else ad-hoc.
set -euo pipefail
cd "$(dirname "$0")/.."

swift build -c release
APP=build/Bestie.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$(swift build -c release --show-bin-path)/Bestie" "$APP/Contents/MacOS/Bestie"
cp Resources/Info.plist "$APP/Contents/Info.plist"

IDENTITY="${SIGN_IDENTITY:-$(security find-identity -v -p codesigning | awk -F'"' '/Apple Development/ {print $2; exit}')}"
codesign --force --sign "${IDENTITY:--}" "$APP"
echo "Built $APP (signed: ${IDENTITY:-ad-hoc})"
