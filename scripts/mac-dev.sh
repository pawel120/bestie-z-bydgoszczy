#!/usr/bin/env bash
# macOS attributes the system-audio permission to the "responsible" process. Started from a terminal that
# would be the terminal (which lacks NSAudioCaptureUsageDescription), so system audio would be silent.
# Instead: add the usage keys to the dev Electron.app and launch it via `open`, making it responsible itself.
set -euo pipefail
cd "$(dirname "$0")/.."
APP=node_modules/electron/dist/Electron.app
PLIST="$APP/Contents/Info.plist"
if ! /usr/libexec/PlistBuddy -c "Print :NSAudioCaptureUsageDescription" "$PLIST" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c "Add :NSAudioCaptureUsageDescription string 'Bestie nagrywa dźwięk systemu.'" "$PLIST"
  /usr/libexec/PlistBuddy -c "Set :NSMicrophoneUsageDescription 'Bestie nagrywa Twój głos.'" "$PLIST" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string 'Bestie nagrywa Twój głos.'" "$PLIST"
  codesign --force --deep --sign - "$APP"
fi
open -n -a "$PWD/$APP" --args "$PWD"
