#!/usr/bin/env bash
# Sets up the rest of the fleet VM's host state (Debian 12): the data volumes, the runner account,
# /etc/geldar, the installed fleet scripts and the launcher clone, then self-checks. Run as root
# once the VM user geldar exists (the ssh account; this script never creates it). Re-runnable:
# each step checks before it acts. The pins and the geldar account are checked first, then
# bootstrap-git.sh installs the pinned git.
# Exit codes: 0 done, 1 the self-check failed, 2 not root, 5 a pinned value is FILL_ME, empty,
# malformed (starts with - or has whitespace) or missing from versions.env, or the launcher's deploy
# key or known_hosts is absent when a clone is needed, 6 the VM user geldar is missing, or the
# launcher clone has no commit for LAUNCHER_COMMIT or is not at it, 7 a step failed (any failing
# command that no check maps). The codes 2, 5, 6 and 7 from bootstrap-git.sh pass through; any other
# failure of bootstrap-git.sh is 7.
set -Eeuo pipefail
umask 022

here=$(cd "$(dirname "$0")" && pwd)
fleet=$(cd "$here/.." && pwd)

# GEL_ROOT prefixes the Contract's absolute paths for the tests. It counts only when
# GELDAR_INTERNAL=1; otherwise the paths are the real ones.
root=""
if [ "${GELDAR_INTERNAL:-}" = "1" ]; then
  root="${GEL_ROOT:-}"
fi

# The data volumes by filesystem label. Each mounts at /srv/geldar/nvme-<x>, x the last letter.
volume_labels=(nvme-d nvme-e nvme-g)

die() {
  local code=$1
  shift
  echo "bootstrap: $*" >&2
  exit "$code"
}

# Any failing command that no step maps to is a failed step: exit 7, with its line number.
trap 'die 7 "step failed at line $LINENO"' ERR

# pin KEY VAR sets VAR to the value of KEY in versions.env, read as data and never sourced. An
# empty value exits 5; FILL_ME exits 5 with its own message; a value that starts with - or has
# whitespace exits 5 too. The value is set here rather than returned through a command
# substitution, so the exit code is not lost in a subshell.
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

# launcher_keys_present exits 5 when the launcher's deploy key or its known_hosts file is absent.
launcher_keys_present() {
  [ -f "$launcher_key" ] ||
    die 5 "no launcher deploy key at /etc/geldar/keys/launcher-read; the operator places it (README)"
  [ -f "$launcher_known_hosts" ] ||
    die 5 "no known_hosts for the launcher at /etc/geldar/launcher_known_hosts; the operator places it"
}

# launcher_commit_id prints the commit that LAUNCHER_COMMIT names in the launcher clone. It fails
# when the clone has no such commit.
launcher_commit_id() {
  runuser -u geldar -- env HOME="$home" GIT_TERMINAL_PROMPT=0 \
    git -C "$clone" rev-parse "$launcher_commit^{commit}" 2>/dev/null
}

# version_ge A B succeeds when version A is B or newer.
# shellcheck disable=SC2317,SC2329 # called only through check, which shellcheck cannot follow
version_ge() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n 1)" = "$2" ]
}

# account_exists NAME succeeds when the account is in the passwd database.
account_exists() {
  getent passwd "$1" >/dev/null
}

# own_mode OWNER MODE PATH sets the owner and the mode of PATH, or exits 7.
own_mode() {
  chown "$1" "$3" || die 7 "chown $1 $3 failed"
  chmod "$2" "$3" || die 7 "chmod $2 $3 failed"
}

# git_ok COMMAND... succeeds when the git that COMMAND runs (`--version` is appended) is the
# pinned git or newer. An unreadable version is a failure, not an error.
# shellcheck disable=SC2317,SC2329 # called only through check, which shellcheck cannot follow
git_ok() {
  local ver
  ver=$("$@" --version 2>/dev/null | awk '{ print $3 }') || true
  version_ge "$ver" "$git_version"
}

