# Reading and validating a player (H-19, N4). Sourced; bash 3.2 syntax only.
# Nothing here evals repo text: values are matched with fixed patterns and kept in variables.

GP_GROUPS="$GP_GROUPS pre"

# The reason text of held/info (only the reason= line, found with case, never sourced).
held_reason() {
  local line reason=""
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in
      reason=*)
        reason=${line#reason=}
        break
        ;;
    esac
  done < "$(player_dir "$1")/held/info" 2> /dev/null
  printf '%s' "$reason" | sanitize
}

# guard_not_held id: a held session blocks every launch, before any docker call.
guard_not_held() {
  local id=$1
  if [ -d "$(player_dir "$id")/held" ]; then
    die 1 held "$id" "$(held_reason "$id")" "$id"
  fi
  return 0
}

# Leaves the refusal to the caller's exit handler; prints one line and exits.
pj_fail() {
  die 1 bad_player_json "$1" "$2"
}

# The branch recorded for the player, validated (bad_branch otherwise). Sets PL_BRANCH.
read_branch() {
  local id=$1 f line=""
  f="$(player_dir "$id")/branch"
  [ -f "$f" ] || die 1 bad_branch "$id"
  IFS= read -r line < "$f" || [ -n "$line" ]
  valid_branch "$line" || die 1 bad_branch "$id"
  PL_BRANCH=$line
}

# private_host name: succeeds when the name is local or private (single label, a reserved name
# or suffix, or an empty label). `.test` stays allowed: the end-to-end tests use world.test and
# it never resolves publicly (RFC 6761). xn-- labels get no special treatment.
private_host() {
  case $1 in
    '' | .* | *. | *..*) return 0 ;;
    *.*) ;;
    *) return 0 ;;
  esac
  case $1 in
    localhost | host.docker.internal | gateway.docker.internal | kubernetes.docker.internal) return 0 ;;
    *.localhost | *.local | *.internal | *.localdomain | *.lan | *.home | *.home.arpa) return 0 ;;
    *.corp | *.intranet | *.private | *.invalid | *.example | *.onion) return 0 ;;
  esac
  return 1
}

# Is the host part of an mcp_url acceptable: a DNS name whose last label holds a letter, so
# IP forms (dotted quads, 127.1, 2130706433) are refused. A port, if any, is 80 or 443.
valid_mcp_url() {
  local url=$1 re='^https?://[^/@ ]+/[A-Za-z0-9._~/-]*$' auth host port="" hre='^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'
  [[ $url =~ $re ]] || return 1
  auth=${url#*://}
  auth=${auth%%/*}
  host=$auth
  case $auth in
    *:*)
      host=${auth%%:*}
      port=${auth#*:}
      ;;
  esac
  [[ $host =~ $hre ]] || return 1
  private_host "$host" && return 1
  case $url in
    */../* | */..) return 1 ;;
  esac
  case ${host##*.} in
    *[a-z]*) ;;
    *) return 1 ;;
  esac
  case $port in
    '' | 80 | 443) ;;
    *) return 1 ;;
  esac
  return 0
}

# read_player id [rev]: sets PL_CLONE, PL_BRANCH and the validated player.json fields (PL_*).
# player.json is read from the committed tree at rev (default HEAD), never the working file.
read_player() {
  local id=$1 rev=${2:-HEAD} d text k line n v re
  d=$(player_dir "$id")
  [ -f "$d/clone" ] || die 1 no_such_player "$id" "$id"
  IFS= read -r PL_CLONE < "$d/clone" || [ -n "$PL_CLONE" ]
  [ -d "$PL_CLONE" ] || die 1 no_such_player "$id" "$id"
  read_branch "$id"
  text=$(git_cmd -C "$PL_CLONE" show "$rev:player.json" 2> /dev/null) ||
    pj_fail "$id" 'player.json cannot be read'
  for k in player_id name shard mcp_url harness declared_model kit_version kit_image; do
    n=0
    v=""
    re="^  \"$k\": \"(.*)\",?\$"
    while IFS= read -r line || [ -n "$line" ]; do
      if [[ $line =~ $re ]]; then
        n=$((n + 1))
        v=${BASH_REMATCH[1]}
      fi
    done << TEXT
$text
TEXT
    [ "$n" -eq 1 ] || pj_fail "$id" "$k is missing or repeated"
    printf -v "PLV_$k" '%s' "$v"
  done
  [ "$PLV_player_id" = "$id" ] || pj_fail "$id" 'player_id'
  [ "${#PLV_name}" -le 40 ] || pj_fail "$id" 'name'
  re='^$|^[a-z][a-z0-9-]{0,30}$'
  [[ $PLV_shard =~ $re ]] || pj_fail "$id" 'shard'
  re='^$|^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'
  [[ $PLV_kit_version =~ $re ]] || pj_fail "$id" 'kit_version'
  valid_mcp_url "$PLV_mcp_url" || pj_fail "$id" 'mcp_url'
  case $PLV_harness in
    claude) ;;
    codex) die 1 harness_unsupported "$id" ;;
    *) pj_fail "$id" 'harness' ;;
  esac
  if [ -z "${GELDAR_KIT_IMAGE:-}" ]; then
    valid_kit_image "$PLV_kit_image" || pj_fail "$id" 'kit_image'
  fi
  resolve_kit_image "$PLV_kit_image"
  PL_MCP_URL=$PLV_mcp_url
  PL_NAME=$PLV_name
  PL_SHARD=$PLV_shard
  PL_MODEL=$PLV_declared_model
  PL_KIT_IMAGE=$GP_IMAGE
}
