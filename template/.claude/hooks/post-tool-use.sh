#!/usr/bin/env bash
set -uo pipefail
marker="${GELDAR_KIT_MARKER:-/etc/geldar-kit}"
[ -f "$marker" ] || exit 0
project="${CLAUDE_PROJECT_DIR:-}"
[ -d "$project" ] || exit 0

# Hook input may be empty or malformed: then nothing is written and we exit 0.
payload="$(cat)"
[ -n "$payload" ] || exit 0

# One journal line: time, tool name (40 characters), tool input (200 characters),
# 240 characters in all. jq strips control characters and counts characters, so
# nothing is split mid-character. A payload without a tool name writes nothing.
line="$(printf '%s' "$payload" | jq -r --arg time "$(date +%H:%M)" '
  def clean: gsub("[[:cntrl:]]"; "");
  (.tool_name | strings | sub("^mcp__geldar__"; "") | clean | .[0:40]) as $tool
  | select($tool != "")
  | ((.tool_input // {}) | tostring | clean | .[0:200]) as $input
  | "- \($time) \($tool): \($input)" | clean | .[0:240]
' 2>/dev/null || true)"
[ -n "$line" ] || exit 0

mkdir -p "$project/memory/journal" 2>/dev/null || exit 0
printf '%s\n' "$line" 2>/dev/null >> "$project/memory/journal/current.md" || true
exit 0
