#!/usr/bin/env bash
# Installs the fleet wrapper and its sudoers rule (F-05b). Run as root on the VM, after
# install-runner.sh has created the runner account. Both files land under a temp name next to their
# target: the sudoers temp has a dot in it, which sudo ignores. visudo checks the sudoers temp, and
# only then are both renamed into place (atomic renames), so a broken rule never takes effect and
# the wrapper is never replaced alone. Re-runnable.
# The sources must be owned by root and have no group or world write bits; otherwise nothing is
# installed. Usage: install-wrapper.sh
# Exit codes: 0 done, 2 not root or a source not owned by root or group/world-writable, 7 a step
# failed, including visudo refusing the rule.
set -Eeuo pipefail
umask 022

here=$(cd "$(dirname "$0")" && pwd)

# GEL_ROOT prefixes the install paths for the tests. It counts only when GELDAR_INTERNAL=1;
# otherwise the paths are the real ones.
root=""
if [ "${GELDAR_INTERNAL:-}" = "1" ]; then
  root="${GEL_ROOT:-}"
fi
wrapper_dst="$root/usr/local/sbin/geldar-fleet-run"
sudoers_dst="$root/etc/sudoers.d/geldar-fleet"
# The temp names sit next to their targets. The dot in the sudoers temp makes sudo skip it until it
# is renamed into place.
wrapper_tmp="$wrapper_dst.new"
sudoers_tmp="$sudoers_dst.new"

die() {
  local code=$1
  shift
  echo "install-wrapper: $*" >&2
  exit "$code"
}

# Any failing command that no check maps is a failed step: both temps are removed and the run exits
# 7, with its line number.
trap 'rm -f "$wrapper_tmp" "$sudoers_tmp"; die 7 "step failed at line $LINENO"' ERR

# source_ok FILE: FILE is owned by root and has no group or world write bits. The sources are read
# from the repo, so an account other than root could have changed them before the install.
source_ok() {
  local out uid mode
  out=$(stat -c '%u %a' "$1") || die 7 "cannot read $1"
  uid=${out%% *}
  mode=${out#* }
  [ "$uid" = 0 ] && [ $((8#$mode & 022)) -eq 0 ] ||
    die 2 "$(basename "$1") must be owned by root and not group or world writable"
}

[ "$(id -u)" -eq 0 ] || die 2 "must run as root"
source_ok "$here/geldar-fleet-run"
source_ok "$here/geldar-fleet-sudoers"
mkdir -p "$(dirname "$wrapper_dst")" "$(dirname "$sudoers_dst")"
install -o root -g root -m 0755 "$here/geldar-fleet-run" "$wrapper_tmp"
install -o root -g root -m 0440 "$here/geldar-fleet-sudoers" "$sudoers_tmp"
if ! visudo -cf "$sudoers_tmp" >/dev/null; then
  rm -f "$wrapper_tmp" "$sudoers_tmp"
  die 7 "visudo refused geldar-fleet-sudoers"
fi
mv -f "$wrapper_tmp" "$wrapper_dst"
mv -f "$sudoers_tmp" "$sudoers_dst"
echo "result=installed"
