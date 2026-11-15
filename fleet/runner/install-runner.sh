#!/usr/bin/env bash
# Installs the self-hosted runner of the fleet under the account geldar-runner (F-05a). Run as root
# on the VM, after bootstrap.sh. Re-runnable: the tarball is fetched only when config.sh is absent,
# and the runner is registered only when .runner is absent. The one-time registration token is read
# from --token-file and reaches config.sh through the environment, never an argument or a log. The
# runner self-updates (D-FL-10): the pins in versions.env govern the first install only.
# Usage: install-runner.sh --url https://github.com/<org>/<repo> --token-file <file>
# Exit codes: 0 done, 2 usage, not root, a URL or a token file that is refused, 5 a pinned value is
# FILL_ME, empty or malformed, or the tarball checksum does not match, 6 geldar-runner is in docker,
# sudo or wheel, 7 a step failed (any failing command that no check maps).
set -Eeuo pipefail
umask 022

here=$(cd "$(dirname "$0")" && pwd)

# GEL_ROOT prefixes the install paths for the tests. It counts only when GELDAR_INTERNAL=1;
# otherwise the paths are the real ones.
root=""
if [ "${GELDAR_INTERNAL:-}" = "1" ]; then
  root="${GEL_ROOT:-}"
fi
runner_account=geldar-runner
runner_dir="$root/opt/geldar-runner"
unit="$root/etc/systemd/system/geldar-runner.service"
runner_name=geldar-fleet
runner_labels=geldar-hosts
tmp=""

die() {
  local code=$1
  shift
  echo "install-runner: $*" >&2
  exit "$code"
}

# cleanup removes the download directory, if one was made. Runs on every exit.
cleanup() {
  [ -z "$tmp" ] || rm -rf "$tmp"
}
trap cleanup EXIT

# Any failing command that no check maps is a failed step: exit 7, with its line number.
trap 'die 7 "step failed at line $LINENO"' ERR

# pin KEY VAR sets VAR to the value of KEY in versions.env, read as data and never sourced. An
# empty value, FILL_ME, or a value that starts with - or has whitespace exits 5.
pin() {
  local value
  value=$(sed -n "s/^$1=//p" "$here/versions.env" | tail -n 1)
  case "$value" in
    "") die 5 "$1 is empty in versions.env" ;;
    FILL_ME) die 5 "$1 is still FILL_ME in versions.env; the orchestrator fills it" ;;
    -* | *[[:space:]]*) die 5 "$1 starts with - or has whitespace in versions.env" ;;
  esac
  printf -v "$2" '%s' "$value"
}

# runner_not_privileged exits 6 when the runner account is in docker, sudo or wheel. Its only sudo
# rule is the wrapper, installed by F-05b; any other group would widen what the runner can reach.
runner_not_privileged() {
  local hits
  hits=$(getent group docker sudo wheel 2>/dev/null |
    awk -F: -v u="$runner_account" '{ n = split($4, m, ","); for (i = 1; i <= n; i++) if (m[i] == u) print $1 }') ||
    true
  [ -z "$hits" ] || die 6 "$runner_account is in a refused group: ${hits//$'\n'/ }"
}

# ensure_account creates the runner account as a system user with no login shell, when absent.
ensure_account() {
  if ! getent passwd "$runner_account" >/dev/null; then
    useradd --system --home-dir /opt/geldar-runner --shell /usr/sbin/nologin "$runner_account" ||
      die 7 "useradd $runner_account failed"
  fi
}

# fetch_and_unpack downloads the pinned tarball, checks its sha256 before anything is unpacked, and
# unpacks it into the runner directory, owned by the runner account.
fetch_and_unpack() {
  local tarball_name tarball_url tarball
  tarball_name="actions-runner-linux-x64-$runner_version.tar.gz"
  tarball_url="https://github.com/actions/runner/releases/download/v$runner_version/$tarball_name"
  tmp=$(mktemp -d)
  tarball="$tmp/$tarball_name"
  curl --fail --location --silent --show-error -o "$tarball" "$tarball_url" ||
    die 7 "download of the runner tarball failed"
  printf '%s  %s\n' "$runner_sha" "$tarball" | sha256sum --check --status ||
    die 5 "the runner tarball does not match RUNNER_SHA256"
  mkdir -p "$runner_dir"
  tar -xzf "$tarball" -C "$runner_dir" || die 7 "unpack of the runner tarball failed"
  chown -R "$runner_account:$runner_account" "$runner_dir" || die 7 "chown of $runner_dir failed"
}

# read_token FILE sets token to the file's content: one token, no CR, no second line. The token is
# never printed. A missing, unreadable or malformed file exits 2.
read_token() {
  if [ ! -f "$1" ] || [ ! -r "$1" ]; then die 2 "token file is missing or unreadable"; fi
  token=$(cat -- "$1")
  [[ $token =~ ^[A-Za-z0-9_-]+$ ]] || die 2 "token file is empty or malformed"
}

# configure registers the runner with the repo. The token, the URL, the labels and the name reach
# config.sh only through its environment; the argv carries only the flags. config.sh refuses root,
# so it runs as the runner account through runuser.
configure() {
  (
    cd "$runner_dir"
    ACTIONS_RUNNER_INPUT_TOKEN=$token \
      ACTIONS_RUNNER_INPUT_URL=$url \
      ACTIONS_RUNNER_INPUT_LABELS=$runner_labels \
      ACTIONS_RUNNER_INPUT_NAME=$runner_name \
      runuser -u "$runner_account" -- "$runner_dir/config.sh" --unattended --replace
  ) || die 7 "config.sh failed"
}

# install_unit copies the unit snapshot into place, then enables and starts it.
install_unit() {
  mkdir -p "$(dirname "$unit")"
  cp "$here/geldar-runner.service" "$unit" || die 7 "copy of the unit failed"
  chmod 0644 "$unit" || die 7 "chmod of the unit failed"
  systemctl daemon-reload || die 7 "systemctl daemon-reload failed"
  systemctl enable --now geldar-runner.service || die 7 "systemctl enable --now failed"
}

url="" token_file="" token=""
while [ "$#" -gt 0 ]; do
  case $1 in
    --url)
      [ "$#" -ge 2 ] || die 2 "--url needs a value"
      url=$2
      shift 2
      ;;
    --token-file)
      [ "$#" -ge 2 ] || die 2 "--token-file needs a value"
      token_file=$2
      shift 2
      ;;
    *) die 2 "unknown argument; usage: install-runner.sh --url <repo-url> --token-file <file>" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die 2 "must run as root"
if [ -z "$url" ] || [ -z "$token_file" ]; then die 2 "usage: install-runner.sh --url <repo-url> --token-file <file>"; fi
re_url='^https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'
[[ $url =~ $re_url ]] || die 2 "the URL must be https://github.com/<org>/<repo>"

# The pins are checked before any step acts: a FILL_ME value exits 5 with nothing else run.
[ -r "$here/versions.env" ] || die 5 "versions.env is missing"
runner_version="" runner_sha=""
pin RUNNER_VERSION runner_version
pin RUNNER_SHA256 runner_sha
[[ $runner_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die 5 "RUNNER_VERSION is not a version"
[[ $runner_sha =~ ^[0-9a-f]{64}$ ]] || die 5 "RUNNER_SHA256 is not a sha256 in lower case hex"

read_token "$token_file"
ensure_account
runner_not_privileged
[ -f "$runner_dir/config.sh" ] || fetch_and_unpack
[ -f "$runner_dir/.runner" ] || configure
install_unit
echo "result=installed version=$runner_version labels=$runner_labels"
