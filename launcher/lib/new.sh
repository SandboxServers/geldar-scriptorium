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

# Reads one persona file once as bytes, checks it, and sets PERSONA_TEXT to the bytes with CRLF
# turned into LF. Arguments: path, maximum bytes, player id. Refusals die with persona_bad.
persona_read() {
  local f=$1 max=$2 id=$3 hex b n=0 need=0 lo=80 hi=bf cr="" fmt="" bad="" first size
  # The size is checked before the file is read, so a huge file costs one wc.
  size=$(wc -c < "$f" 2> /dev/null | tr -d ' ') || size=0
  [ -n "$size" ] || size=0
  if [ "$size" -lt 1 ] || [ "$size" -gt "$max" ]; then
    die 1 persona_bad "$id" size
  fi
  hex=$(od -An -v -tx1 "$f" 2> /dev/null | tr -s ' \n' '  ') || hex=""
  for b in $hex; do
    n=$((n + 1))
  done
  if [ "$n" -lt 1 ] || [ "$n" -gt "$max" ]; then
    die 1 persona_bad "$id" size
  fi
  for b in $hex; do
    if [ -n "$cr" ]; then
      [ "$b" = 0a ] || die 1 persona_bad "$id" control
      cr=""
    fi
    if [ "$need" -gt 0 ]; then
      case $b in
        [89ab][0-9a-f]) ;;
        *) bad=1 ;;
      esac
      if [ -n "$first" ]; then
        first=""
        if [ $((16#$b)) -lt $((16#$lo)) ] || [ $((16#$b)) -gt $((16#$hi)) ]; then bad=1; fi
      fi
      [ -z "$bad" ] || die 1 persona_bad "$id" utf8
      need=$((need - 1))
      fmt="$fmt\\x$b"
      continue
    fi
    case $b in
      0d)
        cr=1
        continue
        ;;
      09 | 0a) ;;
      [01][0-9a-f] | 7f) die 1 persona_bad "$id" control ;;
      [2-7][0-9a-f]) ;;
      c[2-9a-f] | d[0-9a-f]) need=1 lo=80 hi=bf first=1 ;;
      e0) need=2 lo=a0 hi=bf first=1 ;;
      ed) need=2 lo=80 hi=9f first=1 ;;
      e[1-9a-f] | ee | ef) need=2 lo=80 hi=bf first=1 ;;
      f0) need=3 lo=90 hi=bf first=1 ;;
      f[1-3]) need=3 lo=80 hi=bf first=1 ;;
      f4) need=3 lo=80 hi=8f first=1 ;;
      *) die 1 persona_bad "$id" utf8 ;;
    esac
    fmt="$fmt\\x$b"
  done
  [ -z "$cr" ] || die 1 persona_bad "$id" control
  [ "$need" -eq 0 ] || die 1 persona_bad "$id" utf8
  hex=" $hex "
  case $hex in
    *" c2 "[89][0-9a-f]" "*) die 1 persona_bad "$id" control ;;
    *" e2 80 "8[b-f]" "* | *" e2 80 "a[89a-e]" "* | *" e2 81 a0 "* | *" e2 81 a"[6-9]" "*) ;;
    *" e2 81 a"[1-4]" "* | *" e2 81 a"[a-f]" "* | *" e2 a0 80 "*) ;;
    *" c2 a0 "* | *" e3 80 80 "* | *" e3 85 a4 "* | *" e1 a0 8e "* | *" ef be a0 "*) ;;
    *" d8 9c "* | *" ef bb bf "* | *" c2 ad "* | *" ef b8 "8[0-9a-f]" "*) ;;
    *" f3 a0 8"[01]" "* | *" f3 a0 8"[4-6]" "* | *" f3 a0 87 "[89a][0-9a-f]" "*) ;;
    *) hex="" ;;
  esac
  [ -z "$hex" ] || die 1 persona_bad "$id" invisible
  PERSONA_TEXT=$(
    printf "$fmt"
    printf x
  )
  PERSONA_TEXT=${PERSONA_TEXT%x}
}

# Checks one persona path component with lstat semantics: a link is refused first.
persona_part() {
  local p=$1 kind=$2 dir=$3 id=$4
  if [ -L "$p" ]; then
    die 1 persona_bad "$id" link
  fi
  [ -e "$p" ] || die 1 persona_missing "$dir" "$id"
  if [ "$kind" = d ]; then
    [ -d "$p" ] || die 1 persona_bad "$id" type
  else
    [ -f "$p" ] || die 1 persona_bad "$id" type
  fi
}

