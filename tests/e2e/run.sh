#!/usr/bin/env bash
# Runs the end-to-end suite in a disposable headless GNOME Shell with its own
# session bus, settings and extension directory. Suspend is intercepted inside
# that shell, but the logind tests take real (short-lived) inhibitor locks.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
UUID=$(node -p "require('$ROOT/src/metadata.json').uuid")
HELPER_UUID=$(node -p "require('$ROOT/tests/e2e/helper/metadata.json').uuid")
WORK=$(mktemp -d -t suspend-inhibitors-e2e.XXXXXX)
trap 'rm -rf "$WORK"' EXIT

EXTENSIONS=$WORK/data/gnome-shell/extensions
mkdir -p "$EXTENSIONS/$HELPER_UUID" "$WORK/config/glib-2.0/settings" "$WORK/cache"
cp -r "$ROOT/dist" "$EXTENSIONS/$UUID"
cp "$ROOT/build/e2e/helper/extension.js" "$ROOT/tests/e2e/helper/metadata.json" "$EXTENSIONS/$HELPER_UUID/"

cat > "$WORK/config/glib-2.0/settings/keyfile" <<KEYFILE
[org/gnome/shell]
enabled-extensions=['$HELPER_UUID', '$UUID']
disable-user-extensions=false
welcome-dialog-last-shown-version='999'

[org/gnome/desktop/interface]
color-scheme='prefer-dark'
KEYFILE

export E2E_WORK=$WORK
export E2E_UUID=$UUID
export E2E_BUILD=$ROOT/build/e2e
export E2E_SCREENSHOTS=$ROOT/build/e2e/screenshots
mkdir -p "$E2E_SCREENSHOTS"

XDG_DATA_HOME=$WORK/data XDG_CONFIG_HOME=$WORK/config XDG_CACHE_HOME=$WORK/cache GSETTINGS_BACKEND=keyfile \
    dbus-run-session -- "$ROOT/tests/e2e/session.sh"
