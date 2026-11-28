#!/usr/bin/env bash
# Proves the runner account is confined (F-05b). Run as root on the VM, after install-wrapper.sh.
# Each probe runs as geldar-runner through runuser and prints "ok <probe>" or "FAIL <probe>". A
# probe that must be refused is ok only when the runner is refused, and only when its target exists
# (checked as root first, so a missing target cannot pass the probe by accident). The root-side file
# probes use GNU stat: off Linux they print "SKIP <probe>" with the reason, which is neither ok nor
# FAIL. F-08 step 1 runs this on the VM; "--in-unit" only prints the command for the in-unit probe.
# Usage: verify-confinement.sh [--in-unit]
# Exit codes: 0 every probe is ok or skipped, 1 a probe is FAIL, 2 not root or a bad argument.
set -euo pipefail
umask 022

runner=geldar-runner
# The paths the probes aim at. The test rewrites these lines to a temp world; on the VM they are real.
readonly CONF_SHADOW=/etc/shadow
readonly CONF_HOMES=/home
readonly CONF_TOKEN_DIR=/etc/geldar/tokens
readonly CONF_KEY_DIR=/etc/geldar/keys
readonly CONF_LOGIN=/home/geldar/.claude/.credentials.json
readonly CONF_LOG=/var/log/geldar-hosts.log
readonly CONF_SBIN=/usr/local/sbin
readonly CONF_WRAPPER=/usr/local/sbin/geldar-fleet-run
readonly CONF_SUDOERS=/etc/sudoers.d/geldar-fleet
readonly CONF_DROPINS=/etc/systemd/system/geldar-runner.service.d
readonly CONF_UNIT=/etc/systemd/system/geldar-runner.service
# The launcher account and the state folder its verbs write (XDG_STATE_HOME/geldar).
readonly CONF_STATE=/home/geldar/.local/state/geldar
launcher=geldar
# The unit's ReadWritePaths as reviewed; a systemd leading - is ignored. A unit change changes this too.
readonly UNIT_RW_PATHS="/etc/geldar/placement /var/log/geldar-hosts.log /run/geldar-fleet /opt/geldar-runner /run/sudo /home/geldar/scriptorium /home/geldar/.local/state /srv/geldar"
# Drop-in files allowed under the unit's drop-in directory, by file name. None today.
readonly UNIT_DROPINS_OK=""
fails=0

# unit_props prints the -p arguments that reproduce the unit's sandbox from the unit file: every
# Environment=PATH, Protect*, Private*, Restrict* and LockPersonality line, and ReadWritePaths as one
# list property. User is left to the caller, and NoNewPrivileges=no is always added. Values are
# single-quoted, so a space inside a value stays one argument.
unit_props() {
  local line rw=""
  while IFS= read -r line; do
    case $line in
      ReadWritePaths=*) rw="$rw ${line#ReadWritePaths=}" ;;
      Environment=PATH=* | Protect* | Private* | Restrict* | LockPersonality=*)
        printf " -p '%s'" "$line" ;;
    esac
  done < "$CONF_UNIT"
  printf " -p 'NoNewPrivileges=no'"
  [ -z "$rw" ] || printf " -p 'ReadWritePaths=%s'" "${rw# }"
}

# --in-unit prints two systemd-run commands and exits. It only prints: nothing runs, so it needs no
# root. Each transient unit takes the installed unit's User and sandbox settings. The first runs the
# read-only verb through the wrapper as the runner. The second writes the launcher's state folder as
# the launcher account, inside the same sandbox, and must exit 0.
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != --in-unit ]; }; then
  echo "verify-confinement: usage: verify-confinement.sh [--in-unit]" >&2
  exit 2
fi
if [ "$#" -eq 1 ]; then
  [ -r "$CONF_UNIT" ] || { echo "verify-confinement: cannot read $CONF_UNIT" >&2; exit 2; }
  unit_user=$(sed -n 's/^User=//p' "$CONF_UNIT" | head -n 1)
  props=$(unit_props)
  echo "systemd-run --wait --pipe --collect -p 'User=$unit_user'$props -- sudo -n $CONF_WRAPPER check-secrets ag-probe-00"
  echo "systemd-run --wait --pipe --collect -p 'User=$launcher'$props -- sh -c 'mkdir -p $CONF_STATE && touch $CONF_STATE/.verify-write && rm -f $CONF_STATE/.verify-write'"
  exit 0