# volumes_ready succeeds when every data volume has its players/ directory.
# shellcheck disable=SC2317,SC2329 # called only through check, which shellcheck cannot follow
volumes_ready() {
  local label x
  for label in "${volume_labels[@]}"; do
    x=${label#nvme-}
    [ -d "$root/srv/geldar/nvme-$x/players" ] || return 1
  done
}

# runner_not_privileged succeeds when geldar-runner is in none of docker, sudo and wheel.
# shellcheck disable=SC2317,SC2329 # called only through check, which shellcheck cannot follow
runner_not_privileged() {
  local hits
  hits=$(getent group docker sudo wheel 2>/dev/null |
    awk -F: '{ n = split($4, m, ","); for (i = 1; i <= n; i++) if (m[i] == "geldar-runner") print $1 }') ||
    true
  [ -z "$hits" ]
}

# check NAME COMMAND... runs the check and counts it as failed when it fails.
check() {
  local name=$1
  shift
  if "$@"; then
    return 0
  fi
  echo "bootstrap: failed check: $name" >&2
  failed=$((failed + 1))
}

[ "$(id -u)" -eq 0 ] || die 2 "must run as root"
[ -r "$here/versions.env" ] || die 5 "versions.env is missing"

# All pins and the VM user are checked before any step acts. The launcher clone's paths are set
# here too, so its deploy key and known_hosts are checked before bootstrap-git.sh runs.
git_version="" launcher_url="" launcher_commit=""
pin GIT_VERSION git_version
pin LAUNCHER_URL launcher_url
pin LAUNCHER_COMMIT launcher_commit
account_exists geldar ||
  die 6 "the VM user geldar does not exist; it is the ssh account and is never created here"
home=$(getent passwd geldar | cut -d: -f6)
etc="$root/etc/geldar"
clone="$root$home/scriptorium"
launcher_key="$etc/keys/launcher-read"
launcher_known_hosts="$etc/launcher_known_hosts"
git_ssh="ssh -i $launcher_key -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$launcher_known_hosts -F /dev/null"
if [ -d "$clone/.git" ]; then clone_existed=1; else clone_existed=0; fi
if [ -d "$fleet/bin" ] && [ "$clone_existed" -eq 0 ]; then
  launcher_keys_present
fi

# Step 0: the pinned git, which bootstrap-git.sh installs and checks. Its codes 2, 5, 6 and 7 pass
# through; any other failure of it is a failed step.
bash "$here/bootstrap-git.sh" || { rc=$?; case $rc in 2|5|6|7) exit "$rc" ;; *) die 7 "bootstrap-git.sh failed with $rc" ;; esac; }

# Step 1: the data volumes. Each label gets one fstab line (only when none exists for it), a
# mount point, and players/ owned by geldar.
mkdir -p "$root/etc"
touch "$root/etc/fstab"
# A last line without its newline would take the first appended line with it, so one is added.
if [ -s "$root/etc/fstab" ] && [ -n "$(tail -c 1 "$root/etc/fstab")" ]; then
  printf '\n' >> "$root/etc/fstab"
