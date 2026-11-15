#!/usr/bin/env bash
# Installs the fleet wrapper and its sudoers rule (F-05b). Run as root on the VM, after
# install-runner.sh has created the runner account. The sudoers rule lands under a temp name with a
# dot in it, which sudo ignores; visudo checks that installed copy, and only then is it renamed to
# /etc/sudoers.d/geldar-fleet (an atomic rename), so a broken rule never takes effect. Re-runnable.
# Usage: install-wrapper.sh
# Exit codes: 0 done, 2 not root, 7 a step failed, including visudo refusing the rule.
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
# The dot in the name makes sudo skip the file until it is renamed into place.
sudoers_tmp="$sudoers_dst.new"

die() {
  local code=$1
  shift
  echo "install-wrapper: $*" >&2
  exit "$code"
}

# Any failing command that no check maps is a failed step: the temp rule is removed and the run
# exits 7, with its line number.
trap 'rm -f "$sudoers_tmp"; die 7 "step failed at line $LINENO"' ERR

[ "$(id -u)" -eq 0 ] || die 2 "must run as root"
mkdir -p "$(dirname "$wrapper_dst")" "$(dirname "$sudoers_dst")"
install -o root -g root -m 0755 "$here/geldar-fleet-run" "$wrapper_dst"
install -o root -g root -m 0440 "$here/geldar-fleet-sudoers" "$sudoers_tmp"
if ! visudo -cf "$sudoers_tmp" >/dev/null; then
  rm -f "$sudoers_tmp"
  die 7 "visudo refused geldar-fleet-sudoers"
fi
mv -f "$sudoers_tmp" "$sudoers_dst"
echo "result=installed"
