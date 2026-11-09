#!/usr/bin/env bash
set -euo pipefail
marker="${GELDAR_KIT_MARKER:-/etc/geldar-kit}"
[ -f "$marker" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:?}"

geldar-git commit --root "$CLAUDE_PROJECT_DIR" --if-changed --message "session end: unsaved memory" || true
exit 0
