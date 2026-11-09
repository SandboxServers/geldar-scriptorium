#!/usr/bin/env bash
set -euo pipefail
marker="${GELDAR_KIT_MARKER:-/etc/geldar-kit}"
[ -f "$marker" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:?}"

payload="$(cat)"
tool="$(printf '%s' "$payload" | jq -r '.tool_name // "tool"')"
tool="${tool#mcp__geldar__}"
input="$(printf '%s' "$payload" | jq -c '.tool_input // {}' | cut -c1-200)"

line="$(printf -- '- %s %s: %s' "$(date +%H:%M)" "$tool" "$input" | tr -d '\000-\037\177')"
printf '%s\n' "$line" >> memory/journal/current.md
