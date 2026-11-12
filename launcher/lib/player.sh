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
# IP forms (dotted quads, 127.1, 2130706433) are refused. The host must also equal that of
# mcp_base in world.conf (SC-80); a port, if any, is 80, 443 or the owner-set mcp_port.
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
  # SC-80: a second argument "base" is for new's own base address, which is not yet a player URL.
  if [ "${2-}" = base ]; then
    case $port in
      '' | 80 | 443) return 0 ;;
    esac
  fi
  mcp_port_ok "$url" "$host" "$port" || return 1
  return 0
}

# SC-76, SC-80: on every port the URL's scheme and host must equal those of mcp_base in the
# launcher's own world.conf; a port other than 80 and 443 must also equal the owner-set mcp_port.
# Fails closed: no reader, no mcp_base, no match, no port.
mcp_port_ok() {
  local url=$1 host=$2 port=$3 LC_ALL=C cfg base hre='^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' bre='^(https?)://([^/@:?#[:space:]]+)(:[0-9]+)?$' bhost
  type world_conf > /dev/null 2>&1 || return 1
  case $port in
    '' | 80 | 443) ;;
    *)
      cfg=$(world_conf mcp_port)
      case $cfg in
        '' | *[!0-9]* | 0*) return 1 ;;
      esac
      [ "${#cfg}" -le 5 ] && [ "$cfg" -ge 1024 ] && [ "$cfg" -le 65535 ] || return 1
      [ "$port" = "$cfg" ] || return 1
      ;;
  esac
  base=$(world_conf mcp_base)
  [[ $base =~ $bre ]] || return 1
  [ "${url%%://*}" = "${BASH_REMATCH[1]}" ] || return 1
  bhost=${BASH_REMATCH[2]}
  [[ $bhost =~ $hre ]] || return 1
  private_host "$bhost" && return 1
  [ "$bhost" = "$host" ] || return 1
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

# SC-163a: the persistent player (decision 64). One compose project per player: geldar-player-<id>.
# pl_keeper_remote id: sets PL_REMOTE, the keeper's push address, from the clone's origin (github.com only).
pl_keeper_remote() {
  local id=$1 url rest=""
  url=$(git_cmd -C "$PL_CLONE" remote get-url origin 2> /dev/null) || url=""
  url=${url%/}
  url=${url%.git}
  case $url in
    https://github.com/*) rest=${url#https://github.com/} ;;
    git@github.com:*) rest=${url#git@github.com:} ;;
    ssh://git@github.com/*) rest=${url#ssh://git@github.com/} ;;
    *) die 1 player_remote_bad "$id" ;;
  esac
  [[ $rest =~ ^([A-Za-z0-9._-]+)/([A-Za-z0-9._-]+)$ ]] || die 1 player_remote_bad "$id"
  PL_REMOTE="ssh://git@ssh.github.com:443/${BASH_REMATCH[1]}/${BASH_REMATCH[2]}.git"
}

# pl_secrets id: sets PL_SECRET_MCP (the MCP token file) and PL_SECRET_LOGIN (the shared login), both
# empty when absent. Only the masking and the compose environment read them; nothing is printed.
pl_secrets() {
  local d
  d=$(player_dir "$1")
  PL_SECRET_MCP=""
  PL_SECRET_LOGIN=""
  if [ -f "$d/token" ] && [ ! -L "$d/token" ]; then
    IFS= read -r PL_SECRET_MCP < "$d/token" || true
  fi
  if auth_usable; then
    PL_SECRET_LOGIN=$(auth_load) || PL_SECRET_LOGIN=""
  fi
}

