#!/usr/bin/env bash
# Stop hook: when a play session is about to end, asks the character once
# whether what it did or learned changes its goals. Claude Code sends
# "stop_hook_active": true on the stop that follows a blocked one, so the hook
# lets that stop through: the question comes once per session. A tidy session
# (memory/journal/pending.md present) and any mode other than play are not
# asked. Every error exits 0 silently, and nothing is written.
set -uo pipefail
marker="${GELDAR_KIT_MARKER:-/etc/geldar-kit}"
[ -f "$marker" ] || exit 0
project="${CLAUDE_PROJECT_DIR:-}"
[ -d "$project" ] || exit 0

# Only the play loop asks. An unset or empty mode counts as play.
case "${GELDAR_MODE:-play}" in
  play) ;;
  *) exit 0 ;;
esac

# The tidier's session is not asked.
if [ -f "$project/memory/journal/pending.md" ]; then
  exit 0
fi

# Bounded read, as session-start.sh does it: stdin is the hook's JSON input.
read -r -t 1 -d '' input || true
if printf '%s' "${input:-}" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

printf '%s\n' '{"decision":"block","reason":"Before you stop: if what you did or found out changes what you want, rewrite memory/goals.md (ranked, with your reasons) and save it with commit_memory. If nothing changed, say \"No change to my goals.\" and stop."}'
exit 0