fi
for label in "${volume_labels[@]}"; do
  x=${label#nvme-}
  mnt="/srv/geldar/nvme-$x"
  grep -q "^LABEL=${label}[[:space:]]" "$root/etc/fstab" ||
    echo "LABEL=$label $mnt auto defaults,nofail 0 2" >> "$root/etc/fstab"
  mkdir -p "$root$mnt"
  mountpoint -q "$root$mnt" || mount "$root$mnt" || die 7 "mount of $mnt failed"
  mkdir -p "$root$mnt/players"
  chown geldar "$root$mnt/players" || die 7 "chown of $mnt/players failed"
done

# Step 2: the runner account. A system user with no login shell, never in docker, sudo or wheel
# (its one sudo rule is the wrapper, installed by F-05b).
if ! account_exists geldar-runner; then
  useradd --system --home-dir /opt/geldar-runner --shell /usr/sbin/nologin geldar-runner ||
    die 7 "useradd geldar-runner failed"
fi
mkdir -p "$root/opt/geldar-runner"
own_mode geldar-runner 0755 "$root/opt/geldar-runner"

# Step 3: /etc/geldar (the secret, placement and roster trees), the allow-list, fleet.conf, the
# host log and the tmpfiles line for the lock directory.
mkdir -p "$etc/tokens" "$etc/keys" "$etc/placement" "$etc/roster"
own_mode root:root 0755 "$etc"
own_mode root:geldar 0750 "$etc/tokens"
own_mode root:geldar 0750 "$etc/keys"
own_mode geldar-runner:geldar-runner 0750 "$etc/placement"
own_mode root:geldar-runner 0750 "$etc/roster"
if [ -f "$fleet/conf/allowed-repos.txt" ]; then
  cp "$fleet/conf/allowed-repos.txt" "$etc/allowed-repos.txt" || die 7 "allow-list copy failed"
  own_mode root:root 0644 "$etc/allowed-repos.txt"
else
  echo "bootstrap: fleet/conf/allowed-repos.txt is not in this checkout yet; allow-list not installed" >&2
fi
if [ ! -e "$etc/fleet.conf" ]; then
  cp "$fleet/conf/fleet.conf.example" "$etc/fleet.conf" || die 7 "fleet.conf.example copy failed"
fi
own_mode root:root 0644 "$etc/fleet.conf"
mkdir -p "$root/var/log"
touch "$root/var/log/geldar-hosts.log"
own_mode root:geldar-runner 0660 "$root/var/log/geldar-hosts.log"
mkdir -p "$root/etc/tmpfiles.d"
printf '%s\n' 'd /run/geldar-fleet 0770 root geldar-runner -' > "$root/etc/tmpfiles.d/geldar-fleet.conf"
systemd-tmpfiles --create "$root/etc/tmpfiles.d/geldar-fleet.conf" ||
  die 7 "systemd-tmpfiles could not create the lock directory"

# Step 4: the fleet scripts and the launcher clone. Skipped with a message until the checkout has
# fleet/bin (F-02a). The clone runs as geldar over ssh with the operator's read-only deploy key.
if [ -d "$fleet/bin" ]; then
  lib="$root/usr/local/lib/geldar-fleet"
  mkdir -p "$lib" "$root/usr/local/bin"
  # The copy is skipped when fleet/ is the installed copy itself (the same directory).
  if ! [ "$fleet" -ef "$lib" ]; then
    cp -R "$fleet/." "$lib/" || die 7 "copy of fleet/ failed"
  fi
  for verb in place add remove restart status dispatch; do
    ln -sfn "/usr/local/lib/geldar-fleet/bin/$verb.sh" "$root/usr/local/bin/geldar-fleet-$verb" ||
      die 7 "link of geldar-fleet-$verb failed"
  done
  if [ "$clone_existed" -eq 0 ]; then
    runuser -u geldar -- env HOME="$home" GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="$git_ssh" \
      git clone --quiet -- "$launcher_url" "$clone" || die 7 "clone of the launcher failed"
  fi
  # The commit that LAUNCHER_COMMIT names must resolve in the clone before the checkout. When the
  # clone already existed and the commit is not there, its tags are fetched once and the lookup is
  # retried; a commit still missing exits 6.
  want=$(launcher_commit_id) || {
    [ "$clone_existed" -eq 1 ] || die 6 "the launcher clone has no commit for $launcher_commit"
    launcher_keys_present
    runuser -u geldar -- env HOME="$home" GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="$git_ssh" \
      git -C "$clone" fetch --tags --quiet
    want=$(launcher_commit_id) || die 6 "the launcher clone has no commit for $launcher_commit"
  }
  runuser -u geldar -- env HOME="$home" GIT_TERMINAL_PROMPT=0 \
    git -C "$clone" checkout --quiet --detach "$launcher_commit" ||
    die 7 "checkout of $launcher_commit failed"
  ln -sfn "$clone/launcher/geldar-play" "$root/usr/local/bin/geldar-play" ||
    die 7 "link of geldar-play failed"
  # The commit the clone is at, which must be the commit that LAUNCHER_COMMIT names.
  head=$(runuser -u geldar -- env HOME="$home" GIT_TERMINAL_PROMPT=0 \
    git -C "$clone" rev-parse HEAD) || die 7 "rev-parse of the launcher clone failed"
  [ "$head" = "$want" ] || die 6 "the launcher clone is at $head, not $want ($launcher_commit)"
else
  echo "bootstrap: fleet/bin is not in this checkout yet; scripts and launcher clone skipped" >&2
fi

# Step 5: the self-check. Each failed check is named on stderr; any failure makes it exit 1.
failed=0
check "the geldar account exists" account_exists geldar
check "the geldar-runner account exists" account_exists geldar-runner
check "geldar-runner is in none of docker, sudo and wheel" runner_not_privileged
check "the data volumes have players/" volumes_ready
check "the VM's git is $git_version or newer" git_ok "$root/usr/local/bin/git"
check "geldar runs git $git_version or newer" git_ok runuser -u geldar -- git
check "geldar-runner runs git $git_version or newer" git_ok runuser -u geldar-runner -- git
if [ "$failed" -eq 0 ]; then
  echo "bootstrap: ok"
  exit 0
fi
exit 1
