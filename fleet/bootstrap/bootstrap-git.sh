#!/usr/bin/env bash
# Installs the apt packages the launcher clone needs on the fleet VM (Debian 12) and a pinned
# git. Run as root. Re-runnable: each step checks before it acts.
# Exit codes: 0 done, 2 not root, 5 a pinned value is FILL_ME, empty or malformed, versions.env
# is missing, or the git tarball does not match its checksum (nothing unpacked), 6 git is older
# than the pin after the install, 7 the download, unpack or build of git failed.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)

# GEL_ROOT prefixes the Contract's absolute paths for the tests. It counts only when
# GELDAR_INTERNAL=1; otherwise the paths are the real ones.
root=""
if [ "${GELDAR_INTERNAL:-}" = "1" ]; then
  root="${GEL_ROOT:-}"
fi

# The packages of the Contract's VM bootstrap. Docker is already on the VM and is not here.
packages=(
  ca-certificates
  curl
  build-essential
  gettext
  libcurl4-openssl-dev
  libssl-dev
  zlib1g-dev
  libexpat1-dev
  util-linux
  shellcheck
)

die() {
  local code=$1
  shift
  echo "bootstrap-git: $*" >&2
  exit "$code"
}

# checked_pin KEY prints the value of KEY from versions.env, read as data and never sourced.
# An empty value exits 5; FILL_ME exits 5 with its own message.
checked_pin() {
  local value
  value=$(sed -n "s/^$1=//p" "$here/versions.env" | tail -n 1)
  case "$value" in
    "") die 5 "$1 is empty in versions.env" ;;
    FILL_ME) die 5 "$1 is still FILL_ME in versions.env; the orchestrator fills it" ;;
  esac
  printf '%s' "$value"
}

# version_ge A B succeeds when version A is B or newer.
version_ge() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n 1)" = "$2" ]
}

# installed_git prints the version of the VM's git, or nothing when there is none.
installed_git() {
  "$root/usr/local/bin/git" --version 2>/dev/null | awk '{ print $3 }' || true
}

[ "$(id -u)" -eq 0 ] || die 2 "must run as root"
[ -r "$here/versions.env" ] || die 5 "versions.env is missing"

# All pins are checked before any step acts.
git_version=$(checked_pin GIT_VERSION)
git_url=$(checked_pin GIT_URL)
git_sha256=$(checked_pin GIT_SHA256)
case "$git_sha256" in
  *[!0-9a-f]*) die 5 "GIT_SHA256 is not a sha256 hex digest" ;;
esac
[ "${#git_sha256}" -eq 64 ] || die 5 "GIT_SHA256 is not a sha256 hex digest"

# Step 1: apt. Only the packages that are missing are installed.
missing=()
for pkg in "${packages[@]}"; do
  # shellcheck disable=SC2016
  if [ "$(dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null)" != "install ok installed" ]; then
    missing+=("$pkg")
  fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq "${missing[@]}"
fi

# Step 2: git. Built only when the installed git is older than the pin (a newer git is kept).
# The tarball is checked against its sha256 before it is unpacked.
if ! version_ge "$(installed_git)" "$git_version"; then
  build_dir=$(mktemp -d)
  trap 'rm -rf "$build_dir"' EXIT
  curl -fsSL --proto '=https' --tlsv1.2 -o "$build_dir/git.tar.xz" "$git_url" ||
    die 7 "download of git failed"
  printf '%s  git.tar.xz\n' "$git_sha256" > "$build_dir/git.sha256"
  (cd "$build_dir" && sha256sum -c git.sha256) ||
    die 5 "git tarball does not match GIT_SHA256; nothing unpacked"
  tar -xJf "$build_dir/git.tar.xz" -C "$build_dir" || die 7 "unpacking the git tarball failed"
  make -C "$build_dir/git-$git_version" prefix="$root/usr/local" all install ||
    die 7 "building git $git_version failed"
fi

# Step 3: the final check. The launcher clone needs git 2.47.1 or newer.
final=$(installed_git)
version_ge "$final" "$git_version" ||
  die 6 "git is '${final:-missing}', need $git_version or newer"
echo "bootstrap-git: git $final ok"
