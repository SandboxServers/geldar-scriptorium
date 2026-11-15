#!/usr/bin/env bash
# Installs the fleet wrapper and its sudoers rule (F-05b). Run as root on the VM, after
# install-runner.sh has created the runner account. The sudoers rule is checked with visudo -cf
# before it lands in /etc/sudoers.d, so a broken rule never takes effect. Re-runnable.
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

die() {
  local code=$1
  shift
  echo "install-wrapper: $*" >&2
  exit "$code"
}

# Any failing command that no check maps is a failed step: exit 7, with its line number.
trap 'die 7 "step failed at line $LINENO"' ERR

[ "$(id -u)" -eq 0 ] || die 2 "must run as root"
visudo -cf "$here/geldar-fleet-sudoers" >/dev/null || die 7 "visudo refused geldar-fleet-sudoers"
mkdir -p "$(dirname "$wrapper_dst")" "$(dirname "$sudoers_dst")"
install -o root -g root -m 0755 "$here/geldar-fleet-run" "$wrapper_dst"
install -o root -g root -m 0440 "$here/geldar-fleet-sudoers" "$sudoers_dst"
echo "result=installed"
