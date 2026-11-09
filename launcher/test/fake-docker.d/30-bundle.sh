# Fake docker: the bundle and verify roles, and a kill that really stops a named fake container.
# FAKE_BUNDLE_HANG=1: the bundle role ignores SIGPIPE and blocks after writing. FAKE_BUNDLE_SLEEP=n
# and FAKE_VERIFY_SLEEP=n: the role sleeps n seconds first. FAKE_VERIFY_STDOUT / FAKE_VERIFY_RC
# replace the verify role's answer.

# Waits n seconds with SIGPIPE ignored; `docker kill <name>` ends the wait.
fake_hang() {
  mkdir -p "$FAKE_DOCKER_ROOT/pids"
  trap '' PIPE
  sleep "$1" &
  echo "$!" > "$FAKE_DOCKER_ROOT/pids/${FAKE_NAME:-none}"
  [ -z "${FAKE_PIDFILE:-}" ] || echo "$!" >> "$FAKE_PIDFILE"
  wait
}

fake_kill() {
  f="$FAKE_DOCKER_ROOT/pids/${1:-none}"
  if [ -f "$f" ]; then
    kill "$(cat "$f")" 2> /dev/null
    rm -f "$f"
  fi
  return 0
}

fake_role_bundle() {
  [ -z "${FAKE_BUNDLE_SLEEP:-}" ] || fake_hang "$FAKE_BUNDLE_SLEEP"
  trap '' PIPE
  fake_exec_script "$@"
  rc=$?
  [ -z "${FAKE_BUNDLE_HANG:-}" ] || fake_hang 600
  return $rc
}

fake_role_verify() {
  [ -z "${FAKE_VERIFY_SLEEP:-}" ] || fake_hang "$FAKE_VERIFY_SLEEP"
  if [ -n "${FAKE_VERIFY_STDOUT+x}" ]; then
    printf '%s\n' "$FAKE_VERIFY_STDOUT"
    return "${FAKE_VERIFY_RC:-0}"
  fi
  [ "$1" = geldar-verify ] || return 99
  shift
  n=$#
  i=0
  while [ $i -lt $n ]; do
    a=$1
    shift
    [ "$a" != /in/bundle.bundle ] || a=$FAKE_BUNDLE
    set -- "$@" "$a"
    i=$((i + 1))
  done
  cd "$here/../.." || return 99
  node packages/verify/src/cli.ts "$@"
}
