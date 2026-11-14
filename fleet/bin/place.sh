#!/usr/bin/env bash
# geldar-fleet-place <id> [--reserve]: chooses the data volume for a player host and prints
# `volume=nvme-<x> free_pct=<n>`. An existing placement file wins (D-FL-03). --reserve takes the
# global lock, applies the max_hosts cap and writes the placement file, so a later add reuses it.
set -euo pipefail

here=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
# shellcheck source-path=SCRIPTDIR
# shellcheck source=../lib/common.sh
. "$here/lib/common.sh"

VOLUMES=(nvme-d nvme-e nvme-g)
usage="usage: geldar-fleet-place <id> [--reserve]"

id=${1:-}
[ -n "$id" ] || gf_die 2 "$usage"
shift
reserve=""
case ${1:-} in
  "") ;;
  --reserve)
    reserve=1
    shift
    ;;
  *) gf_die 2 "$usage" ;;
esac
[ "$#" -eq 0 ] || gf_die 2 "$usage"
gf_validate_id "$id"

# log_refusal RC: a refusal (exit 3, 4 or 5) leaves one result line in the fleet log. Other codes
# are not logged. The trap only logs, so the exit code is the one the refusal chose.
log_refusal() {
  case $1 in
    3 | 4 | 5) gf_log place "$id" "exit$1" "${GF_DIE_MSG:-}" ;;
  esac
}
trap 'log_refusal $?' EXIT

placement=$GF_ROOT/etc/geldar/placement/$id

# read_placement: fills PL_VOL and PL_REPO from the placement file (key=value lines, as data).
read_placement() {
  local line
  PL_VOL=""
  PL_REPO=""
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in
      volume=nvme-[deg]) PL_VOL=${line#volume=} ;;
      repo=*) PL_REPO=${line#repo=} ;;
      *) gf_die 2 "placement file has an unexpected line" ;;
    esac
  done <"$placement"
  [ -n "$PL_VOL" ] || gf_die 2 "placement file has no volume"
  gf_validate_repo "$PL_REPO"
}

# volume_free VOLUME: sets FREE_AVAIL and FREE_PCT (floor of avail*100/size) from the df shape
# (a header line, then "avail size" in bytes). GEL_DF replaces df in internal runs only.
volume_free() {
  local path=$GF_ROOT/srv/geldar/$1 out line avail="" size=""
  if [ -n "$GF_DF" ]; then
    out=$("$GF_DF" "$path" 2>/dev/null) || return 1
  else
    out=$(df -B1 --output=avail,size "$path" 2>/dev/null) || return 1
  fi
  line=$(printf '%s\n' "$out" | sed -n '2p')
  read -r avail size <<<"$line" || true
  [[ $avail =~ ^[0-9]+$ && $size =~ ^[0-9]+$ ]] || return 1
  [ "$size" -gt 0 ] || return 1
  FREE_AVAIL=$avail
  FREE_PCT=$((avail * 100 / size))
}

# choose_volume: the volume with the most free bytes among those at or above min_free_pct
# (a volume exactly at the threshold is kept). Sets CHOSEN and CHOSEN_PCT, or exit 3.
choose_volume() {
  local v best_avail=-1
  CHOSEN=""
  for v in "${VOLUMES[@]}"; do
    volume_free "$v" || continue
    [ "$FREE_PCT" -ge "$min_free" ] || continue
    if [ "$FREE_AVAIL" -gt "$best_avail" ]; then
      best_avail=$FREE_AVAIL
      CHOSEN=$v
      CHOSEN_PCT=$FREE_PCT
    fi
  done
  [ -n "$CHOSEN" ] || gf_die 3 "no data volume has at least ${min_free}% free"
}

# count_placements: sets COUNT to the number of placement files (the cap's count).
count_placements() {
  local f
  COUNT=0
  for f in "$GF_ROOT/etc/geldar/placement"/*; do
    if [ -f "$f" ]; then
      COUNT=$((COUNT + 1))
    fi
  done
}

# write_placement VOLUME REPO: writes the placement file atomically (temp file, then rename).
write_placement() {
  local tmp
  mkdir -p "$GF_ROOT/etc/geldar/placement"
  tmp=$(mktemp "$GF_ROOT/etc/geldar/placement/.tmp.XXXXXX")
  printf 'volume=%s\nrepo=%s\n' "$1" "$2" >"$tmp"
  mv -f "$tmp" "$placement"
}

if [ -n "$reserve" ]; then
  gf_lock_global
fi
gf_conf min_free_pct
min_free=$GF_CONF

if [ -f "$placement" ]; then
  read_placement
  gf_read_roster "$id"
  [ "$PL_REPO" = "$GF_REPO" ] || gf_die 4 "placement repo differs from the roster"
  volume_free "$PL_VOL" || gf_die 3 "placement volume has no data"
  pick_vol=$PL_VOL
  pick_pct=$FREE_PCT
else
  if [ -n "$reserve" ]; then
    gf_conf max_hosts
    max_hosts=$GF_CONF
    gf_read_roster "$id"
    count_placements
    [ "$COUNT" -lt "$max_hosts" ] || gf_die 5 "max_hosts cap reached"
  fi
  choose_volume
  pick_vol=$CHOSEN
  pick_pct=$CHOSEN_PCT
  if [ -n "$reserve" ]; then
    write_placement "$pick_vol" "$GF_REPO"
  fi
fi

printf 'volume=%s free_pct=%s\n' "$pick_vol" "$pick_pct"
