#!/usr/bin/env bash
# Proves the runner account is confined (F-05b). Run as root on the VM, after install-wrapper.sh.
# Each probe runs as geldar-runner through runuser and prints "ok <probe>" or "FAIL <probe>". A
# probe that must be refused is ok when the runner is refused. F-08 step 1 runs this on the VM.
# Usage: verify-confinement.sh
# Exit codes: 0 every probe is ok, 1 a probe is FAIL, 2 not root.
set -euo pipefail
umask 022

runner=geldar-runner
wrapper=/usr/local/sbin/geldar-fleet-run
login=/home/geldar/.claude/.credentials.json
fails=0

[ "$(id -u)" -eq 0 ] || { echo "verify-confinement: must run as root" >&2; exit 2; }

# report STATUS PROBE prints one line and counts a FAIL.
report() {
  echo "$1 $2"
  if [ "$1" != ok ]; then fails=$((fails + 1)); fi
}

# as_runner runs its arguments as the runner account, through runuser.
as_runner() {
  runuser -u "$runner" -- "$@"
}

# refused PROBE CMD...: the runner must be refused, so CMD must exit non-zero.
refused() {
  local probe=$1
  shift
  if as_runner "$@" >/dev/null 2>&1; then report FAIL "$probe"; else report ok "$probe"; fi
}

# wrapper_refused PROBE ARGS...: the wrapper, run through sudo, must exit 2 and start nothing.
wrapper_refused() {
  local probe=$1 rc=0
  shift
  as_runner sudo -n "$wrapper" "$@" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq 2 ]; then report ok "$probe"; else report FAIL "$probe"; fi
}

# positive_control PROBE: a good id reaches the wrapper, so the run exits 0 or 6, never 2. A wrapper
# that refused everything would pass every negative probe; this keeps the negatives honest.
positive_control() {
  local rc=0
  as_runner sudo -n "$wrapper" check-secrets ag-probe-00 >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq 0 ] || [ "$rc" -eq 6 ]; then report ok "$1"; else report FAIL "$1"; fi
}

# sudo_lists_wrapper_only: the runner's sudo list holds exactly one NOPASSWD command, the wrapper.
sudo_lists_wrapper_only() {
  local out
  out=$(as_runner sudo -n -l 2>/dev/null || true)
  if [ "$(printf '%s\n' "$out" | grep -c 'NOPASSWD:' || true)" -eq 1 ] &&
    printf '%s\n' "$out" | grep -q "NOPASSWD: $wrapper\$"; then
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
  local out
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

# The runner reads no secret, no home directory and no shadow file, and has no sudo beyond the
# wrapper.
refused "test -r /etc/shadow" test -r /etc/shadow
refused "ls /home/*" sh -c 'ls /home/*'
refused "sudo -n true" sudo -n true
sudo_lists_wrapper_only
refused "test -w /etc/geldar/keys" test -w /etc/geldar/keys
# The single quotes are deliberate: $f belongs to the probe's own shell, not to this script.
# shellcheck disable=SC2016
refused "test -r /etc/geldar/tokens/<any file>" \
  sh -c 'for f in /etc/geldar/tokens/*; do test -r "$f" && exit 0; done; exit 1'
# shellcheck disable=SC2016
refused "test -r /etc/geldar/keys/<any file>" \
  sh -c 'for f in /etc/geldar/keys/*; do test -r "$f" && exit 0; done; exit 1'
refused "test -r <shared login>" test -r "$login"
allowed "append /var/log/geldar-hosts.log" sh -c ': >> /var/log/geldar-hosts.log'
groups_clean
refused "docker ps" docker ps

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
