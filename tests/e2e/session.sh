#!/usr/bin/env bash
set -uo pipefail

LOG=$E2E_WORK/shell.log
gjs -m "$E2E_BUILD/mock-session.js" &
MOCK=$!
gnome-shell --headless --virtual-monitor 1280x800 --no-x11 --wayland-display "suspend-inhibitors-e2e-$$" >"$LOG" 2>&1 &
SHELL_PID=$!

cleanup() {
    kill "$SHELL_PID" "$MOCK" 2>/dev/null
    wait "$SHELL_PID" "$MOCK" 2>/dev/null
}
trap cleanup EXIT

gjs -m "$E2E_BUILD/driver.js"
STATUS=$?

if grep -E 'JS ERROR|JS WARNING|Unhandled promise rejection' "$LOG" | grep -q "$E2E_UUID"; then
    echo "not ok - extension logged errors:"
    grep -E -A8 'JS ERROR|JS WARNING|Unhandled promise rejection' "$LOG"
    STATUS=1
fi
if [ "$STATUS" -ne 0 ]; then
    echo "--- shell log (last 40 lines)"
    tail -40 "$LOG"
fi
echo "Screenshots: $E2E_SCREENSHOTS"
exit "$STATUS"