# Validates --persona-dir before anything is created. Sets PERSONA_IDENTITY and PERSONA_GOALS.
persona_load() {
  local dir=$1 id=$2 root st
  [ -e "$dir" ] || die 1 persona_missing "$dir" "$id"
  [ -d "$dir" ] || die 1 persona_bad "$id" type
  root="$dir/$id"
  persona_part "$root" d "$dir" "$id"
  persona_part "$root/memory" d "$dir" "$id"
  persona_part "$root/memory/identity.md" f "$dir" "$id"
  persona_part "$root/memory/goals.md" f "$dir" "$id"
  persona_read "$root/memory/identity.md" 8192 "$id"
  PERSONA_IDENTITY=$PERSONA_TEXT
  # LC_ALL=C: only ASCII blanks count as blank, the same as the PowerShell twin's [ \t].
  st=$(printf '%s' "$PERSONA_IDENTITY" | LC_ALL=C grep -v -e '^[[:space:]]*$' -e '^# Identity$')
  if [ -z "$st" ] || [ "$st" = "Who you are. Written once, at your birth." ]; then
    die 1 persona_bad "$id" empty
  fi
  persona_read "$root/memory/goals.md" 4096 "$id"
  PERSONA_GOALS=$PERSONA_TEXT
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

# Ends new after GitHub made the repository: removes the local clone, then prints the message and the
# recovery line. Arguments: clone folder, player id, then the message key and its arguments.
die_after_create() {
  local clone=$1 id=$2
  shift 2
  rm -rf "$clone"
  say "$@"
  say repo_on_github "$id"
  exit 1
}

verb_new() {
  local id=$1 vis="" mock="" tokfile="" shard=commons base i a clone name url d persona=""
  local have_persona=""
  local shre='^[a-z][a-z0-9-]{0,30}$' gh players add=player.json
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
      --persona-dir)
        [ $# -ge 2 ] || die 2 usage
        [ -z "$have_persona" ] || die 1 persona_bad "$id" twice
        have_persona=1
        persona=$2
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
  [ -z "$have_persona" ] || persona_load "$persona" "$id"
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
    # A clone counts only if it has a commit: GitHub can fill the template after repo create returns.
    if (cd "$players" && run_bounded 120 "$gh" repo clone "$name") > /dev/null 2>&1 &&
      [ -d "$clone/.git" ] && git_cmd -C "$clone" rev-parse --verify -q HEAD > /dev/null 2>&1; then
      break
    fi
    rm -rf "$clone"
    [ "$i" -lt 5 ] || die_after_create "$clone" "$id" clone_timeout "$id"
    gp_sleep 3
  done

  write_player_json "$clone/player.json" "$id" "$shard" "$url"
  if [ -n "$have_persona" ]; then
    mkdir -p "$clone/memory"
    printf '%s' "$PERSONA_IDENTITY" > "$clone/memory/identity.md"
    printf '%s' "$PERSONA_GOALS" > "$clone/memory/goals.md"
    add="player.json memory/identity.md memory/goals.md"
  fi
  # shellcheck disable=SC2086
  git_cmd -C "$clone" add $add > /dev/null 2>&1 ||
    die_after_create "$clone" "$id" gh_failed "$id" 'add'
  a="player-$id@users.noreply.github.com"
  GIT_AUTHOR_NAME=$name GIT_AUTHOR_EMAIL=$a GIT_COMMITTER_NAME=$name GIT_COMMITTER_EMAIL=$a \
    git_cmd -C "$clone" -c "user.name=$name" -c "user.email=$a" -c commit.gpgsign=false \
    -c tag.gpgsign=false commit -q -m "player: $id" > /dev/null 2>&1 ||
    die_after_create "$clone" "$id" gh_failed "$id" 'commit'
  run_bounded 120 git_cmd -C "$clone" push -q origin HEAD > /dev/null 2>&1 ||
    die_after_create "$clone" "$id" gh_failed "$id" 'push'

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
  if [ -n "$have_persona" ]; then
    say created_seeded "$id" "$id"
  else
    say created "$id" "$id"
  fi
}
