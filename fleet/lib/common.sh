#!/usr/bin/env bash
# Shared helpers for the fleet scripts. Sourced, never run. Every absolute path is prefixed with
# GF_ROOT (empty on the VM). The test seams GEL_ROOT, GEL_RUN and GEL_DF are read only when
# GELDAR_INTERNAL=1; otherwise they are ignored. Exit codes: the table in fleet/README.md.

umask 007

if [ "${GELDAR_INTERNAL:-}" = "1" ]; then
  GF_ROOT=${GEL_ROOT:-}
  GF_RUN=${GEL_RUN:-sudo -n /usr/local/sbin/geldar-fleet-run}
  # GF_DF is read by bin/place.sh after it sources this file, not in this file.
  # shellcheck disable=SC2034
  GF_DF=${GEL_DF:-}
else
  GF_ROOT=
  GF_RUN="sudo -n /usr/local/sbin/geldar-fleet-run"
  # GF_DF is read by bin/place.sh after it sources this file, not in this file.
  # shellcheck disable=SC2034
  GF_DF=
fi
# The wrapper command may carry arguments (sudo -n ...); split it once, without eval.
read -r -a GF_RUN_ARGV <<<"$GF_RUN"

# gf_die CODE MESSAGE: one line to stderr, then exit with CODE.
gf_die() {
  printf '%s\n' "$2" >&2
  exit "$1"
}

# gf_validate_id ID: ag-<name>-NN, 4 to 39 characters, no "--", no trailing "-".
gf_validate_id() {
  local id=$1 re='^ag-[a-z0-9-]+$'
  if ! [[ $id =~ $re ]] || [ "${#id}" -lt 4 ] || [ "${#id}" -gt 39 ]; then
    gf_die 2 "invalid id"
  fi
  case $id in
    *--* | *-) gf_die 2 "invalid id" ;;
  esac
}

# gf_validate_repo REPO: <org>/<name>, letters, digits, dot, underscore and dash only.
gf_validate_repo() {
  local re='^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'
  [[ $1 =~ $re ]] || gf_die 2 "invalid repo"
}

# gf_read_roster ID: sets GF_REPO to the one line of the roster entry. A missing entry is exit 4;
# a CR, an extra line or an invalid repo is exit 2.
gf_read_roster() {
  local file=$GF_ROOT/etc/geldar/roster/$1 line count=0
  [ -f "$file" ] || gf_die 4 "no roster entry for this id"
  GF_REPO=""
  while IFS= read -r line || [ -n "$line" ]; do
    count=$((count + 1))
    GF_REPO=$line
  done <"$file"
  [ "$count" -eq 1 ] || gf_die 2 "roster must have exactly one line"
  case $GF_REPO in
    *$'\r'*) gf_die 2 "roster has a CR" ;;
  esac
  gf_validate_repo "$GF_REPO"
}

# gf_conf KEY: sets GF_CONF to max_hosts or min_free_pct from fleet.conf. The file is read as
# data, never sourced. Missing, FILL_ME, non-numeric, out of range or unknown: exit 5.
gf_conf() {
  local key=$1 file=$GF_ROOT/etc/geldar/fleet.conf line k v seen=""
  case $key in
    max_hosts | min_free_pct) ;;
    *) gf_die 5 "fleet.conf key is not known" ;;
  esac
  [ -f "$file" ] || gf_die 5 "fleet.conf is missing"
  GF_CONF=""
  while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$line" ] || continue
    case $line in
      *$'\r'*) gf_die 5 "fleet.conf has a CR" ;;
    esac
    if [[ $line =~ ^(max_hosts|min_free_pct)=([^=]*)$ ]]; then
      k=${BASH_REMATCH[1]}
      v=${BASH_REMATCH[2]}
      if [ "$k" = "$key" ]; then
        GF_CONF=$v
        seen=1
      fi
    else
      gf_die 5 "fleet.conf has an unknown line"
    fi
  done <"$file"
  [ -n "$seen" ] || gf_die 5 "$key is missing from fleet.conf"
  [ "$GF_CONF" != "FILL_ME" ] || gf_die 5 "$key is still FILL_ME"
  [[ $GF_CONF =~ ^[0-9]+$ ]] || gf_die 5 "$key is not a number"
  if [ "$key" = "min_free_pct" ] && [ "$GF_CONF" -gt 100 ]; then
    gf_die 5 "min_free_pct is above 100"
  fi
}

# gf_log VERB ID RESULT DETAIL: one line to the fleet log, control characters removed. Never pass
# a token, a key or a key path.
gf_log() {
  local ts clean
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  clean=$(printf '%s %s %s %s' "$1" "$2" "$3" "$4" | tr -d '[:cntrl:]')
  mkdir -p "$GF_ROOT/var/log"
  printf '%s %s\n' "$ts" "$clean" >>"$GF_ROOT/var/log/geldar-hosts.log"
}

# gf_lock ID: takes the per-id lock (fd 9) for the rest of the script. A holder is exit 8.
gf_lock() {
  command -v flock >/dev/null 2>&1 || gf_die 7 "flock is not installed"
  mkdir -p "$GF_ROOT/run/geldar-fleet"
  exec 9>"$GF_ROOT/run/geldar-fleet/$1.lock"
  flock -n 9 || gf_die 8 "another operation holds this id's lock"
}

# gf_lock_global: takes _global.lock (fd 8), waiting up to 60 seconds. A timeout is exit 5.
gf_lock_global() {
  command -v flock >/dev/null 2>&1 || gf_die 7 "flock is not installed"
  mkdir -p "$GF_ROOT/run/geldar-fleet"
  exec 8>"$GF_ROOT/run/geldar-fleet/_global.lock"
  flock -w 60 8 || gf_die 5 "the global lock wait ran out"
}

# gf_run VERB ID [FLAGS...]: the only way the fleet reaches the launcher, through the wrapper.
# A built-in's 6 passes through; any other non-zero status is exit 7.
gf_run() {
  local rc=0
  "${GF_RUN_ARGV[@]}" "$@" || rc=$?
  [ "$rc" -eq 0 ] && return 0
  [ "$rc" -eq 6 ] && gf_die 6 "secret or shared login is missing"
  gf_die 7 "launcher verb failed"
}

# gf_remove_tree ID: stub until F-02c installs the removal helper. It fails loudly so an F-02b
# failure path cannot pass silently.
gf_remove_tree() {
  gf_die 7 "removal helper not installed"
}
