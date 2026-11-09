#!/bin/sh
# A fake docker for the launcher tests. It logs every call (one line, tab-separated argv, to
# $FAKE_DOCKER_ROOT/calls.log), then acts. Roles and subcommands live in fake-docker.d/NN-*.sh:
# a subcommand X is the shell function fake_X, a `docker run` role R is fake_role_R (dashes
# become underscores). Anything not defined exits 99 so a missing piece fails loudly.
here=$(cd "$(dirname "$0")" && pwd)
: "${FAKE_DOCKER_ROOT:?FAKE_DOCKER_ROOT is not set}"
mkdir -p "$FAKE_DOCKER_ROOT/vol" "$FAKE_DOCKER_ROOT/scratch"

tab=$(printf '\t')
line=""
sep=""
for a in "$@"; do
  esc=$(printf '%s' "$a" | awk 'BEGIN { ORS = "" } NR > 1 { print "\\n" } { print }')
  line="$line$sep$esc"
  sep=$tab
done
printf '%s\n' "$line" >> "$FAKE_DOCKER_ROOT/calls.log"

fake_version() {
  echo "Docker version 29.1.3 (fake)"
}

fake_info() {
  echo linux
}

fake_compose() {
  if [ "${1:-}" = "version" ]; then
    echo "Docker Compose version v2.40.3 (fake)"
    return 0
  fi
  echo "fake docker: unsupported compose command: ${1:-}" >&2
  return 99
}

fake_kill() {
  return 0
}

fake_rm() {
  return 0
}

for f in "$here"/fake-docker.d/*.sh; do
  # shellcheck disable=SC1090
  . "$f"
done

cmd=${1:-}
[ $# -eq 0 ] || shift
fn="fake_$(printf '%s' "$cmd" | tr -c 'A-Za-z0-9' '_')"
if [ -n "$cmd" ] && type "$fn" > /dev/null 2>&1; then
  "$fn" "$@"
  exit $?
fi
echo "fake docker: unsupported subcommand: $cmd" >&2
exit 99