fi

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
  err=$(as_runner sudo -n "$CONF_WRAPPER" "$@" 2>&1 >/dev/null) || rc=$?
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
  as_runner sudo -n "$CONF_WRAPPER" check-secrets ag-probe-00 >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq 0 ] || [ "$rc" -eq 6 ]; then report ok "$1"; else report FAIL "$1"; fi
}

# sudo_lists_wrapper_only: the runner's sudo list holds exactly one command line in all, and it is
# the wrapper with NOPASSWD. A second rule, with or without a password, is a FAIL.
sudo_lists_wrapper_only() {
  local out cmds
  out=$(as_runner sudo -n -l 2>/dev/null || true)
  cmds=$(printf '%s\n' "$out" | grep -c '^ *(.*) ' || true)
  if [ "$cmds" -eq 1 ] &&
    printf '%s\n' "$out" | grep -q "^ *(.*) NOPASSWD: $CONF_WRAPPER\$"; then
    report ok "sudo -n -l"
  else
    report FAIL "sudo -n -l"
  fi
}

# env_reset_kept: sudo's policy for the runner keeps env_reset, so the caller's environment (BASH_ENV
# and the like) is dropped before the wrapper runs. Read as root with sudo's own listing.
env_reset_kept() {
  local out last
  out=$(sudo -n -l -U "$runner" 2>/dev/null || true)
  # sudo wraps its list across lines, so the list is split into one token per line. The last env_reset
  # token decides, as sudo's last setting does: a later !env_reset is a FAIL.
  last=$(printf '%s\n' "$out" | tr -s ' ,\n' '\n' | grep -E '^!?env_reset$' | tail -n 1 || true)
  if [ "$last" = env_reset ]; then
    report ok "sudo -l -U $runner has env_reset"
  else
    report FAIL "sudo -l -U $runner has env_reset"
  fi
}

