# new: create a player repository from the template and record it (decision 11, 0011).
# Sourced; bash 3.2 syntax only.

GP_GROUPS="$GP_GROUPS new"

# Sleeps n seconds; GELDAR_SLEEP replaces n under GELDAR_INTERNAL=1.
gp_sleep() {
  local s
  s=$(gp_env GELDAR_SLEEP)
  case $s in
    '' | *[!0-9.]*) s=$1 ;;
  esac
  sleep "$s"
}

# The value of a key in world.conf (read as data, never sourced).
world_conf() {
  local f line
  f="$(share_dir)/config/world.conf"
  [ -f "$f" ] || f="$GP_DIR/config/world.conf"
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    case $line in
      "$1="*)
        printf '%s' "${line#*=}"
        return 0
        ;;
    esac
  done < "$f" 2> /dev/null
  return 0
}

# A base address: scheme and host only; the host rules are those of valid_mcp_url.
valid_base_url() {
  local re='^https?://[^/@?# ]+$'
  [[ ${1-} =~ $re ]] || return 1
  valid_mcp_url "$1/p/x"
}

# Reads the token file: one line, trimmed, nothing after it. Sets NEW_TOKEN.
read_token_file() {
  local line="" re='^[A-Za-z0-9._~-]{16,200}$' extra
  [ -f "$1" ] || die 1 bad_token
  {
    IFS= read -r line || true
    while IFS= read -r extra || [ -n "$extra" ]; do
      extra=${extra%$'\r'}
      [ -z "$extra" ] || die 1 bad_token
    done
  } < "$1"
  line=${line%$'\r'}
  line=${line#"${line%%[![:space:]]*}"}
  line=${line%"${line##*[![:space:]]}"}
  [[ $line =~ $re ]] || die 1 bad_token
  NEW_TOKEN=$line
}

# player.json from the template with the three values replaced, line by line.
write_player_json() {
  local f=$1 id=$2 shard=$3 url=$4 line out=""
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in
      '  "player_id": '*) line="  \"player_id\": \"$id\"," ;;
      '  "shard": '*) line="  \"shard\": \"$shard\"," ;;
      '  "mcp_url": '*) line="  \"mcp_url\": \"$url\"," ;;
    esac
    out="$out$line"$'\n'
  done < "$f"
  printf '%s' "$out" > "$f.new" && mv "$f.new" "$f"
}

# Shard and visibility rules (0015). Sets NEW_VIS.
check_visibility() {
  local shard=$1 vis=$2 mock=$3 list s
  list=$(gp_env GELDAR_PRIVATE_SHARDS_TEST)
  [ -n "$list" ] || list=$(world_conf private_only_shards)
  if [ -z "$list" ]; then
    say private_list_unset
    if [ -z "$mock" ] && [ -z "$vis" ]; then
      die 1 private_required "$shard"
    fi
  else
    for s in ${list//,/ }; do
      if [ "$s" = "$shard" ] && [ "$vis" != "private" ]; then
        die 1 private_required "$shard"
      fi
    done
  fi
  NEW_VIS=public
  [ "$vis" != "private" ] || NEW_VIS=private
}

verb_new() {
  local id=$1 vis="" mock="" tokfile="" shard=commons base i a clone name url d
  local shre='^[a-z][a-z0-9-]{0,30}$' gh players
  shift
  while [ $# -gt 0 ]; do
    case $1 in
      --private | --public)
        vis=${1#--}
        shift
        ;;
      --mock | --token-file | --shard)
        [ $# -ge 2 ] || die 2 usage
        case $1 in
          --mock) mock=$2 ;;
          --token-file) tokfile=$2 ;;
          --shard) shard=$2 ;;
        esac
        shift 2
        ;;
      *) die 2 usage ;;
    esac
  done
  [[ $shard =~ $shre ]] || die 1 bad_shard
  if [ -n "$mock" ]; then
    valid_base_url "$mock" || die 1 bad_url
    base=$mock
  else
    base=$(world_conf mcp_base)
    [ -n "$base" ] || die 1 no_world
    valid_base_url "$base" || die 1 bad_url
  fi
  NEW_TOKEN=""
  [ -z "$tokfile" ] || read_token_file "$tokfile"
  check_visibility "$shard" "$vis" "$mock"
  url="$base/p/$id"

  name="player-$id"
  players=${GELDAR_PLAYERS_DIR:-$HOME/geldar-players}
  d=$(player_dir "$id")
  if [ -e "$players/$name" ] || [ -e "$d/clone" ]; then
    die 1 repo_exists "$id"
  fi
  gh=${GELDAR_GH:-gh}
  [ "$NEW_VIS" = "private" ] || say public_notice

  # The human's own clone and directory keep the user's normal modes.
  umask 022
  mkdir -p "$players"
  (cd "$players" && run_bounded 120 "$gh" repo create "$name" \
    --template SandboxServers/geldar-player-template "--$NEW_VIS") > /dev/null 2>&1 ||
    die 1 gh_failed "$id" 'create'
  clone="$players/$name"
  i=0
  while :; do
    i=$((i + 1))
    if (cd "$players" && run_bounded 120 "$gh" repo clone "$name") > /dev/null 2>&1 &&
      [ -d "$clone/.git" ]; then
      break
    fi
    rm -rf "$clone"
    [ "$i" -lt 5 ] || die 1 clone_timeout "$id"
    gp_sleep 3
  done

  write_player_json "$clone/player.json" "$id" "$shard" "$url"
  git_cmd -C "$clone" add player.json > /dev/null 2>&1 || die 1 gh_failed "$id" 'add'
  a="player-$id@users.noreply.github.com"
  GIT_AUTHOR_NAME=$name GIT_AUTHOR_EMAIL=$a GIT_COMMITTER_NAME=$name GIT_COMMITTER_EMAIL=$a \
    git_cmd -C "$clone" -c "user.name=$name" -c "user.email=$a" -c commit.gpgsign=false \
    -c tag.gpgsign=false commit -q -m "player: $id" > /dev/null 2>&1 ||
    die 1 gh_failed "$id" 'commit'
  run_bounded 120 git_cmd -C "$clone" push -q origin HEAD > /dev/null 2>&1 ||
    die 1 gh_failed "$id" 'push'

  umask 077
  private_mkdir "$d"
  printf '%s\n' "$clone" > "$d/clone"
  git_cmd -C "$clone" symbolic-ref --short HEAD > "$d/branch" 2> /dev/null || printf 'main\n' > "$d/branch"
  if [ -n "$NEW_TOKEN" ]; then
    (
      umask 077
      printf '%s\n' "$NEW_TOKEN" > "$d/token"
    )
  fi
  say created "$id" "$id"
}
