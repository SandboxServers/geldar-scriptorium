#!/usr/bin/env bash
# Proves the runner account is confined (F-05b). Run as root on the VM, after install-wrapper.sh.
# Each probe runs as geldar-runner through runuser and prints "ok <probe>" or "FAIL <probe>". A
# probe that must be refused is ok only when the runner is refused, and only when its target exists
# (checked as root first, so a missing target cannot pass the probe by accident). F-08 step 1 runs
# this on the VM.
# Usage: verify-confinement.sh
# Exit codes: 0 every probe is ok, 1 a probe is FAIL, 2 not root.
set -euo pipefail
umask 022

runner=geldar-runner
wrapper=/usr/local/sbin/geldar-fleet-run
# The paths the probes aim at. The test rewrites these lines to a temp world; on the VM they are real.
readonly CONF_SHADOW=/etc/shadow
readonly CONF_HOMES=/home
readonly CONF_TOKEN_DIR=/etc/geldar/tokens
readonly CONF_KEY_DIR=/etc/geldar/keys
readonly CONF_LOGIN=/home/geldar/.claude/.credentials.json
readonly CONF_LOG=/var/log/geldar-hosts.log
fails=0

[ "$(id -u)" -eq 0 ] || { echo "verify-confinement: must run as root" >&2; exit 2; }
id -u "$runner" >/dev/null 2>&1 || { echo "FAIL runner account $runner is missing"; exit 1; }

# report STATUS PROBE prints one line and counts a FAIL.
report() {
  echo "$1 $2"
  if [ "$1" != ok ]; then fails=$((fails + 1)); fi
}

# as_runner runs its arguments as the runner account, through runuser.
as_runner() {
  runuser -u "$runner" -- "$@"
}

# refused PROBE TARGET CMD...: the runner must be refused, so CMD must exit non-zero. TARGET is the
# path the probe aims at; as root it must exist (an empty TARGET skips the check). Exit 127 means
# the command is missing, and 125 and 126 mean runuser itself could not run it: each is a FAIL, so a
# probe must not pass because its tool or runuser is broken.
refused() {
  local probe=$1 target=$2 rc=0
  shift 2
  if [ -n "$target" ] && [ ! -e "$target" ]; then
    report FAIL "$probe (precondition: $target missing)"
    return 0
  fi
  as_runner "$@" >/dev/null 2>&1 || rc=$?
  case $rc in
    0 | 125 | 126 | 127) report FAIL "$probe" ;;
    *) report ok "$probe" ;;
  esac
}

# docker_refused: the runner must be refused by the Docker socket, and the refusal must say so in
# stderr. Any other failure, such as a missing docker, is a FAIL.
docker_refused() {
  local err rc=0
  err=$(as_runner docker ps 2>&1 >/dev/null) || rc=$?
  if [ "$rc" -ne 0 ] && printf '%s\n' "$err" | grep -qi 'permission denied'; then
    report ok "docker ps"
  else
    report FAIL "docker ps"
  fi
}

# allowed PROBE CMD...: the runner must be allowed, so CMD must exit 0.
allowed() {
  local probe=$1 rc=0
  shift
  as_runner "$@" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq 0 ]; then report ok "$probe"; else report FAIL "$probe"; fi
}

# wrapper_refused PROBE ARGS...: the wrapper, run through sudo, must exit 2 and start nothing. The
# refusal message on stderr is the sentinel: the wrapper prints it before it starts anything, so a
# bare exit 2 without it is a FAIL.
wrapper_refused() {
  local probe=$1 rc=0 err
  shift
  err=$(as_runner sudo -n "$wrapper" "$@" 2>&1 >/dev/null) || rc=$?
  if [ "$rc" -eq 2 ] && printf '%s\n' "$err" | grep -q '^geldar-fleet-run: '; then
    report ok "$probe"
  else
    report FAIL "$probe"
  fi
}

# positive_control PROBE: a good id reaches the wrapper, so the run exits 0 or 6, never 2. A wrapper
# that refused everything would pass every negative probe; this keeps the negatives honest.
positive_control() {
  local rc=0
  as_runner sudo -n "$wrapper" check-secrets ag-probe-00 >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq 0 ] || [ "$rc" -eq 6 ]; then report ok "$1"; else report FAIL "$1"; fi
}

# sudo_lists_wrapper_only: the runner's sudo list holds exactly one command line in all, and it is
# the wrapper with NOPASSWD. A second rule, with or without a password, is a FAIL.
sudo_lists_wrapper_only() {
  local out cmds
  out=$(as_runner sudo -n -l 2>/dev/null || true)
  cmds=$(printf '%s\n' "$out" | grep -c '^ *(.*) ' || true)
  if [ "$cmds" -eq 1 ] &&
    printf '%s\n' "$out" | grep -q "^ *(.*) NOPASSWD: $wrapper\$"; then
    report ok "sudo -n -l"
  else
    report FAIL "sudo -n -l"
  fi
}