# root_owned PROBE PATH: PATH is owned by root and has no group or world write bits. GNU stat is
# Linux-only: elsewhere the probe is a SKIP with its reason, and it is neither ok nor FAIL.
root_owned() {
  local probe=$1 path=$2 out uid mode
  if [ "$(uname -s)" != Linux ]; then
    echo "SKIP $probe (needs Linux GNU stat)"
    return 0
  fi
  if [ ! -e "$path" ]; then
    report FAIL "$probe (precondition: $path missing)"
    return 0
  fi
  out=$(stat -c '%u %a' "$path" 2>/dev/null || true)
  uid=${out%% *}
  mode=${out#* }
  if [ "$uid" = 0 ] && [ -n "$mode" ] && [ $((8#$mode & 022)) -eq 0 ]; then
    report ok "$probe"
  else
    report FAIL "$probe"
  fi
}

# groups_clean: the runner is in none of docker, sudo, wheel or geldar, nor in a group that owns the
# token or key directory (root:geldar on the VM).
groups_clean() {
  local names owners g bad="" denied
  names=$(as_runner id -nG 2>/dev/null || true)
  owners=$(stat -c %G "$CONF_TOKEN_DIR" "$CONF_KEY_DIR" 2>/dev/null | tr '\n' ' ' || true)
  denied="docker sudo wheel geldar $owners"
  [ -n "$names" ] || bad=1
  [ -n "$owners" ] || bad=1
  for g in $names; do
    case " $denied " in
      *" $g "*) bad=1 ;;
    esac
  done
  if [ -z "$bad" ]; then
    report ok "id -nG has no docker, sudo, wheel, geldar or secret-owner group"
  else
    report FAIL "id -nG has no docker, sudo, wheel, geldar or secret-owner group"
  fi
}

# unit_confinement: the unit's own settings, as systemd reports them. NoNewPrivileges and
# RestrictSUIDSGID must be no, because the runner reaches the wrapper through setuid sudo.
unit_confinement() {
  local out probe props="ProtectSystem,ReadWritePaths,NoNewPrivileges,RestrictSUIDSGID"
  out=$(systemctl show geldar-runner -p "$props" 2>/dev/null || true)
  probe="systemctl show geldar-runner -p $props"
  if printf '%s\n' "$out" | grep -qx 'NoNewPrivileges=no' &&
    printf '%s\n' "$out" | grep -qx 'RestrictSUIDSGID=no' &&
    printf '%s\n' "$out" | grep -qx 'ProtectSystem=strict'; then
    report ok "$probe"
  else
    report FAIL "$probe"
  fi
}

# unit_user: the unit runs as geldar-runner.
unit_user() {
  local out
  out=$(systemctl show geldar-runner -p User 2>/dev/null || true)
  if printf '%s\n' "$out" | grep -qx 'User=geldar-runner'; then
    report ok "systemctl show geldar-runner -p User"
  else
    report FAIL "systemctl show geldar-runner -p User"
  fi
}

# unit_rw_paths: the unit's ReadWritePaths are exactly the reviewed list, in any order.
unit_rw_paths() {
  local out got want
  out=$(systemctl show geldar-runner -p ReadWritePaths 2>/dev/null || true)
  got=$(printf '%s\n' "$out" | sed -n 's/^ReadWritePaths=//p' | tr ' ' '\n' | sed 's/^-//' | sort)
  want=$(echo "$UNIT_RW_PATHS" | tr ' ' '\n' | sort)
  if [ -n "$got" ] && [ "$got" = "$want" ]; then
    report ok "systemctl show geldar-runner ReadWritePaths is the reviewed list"
  else
    report FAIL "systemctl show geldar-runner ReadWritePaths is the reviewed list"
  fi
}

# unit_dropins: no drop-in file sits under the unit's drop-in directory, except the names listed in
# UNIT_DROPINS_OK. A missing directory has no drop-ins; a directory that exists but cannot be listed
# is a FAIL, never a silent pass.
unit_dropins() {
  local f bad="" list rc=0
  if [ -e "$CONF_DROPINS" ]; then
    list=$(find "$CONF_DROPINS" -mindepth 1 2>/dev/null) || rc=$?
    [ "$rc" -eq 0 ] || bad=1
  else
    list=""
  fi
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case " $UNIT_DROPINS_OK " in
      *" $(basename "$f") "*) ;;
      *) bad=1 ;;
    esac
  done <<< "$list"
  if [ -z "$bad" ]; then
    report ok "no drop-ins under geldar-runner.service.d"
  else
    report FAIL "no drop-ins under geldar-runner.service.d"
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
env_reset_kept
refused "test -w /etc/geldar/keys" "$CONF_KEY_DIR" test -w "$CONF_KEY_DIR"
refused "test -r /etc/geldar/tokens/<any file>" "${token:-$CONF_TOKEN_DIR/<any file>}" \
  test -r "$token"
refused "test -r /etc/geldar/keys/<any file>" "${key:-$CONF_KEY_DIR/<any file>}" test -r "$key"
refused "test -r <shared login>" "$CONF_LOGIN" test -r "$CONF_LOGIN"
allowed "append /var/log/geldar-hosts.log" sh -c ": >> $CONF_LOG"
groups_clean
docker_refused
# The installed wrapper, its directory and the sudoers rule are root's, and the runner cannot write
# to any of them.
root_owned "root-owned, no group or world write: /usr/local/sbin/geldar-fleet-run" "$CONF_WRAPPER"
root_owned "root-owned, no group or world write: /usr/local/sbin" "$CONF_SBIN"
root_owned "root-owned, no group or world write: /etc/sudoers.d/geldar-fleet" "$CONF_SUDOERS"
refused "test -w /usr/local/sbin/geldar-fleet-run" "$CONF_WRAPPER" test -w "$CONF_WRAPPER"
refused "test -w /usr/local/sbin" "$CONF_SBIN" test -w "$CONF_SBIN"
refused "test -w /etc/sudoers.d/geldar-fleet" "$CONF_SUDOERS" test -w "$CONF_SUDOERS"

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
unit_user
unit_rw_paths
unit_dropins

if [ "$fails" -eq 0 ]; then
  exit 0
fi
exit 1
