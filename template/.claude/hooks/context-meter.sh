#!/usr/bin/env bash
# PreToolUse hook: tells a tired worker, and the planner, to stop at a safe point.
# It reads the size of the last assistant turn from the transcript tail, never
# the network, and never logs tool input. Every error allows the call: it
# prints nothing and exits 0.
set -uo pipefail

worker_soft="${GELDAR_METER_WORKER_SOFT:-70000}"
worker_hard="${GELDAR_METER_WORKER_HARD:-90000}"
planner_line="${GELDAR_METER_PLANNER_LINE:-80000}"
for n in "$worker_soft" "$worker_hard" "$planner_line"; do
  case "$n" in '' | *[!0-9]*) exit 0 ;; esac
done

input="$(cat 2>/dev/null)" || exit 0
[ -n "$input" ] || exit 0

# Parser order: jq, then node, then plain grep/sed. GELDAR_METER_PARSER forces
# one (the tests use it); an unknown value is ignored.
parser=""
case "${GELDAR_METER_PARSER:-}" in
  jq | node | sed) parser="${GELDAR_METER_PARSER}" ;;
  *)
    if command -v jq > /dev/null 2>&1; then parser=jq
    elif command -v node > /dev/null 2>&1; then parser=node
    else parser=sed; fi
    ;;
esac

# The first string value of a key in a JSON text on stdin; empty when absent.
sed_field() {
  grep -o "\"$1\" *: *\"[^\"]*\"" | head -n 1 | sed 's/^[^:]*: *"//; s/"$//'
}

# Prints session_id, transcript_path, agent_id: one per line, empty when absent.
read_fields() {
  case "$parser" in
    jq)
      printf '%s' "$input" | jq -r '[.session_id, .transcript_path, .agent_id] | map(if type == "string" then . else "" end) | .[]'
      ;;
    node)
      printf '%s' "$input" | node -e '
        let s = "";
        process.stdin.on("data", (d) => (s += d));
        process.stdin.on("end", () => {
          const j = JSON.parse(s);
          const f = (k) => (typeof j[k] === "string" ? j[k] : "");
          console.log([f("session_id"), f("transcript_path"), f("agent_id")].join("\n"));
        });'
      ;;
    sed)
      for k in session_id transcript_path agent_id; do
        v="$(printf '%s' "$input" | sed_field "$k")"
        printf '%s\n' "$v"
      done
      ;;
  esac
}

# Prints "<size>\t<model>" for one assistant line given as $1: the sum of the
# three usage numbers, and the model name.
read_usage() {
  case "$parser" in
    jq)
      printf '%s' "$1" | jq -r '[((.message.usage.input_tokens // 0) + (.message.usage.cache_read_input_tokens // 0) + (.message.usage.cache_creation_input_tokens // 0)), (.message.model // "")] | @tsv'
      ;;
    node)
      printf '%s' "$1" | node -e '
        let s = "";
        process.stdin.on("data", (d) => (s += d));
        process.stdin.on("end", () => {
          const m = JSON.parse(s).message || {};
          const u = m.usage || {};
          const n = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
          console.log(n + "\t" + (m.model || ""));
        });'
      ;;
    sed)
      local total=0 v k
      for k in input_tokens cache_read_input_tokens cache_creation_input_tokens; do
        v="$(printf '%s' "$1" | grep -o "\"$k\" *: *[0-9]*" | head -n 1 | sed 's/^[^:]*: *//')"
        case "$v" in *[!0-9]*) return 1 ;; esac
        total=$((total + ${v:-0}))
      done
      printf '%s\t%s\n' "$total" "$(printf '%s' "$1" | sed_field model)"
      ;;
  esac
}

deny() {
  local reason="$1"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
  exit 0
}

# A marker file that stands for "already warned". Returns 1 when it already
# existed or cannot be made, so a broken temp folder never repeats a warning.
first_time() {
  local dir="${TMPDIR:-/tmp}" id
  id="$(printf '%s' "$1" | tr -c 'A-Za-z0-9_-' '_')"
  [ -n "$id" ] || return 1
  [ -e "$dir/geldar-meter-$id" ] && return 1
  : > "$dir/geldar-meter-$id" 2> /dev/null || return 1
  return 0
}

fields="$(read_fields 2> /dev/null)" || exit 0
{
  IFS= read -r session_id
  IFS= read -r transcript_path
  IFS= read -r agent_id
} <<< "$fields"
[ -n "${transcript_path:-}" ] || exit 0

file="$transcript_path"
if [ -n "${agent_id:-}" ]; then
  file="${transcript_path%.jsonl}/subagents/agent-${agent_id}.jsonl"
fi
[ -f "$file" ] && [ -r "$file" ] || exit 0

line="$(tail -n 200 "$file" 2> /dev/null | grep -E '"type" *: *"assistant"' | tail -n 1)"
[ -n "$line" ] || exit 0
usage="$(read_usage "$line" 2> /dev/null)" || exit 0
size="${usage%%$'\t'*}"
model="${usage#*$'\t'}"
case "$size" in '' | *[!0-9]*) exit 0 ;; esac
model="$(printf '%s' "$model" | tr 'A-Z' 'a-z')"

if [ -n "${agent_id:-}" ]; then
  case "$model" in *haiku*) ;; *) exit 0 ;; esac
  if [ "$size" -ge "$worker_hard" ]; then
    deny "Stop now and send back your report: what is done, what is left, the one next step."
  fi
  if [ "$size" -ge "$worker_soft" ] && first_time "$agent_id"; then
    deny "You are worn out. Get somewhere safe and send back your report."
  fi
else
  case "$model" in *sonnet*) ;; *) exit 0 ;; esac
  [ -n "${session_id:-}" ] || exit 0
  if [ "$size" -ge "$planner_line" ] && first_time "$session_id"; then
    deny "Before you rest, be sheltered: no errand half-done, and not in danger. If not, get safe first. Then write your resume note to memory/journal/handoff.md and carry on fresh."
  fi
fi
exit 0