# groups_clean: the runner is in none of docker, sudo or wheel.
groups_clean() {
  local names g bad=""
  names=$(as_runner id -nG 2>/dev/null || true)
  [ -n "$names" ] || bad=1
  for g in $names; do
    case $g in
      docker | sudo | wheel) bad=1 ;;
    esac
  done
  if [ -z "$bad" ]; then
    report ok "id -nG has no docker, sudo or wheel"
  else
    report FAIL "id -nG has no docker, sudo or wheel"
  fi
}

# unit_confinement: the unit's own settings, as systemd reports them. NoNewPrivileges must be no,
# because the runner reaches the wrapper through setuid sudo.
unit_confinement() {
  local out probe="systemctl show geldar-runner -p ProtectSystem,ReadWritePaths,NoNewPrivileges"
  out=$(systemctl show geldar-runner -p ProtectSystem,ReadWritePaths,NoNewPrivileges 2>/dev/null ||
    true)
  if printf '%s\n' "$out" | grep -qx 'NoNewPrivileges=no' &&
    printf '%s\n' "$out" | grep -qx 'ProtectSystem=strict'; then
    report ok "$probe"
  else
    report FAIL "$probe"
  fi
}

# One real file of each kind is picked as root; the runner is then refused on that exact path. An
# empty pick falls back to the directory's name in the precondition message.
token=$(find "$CONF_TOKEN_DIR" -mindepth 1 -maxdepth 1 -type f 2>/dev/null | head -n 1 || true)
key=$(find "$CONF_KEY_DIR" -mindepth 1 -maxdepth 1 -type f 2>/dev/null | head -n 1 || true)

# The positive control: the runner can run a command at all, so the refused probes below are not
# passing because runuser is broken.
allowed "runuser -u $runner -- true" true

# The runner reads no secret, no home directory and no shadow file, and has no sudo beyond the
# wrapper.
refused "test -r /etc/shadow" "$CONF_SHADOW" test -r "$CONF_SHADOW"
# Every entry under /home is probed on its own. With no entry at all the probe fails on its
# precondition, so an empty /home cannot pass by accident.
homes=0
while IFS= read -r home; do
  homes=$((homes + 1))
  refused "ls /home/<each entry>" "$home" ls "$home"
done < <(find "$CONF_HOMES" -mindepth 1 -maxdepth 1 2>/dev/null)
if [ "$homes" -eq 0 ]; then
  report FAIL "ls /home/<each entry> (precondition: $CONF_HOMES/<any entry> missing)"
fi
refused "sudo -n true" "" sudo -n true
sudo_lists_wrapper_only
refused "test -w /etc/geldar/keys" "$CONF_KEY_DIR" test -w "$CONF_KEY_DIR"
refused "test -r /etc/geldar/tokens/<any file>" "${token:-$CONF_TOKEN_DIR/<any file>}" \
  test -r "$token"
refused "test -r /etc/geldar/keys/<any file>" "${key:-$CONF_KEY_DIR/<any file>}" test -r "$key"
refused "test -r <shared login>" "$CONF_LOGIN" test -r "$CONF_LOGIN"
allowed "append /var/log/geldar-hosts.log" sh -c ": >> $CONF_LOG"
groups_clean
docker_refused

# The wrapper refuses every bad id, verb and flag with exit 2, before anything runs.
wrapper_refused "wrapper AG-x" check-secrets AG-x
wrapper_refused "wrapper ag-a;b" check-secrets 'ag-a;b'
# The single quotes are deliberate: the probe passes the literal text to the wrapper, unexpanded.
# shellcheck disable=SC2016
wrapper_refused "wrapper ag-x\$(id)" check-secrets 'ag-x$(id)'
wrapper_refused "wrapper ag-x b" check-secrets 'ag-x b'
wrapper_refused "wrapper ../x" check-secrets ../x
wrapper_refused "wrapper verb bash" bash ag-probe-00
wrapper_refused "wrapper verb exec" exec ag-probe-00
wrapper_refused "wrapper verb start;id" 'start;id' ag-probe-00
wrapper_refused "wrapper flag --rm" start ag-probe-00 --rm
positive_control "wrapper positive control: check-secrets ag-probe-00"
unit_confinement

if [ "$fails" -eq 0 ]; then
  exit 0
fi
exit 1