# pl_compose id args...: docker compose for the player's project. The values are passed in the
# environment; the tokens go in by name only, so no argument ever carries one.
pl_compose() {
  local id=$1 d share
  shift
  d=$(player_dir "$id")
  share=$(share_dir)
  case $d in
    *[[:cntrl:]]* | *,* | *:*) die 1 bad_state_path ;;
  esac
  pl_keeper_remote "$id"
  (
    unset GH_TOKEN GITHUB_TOKEN ANTHROPIC_API_KEY GELDAR_DEV_MCP_URL GELDAR_MCP_URL GELDAR_MCP_TOKEN CLAUDE_CODE_OAUTH_TOKEN
    pl_secrets "$id"
    if [ -n "$PL_SECRET_MCP" ]; then export GELDAR_MCP_TOKEN="$PL_SECRET_MCP"; fi
    if [ -n "$PL_SECRET_LOGIN" ]; then export CLAUDE_CODE_OAUTH_TOKEN="$PL_SECRET_LOGIN"; fi
    export KIT_IMAGE="$PL_KIT_IMAGE" GELDAR_ID="$id" GELDAR_KEEPER_REMOTE="$PL_REMOTE" GELDAR_MCP_URL="$PL_MCP_URL"
    export GELDAR_DEPLOY_KEY_FILE="$d/deploy-key" GELDAR_WORLD_ALLOWLIST="$d/pub/allowlist-world.txt"
    export GELDAR_WORLD_PORTS="$d/pub/allowlist-world-ports.txt"
    docker_cmd compose -p "geldar-player-$id" -f "$share/compose/player.yml" "$@"
  )
}

# pl_mask: stdin to stdout with the stored secrets and token-like text replaced by [masked].
pl_mask() {
  PL_MASK_A=${PL_SECRET_MCP:-} PL_MASK_B=${PL_SECRET_LOGIN:-} perl -pe '
    BEGIN { $a = $ENV{PL_MASK_A}; $b = $ENV{PL_MASK_B} }
    s/\Q$a\E/[masked]/g if length $a;
    s/\Q$b\E/[masked]/g if length $b;
    s/GELDAR_MCP_TOKEN=\S*/GELDAR_MCP_TOKEN=[masked]/g;
    s/sk-ant-[A-Za-z0-9_-]*/[masked]/g;
    s/(CLAUDE_CODE_OAUTH_TOKEN|oauth[_-]?token)[ :=]+\S+/$1 [masked]/gi;
  '
}

# pl_helper id role vol uid mode script: runs script in a throwaway container as uid, with the
# volume vol mounted at /vol (mode ro or rw). The container gets no other volume and no secret.
pl_helper() {
  local id=$1 role=$2 vol=$3 uid=$4 mode=$5 script=$6
  helper_run "player-$role" "geldar-$role-$id" "$PL_KIT_IMAGE" --user "$uid:$uid" -v "$vol:/vol:$mode" -- "$script"
}

# pl_allowlist id: the world allowlist files for the proxy (the same writer as the session).
pl_allowlist() {
  local d
  d=$(player_dir "$1")
  private_mkdir "$d"
  write_allowlist "$d/pub" "$PL_MCP_URL"
}

# pl_prepare_ws id: the workspace volume gets the host clone once (a copy with its .git). A volume
# that already holds a .git is kept as it is, so a second start changes nothing.
pl_prepare_ws() {
  local id=$1 name="geldar-ws-$1"
  if helper_run player-ws "geldar-wscheck-$id" "$PL_KIT_IMAGE" -v "$name:/player:ro" -- 'test -e /player/.git' > /dev/null 2>&1; then
    return 0
  fi
  if helper_run player-ws "geldar-wsinit-$id" "$PL_KIT_IMAGE" -v "$PL_CLONE:/in:ro" -v "$name:/player" -- 'cp -a /in/. /player/' > /dev/null 2>&1; then
    return 0
  fi
  docker_cmd volume rm "$name" > /dev/null 2>&1
  die 1 player_ws_failed "$id"
}

# pl_ready id: what a start needs: the deploy key, the MCP token file and the shared login.
pl_ready() {
  local d
  d=$(player_dir "$1")
  [ -f "$d/deploy-key" ] || die 1 player_no_key "$1"
  [ -f "$d/token" ] || die 1 player_no_token "$1"
  auth_usable || die 1 player_no_login
}

