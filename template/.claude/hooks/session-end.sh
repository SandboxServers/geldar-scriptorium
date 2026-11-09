#!/usr/bin/env bash
set -uo pipefail
marker="${GELDAR_KIT_MARKER:-/etc/geldar-kit}"
[ -f "$marker" ] || exit 0
project="${CLAUDE_PROJECT_DIR:-}"
[ -d "$project" ] || exit 0
cd "$project" || exit 0

geldar-git commit --root "$project" --if-changed --message "session end: unsaved memory" || true
exit 0