# start <id>: the checks, the workspace once, then compose up -d (idempotent).
verb_start() {
  [ $# -eq 1 ] || die 2 usage
  read_player "$1"
  pl_ready "$1"
  lock_acquire "$1"
  pl_allowlist "$1"
  pl_prepare_ws "$1"
  pl_compose "$1" up -d || die 1 compose_failed
  say player_started "$1"
}

# restart <id>: the same checks, then the containers are recreated.
verb_restart() {
  [ $# -eq 1 ] || die 2 usage
  read_player "$1"
  pl_ready "$1"
  lock_acquire "$1"
  pl_allowlist "$1"
  pl_compose "$1" up -d --force-recreate || die 1 compose_failed
  say player_restarted "$1"
}

# stop <id>: stops the containers; the volumes are kept.
verb_stop() {
  [ $# -eq 1 ] || die 2 usage
  read_player "$1"
  lock_acquire "$1"
  pl_compose "$1" stop || die 1 compose_failed
  say player_stopped "$1"
}

# pl_status_part id role vol uid script: one part of player-status, with secrets masked. A part that
# cannot be read (no volume, no file, a failed helper) prints player_no_status for its role instead.
pl_status_part() {
  local id=$1 role=$2 vol=$3 uid=$4 script=$5 out
  out=$(pl_helper "$id" "$role" "$vol" "$uid" ro "$script" 2> /dev/null) || {
    say player_no_status "$role"
    return 0
  }
  printf '%s\n' "$out" | pl_mask
}

# player-status <id>: container states, the supervisor's status.json, the keeper's push time
# (last_pushed_head and last_run_utc from its status.json), the last upstream sync of both, HELD if set.
# Reads only the files named here; no secret is printed.
verb_player_status() {
  [ $# -eq 1 ] || die 2 usage
  local id=$1 reason
  read_player "$id"
  pl_secrets "$id"
  pl_compose "$id" ps --all --format '{{.Service}} {{.State}}' 2> /dev/null | pl_mask
  printf 'supervisor status:\n'
  pl_status_part "$id" supervisor "geldar-sup-$id" 1001 'cat /vol/status.json'
  printf 'keeper status:\n'
  pl_status_part "$id" keeper "geldar-keep-$id" 1002 'grep -E "\"(last_pushed_head|last_run_utc|upstream_head|upstream_result)\"" /vol/status.json'
  if reason=$(pl_helper "$id" keeper "geldar-keep-$id" 1002 ro 'cat /vol/HELD' 2> /dev/null); then
    say player_held "$(printf '%s' "$reason" | sanitize)"
  fi
}

# logs <id> [--follow]: the supervisor's log and the containers' output, with the secrets masked.
verb_logs() {
  [ $# -ge 1 ] && [ $# -le 2 ] || die 2 usage
  local id=$1 follow=0
  case ${2-} in
    '') ;;
    --follow) follow=1 ;;
    *) die 2 usage ;;
  esac
  read_player "$id"
  pl_secrets "$id"
  if [ "$follow" -eq 1 ]; then
    pl_compose "$id" logs --no-color --follow player keeper | pl_mask
    return 0
  fi
  pl_helper "$id" supervisor "geldar-sup-$id" 1001 ro 'tail -n 200 /vol/supervisor.log' 2> /dev/null | pl_mask || true
  pl_compose "$id" logs --no-color --tail 200 player keeper 2> /dev/null | pl_mask
}

# pl_make_key id dir: a new ed25519 key (no passphrase) in dir/deploy-key and dir/deploy-key.pub.
# ssh-keygen on the host when there is one, else ssh-keygen in a throwaway kit container. The key
# is made in its own folder, so the container never sees the token files.
pl_make_key() {
  local id=$1 d=$2 kg tmp
  kg=$(gp_env GELDAR_SSH_KEYGEN)
  [ -n "$kg" ] || kg=ssh-keygen
  tmp="$d/keygen"
  rm -rf "$tmp"
  private_mkdir "$d/keygen"
  if command -v "$kg" > /dev/null 2>&1; then
    "$kg" -q -t ed25519 -N '' -C "geldar-$id" -f "$tmp/deploy-key" < /dev/null > /dev/null 2>&1 ||
      die 1 player_key_failed "$id"
  else
    helper_run player-key "geldar-key-$id" "$PL_KIT_IMAGE" --user "$(id -u):$(id -g)" -v "$tmp:/out" -- \
      "ssh-keygen -q -t ed25519 -N '' -C geldar-$id -f /out/deploy-key" > /dev/null 2>&1 ||
      die 1 player_key_failed "$id"
  fi
  [ -f "$tmp/deploy-key" ] && [ -f "$tmp/deploy-key.pub" ] || die 1 player_key_failed "$id"
  chmod 600 "$tmp/deploy-key" "$tmp/deploy-key.pub"
  mv -f "$tmp/deploy-key" "$d/deploy-key"
  mv -f "$tmp/deploy-key.pub" "$d/deploy-key.pub"
  rm -rf "$tmp"
}

# deploy-key <id> [--rotate]: prints the public key only. --rotate makes a new key first.
verb_deploy_key() {
  [ $# -ge 1 ] && [ $# -le 2 ] || die 2 usage
  local id=$1 rotate=0 d
  case ${2-} in
    '') ;;
    --rotate) rotate=1 ;;
    *) die 2 usage ;;
  esac
  read_player "$id"
  d=$(player_dir "$id")
  private_mkdir "$d"
  if [ "$rotate" -eq 1 ] || [ ! -f "$d/deploy-key.pub" ] || [ ! -f "$d/deploy-key" ]; then
    pl_make_key "$id" "$d"
  fi
  cat "$d/deploy-key.pub"
  if [ "$rotate" -eq 1 ]; then
    say player_key_rotated "$id"
  else
    say player_key_add "$id"
  fi
}

# release-hold <id>: prints the HELD reason, then removes HELD: the only way to clear it. A STOP left by
# a failed upstream sync (its first line starts with auto: upstream sync) is cleared the same way. The
# supervisor's own uid owns that volume and its files, so no root helper is needed.
verb_release_hold() {
  [ $# -eq 1 ] || die 2 usage
  local id=$1 reason stop cleared=0
  read_player "$id"
  if reason=$(pl_helper "$id" keeper "geldar-keep-$id" 1002 ro 'cat /vol/HELD' 2> /dev/null); then
    say player_held "$(printf '%s' "$reason" | sanitize)"
    pl_helper "$id" keeper "geldar-keep-$id" 1002 rw 'rm -f /vol/HELD' > /dev/null 2>&1 ||
      die 1 player_release_failed "$id"
    cleared=1
  fi
  if stop=$(pl_helper "$id" supervisor "geldar-sup-$id" 1001 ro 'cat /vol/STOP' 2> /dev/null) &&
    [ "${stop#auto: upstream sync}" != "$stop" ]; then
    say player_stop_upstream "$(printf '%s' "$stop" | sanitize)"
    pl_helper "$id" supervisor "geldar-sup-$id" 1001 rw 'rm -f /vol/STOP' > /dev/null 2>&1 ||
      die 1 player_release_failed "$id"
    cleared=1
  fi
  if [ "$cleared" -eq 0 ]; then
    say player_not_held "$id"
    return 0
  fi
  say player_released "$id"
}

# pl_running id: true when the keeper and the player are both running (the persistent group). The
# names are the compose service names in image/compose/player.yml; `ps` prints one per line.
pl_running() {
  local up
  up=$(pl_compose "$1" ps --status running --format '{{.Service}}' 2> /dev/null) || return 1
  printf '%s\n' "$up" | grep -qx keeper && printf '%s\n' "$up" | grep -qx player
}

# sync <id>: asks the keeper to fetch upstream now. It touches sync-request in the keeper's state; the
# keeper fetches and the supervisor applies the change between runs, never during one.
verb_sync() {
  [ $# -eq 1 ] || die 2 usage
  read_player "$1"
  pl_running "$1" || die 1 player_not_running "$1"
  pl_helper "$1" keeper "geldar-keep-$1" 1002 rw 'touch /vol/sync-request' > /dev/null 2>&1 ||
    die 1 player_sync_failed "$1"
  say player_sync_requested "$1"
}
