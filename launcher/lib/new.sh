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
  valid_mcp_url "$1/p/x" base
}

# Reads the token file: one line, trimmed, nothing after it. Sets NEW_TOKEN.
read_token_file() {
  local line="" re='^[A-Za-z0-9._~-]{16,200}$' extra head sz1 sz2
  [ -f "$1" ] || die 1 bad_token
  # A leading byte-order mark or any NUL byte (UTF-16 has them) is refused, as the PowerShell twin does.
  head=$(head -c 3 "$1" | od -An -tx1 | tr -d ' \n')
  [ "$head" != efbbbf ] || die 1 bad_token
  sz1=$(wc -c < "$1" | tr -d ' ')
  sz2=$(LC_ALL=C tr -d '\000' < "$1" | wc -c | tr -d ' ')
  [ "$sz1" = "$sz2" ] || die 1 bad_token
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
  # A Geldar token file reads GELDAR_MCP_TOKEN=<value>; the bare value is accepted too.
  line=${line#GELDAR_MCP_TOKEN=}
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
    # A second hard link could alias a file outside the persona folder: GNU stat, then BSD stat.
    local n
    n=$(stat -c %h -- "$p" 2>/dev/null) || n=$(stat -f %l "$p" 2>/dev/null) || n=
    case $n in
      '' | *[!0-9]*) die 1 persona_bad "$id" hardlink ;;
    esac
    [ "$n" -le 1 ] || die 1 persona_bad "$id" hardlink
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
# recovery line. Arguments: clone folder, player id, step, then the message key and its arguments.
# For an adopted repository every failure says adopt_failed: the commit may already be on the remote.
die_after_create() {
  local clone=$1 id=$2 step=$3
  shift 3
  rm -rf "$clone"
  if [ -n "${NEW_ADOPT-}" ]; then
    say adopt_failed "$NEW_REPO" "$id" "$step"
    exit 1
  fi
  say "$@"
  say repo_on_github "$id"
  exit 1
}

# Ends new on a refusal after the clone but before anything was committed: the local clone goes, and
# so does the players folder if this run made it. Arguments: clone folder, then the message and arguments.
adopt_refuse() {
  local clone=$1
  shift
  rm -rf "$clone"
  [ -z "${NEW_PLAYERS_MADE-}" ] || rmdir "$NEW_PLAYERS_DIR" 2> /dev/null || true
  die 1 "$@"
}

# Checks the repository --repo names before anything is written: it exists, its visibility is the
# requested one, and it holds nothing but README.md, LICENSE and .gitignore at the top level.
# Arguments: gh, owner/name, wanted visibility.
adopt_verify() {
  local gh=$1 repo=$2 want=$3 out v n c
  out=$(run_bounded 120 "$gh" repo view "$repo" --json visibility,isEmpty,name 2> /dev/null) ||
    die 1 repo_missing "$repo"
  v=$(printf '%s' "$out" | tr -d ' \r\n' | sed -n 's/.*"visibility":"\([A-Za-z]*\)".*/\1/p' |
    tr 'A-Z' 'a-z')
  [ "$v" = "$want" ] || die 1 repo_visibility "$repo" "${v:-unknown}" "$want"
  out=$(run_bounded 120 "$gh" api "repos/$repo/contents" --jq 'map(.name)' 2> /dev/null) ||
    die 1 repo_not_empty "$repo"
  # The answer is a JSON array of names; the quoted strings are the names. An empty list is refused:
  # a repository with no commit cannot be filled, and an answer that cannot be read is no answer.
  c=0
  while IFS= read -r n; do
    case $n in
      '"README.md"' | '"LICENSE"' | '".gitignore"') c=$((c + 1)) ;;
      *) die 1 repo_not_empty "$repo" ;;
    esac
  done <<EOF
$(printf '%s\n' "$out" | grep -o '"[^"]*"')
EOF
  [ "$c" -gt 0 ] || die 1 repo_not_empty "$repo"
}

# Checks the clone of an adopted repository: git must list nothing but plain files (mode 100644) named
# README.md, LICENSE or .gitignore, so no link can carry the template copy out of the clone.
# Arguments: clone folder. Status 1 on any other entry.
adopt_check_clone() {
  local rec mode p c=0
  while IFS= read -r -d '' rec; do
    mode=${rec%% *}
    p=${rec#*$'\t'}
    [ "$mode" = 100644 ] || return 1
    case $p in
      README.md | LICENSE | .gitignore) c=$((c + 1)) ;;
      *) return 1 ;;
    esac
  done < <(git_cmd -C "$1" ls-tree -r -z HEAD 2> /dev/null)
  [ "$c" -gt 0 ]
}

# Picks the template release the way upgrade does: the newest stable kit-v tag, or the newest prerelease
# when no tag is stable, from GELDAR_TEMPLATE_URL (under GELDAR_INTERNAL=1) or the template repository.
# Arguments: an exact version from --kit-version (optional), which must be a listed tag, else
# kit_version_unknown. Sets ADOPT_URL and ADOPT_TAG; no tag at all is template_unpinned.
adopt_template_tag() {
  local url out best tags
  url=$(gp_env GELDAR_TEMPLATE_URL)
  [ -n "$url" ] || url=$UP_TEMPLATE_URL
  out=$(mktemp "${TMPDIR:-/tmp}/gp-tags.XXXXXX") || die 1 template_unpinned
  run_bounded 60 git_cmd ls-remote --tags --refs "$url" 'refs/tags/kit-v*' > "$out" 2> /dev/null || {
    rm -f "$out"
    die 1 template_unpinned
  }
  tags=$(up_tag_versions "$out")
  rm -f "$out"
  if [ -n "${1-}" ]; then
    grep -qxF -- "$1" <<< "$tags" || die 1 kit_version_unknown "$1"
    best=$1
  else
    best=$(up_newest "$tags")
  fi
  [ -n "$best" ] || die 1 template_unpinned
  ADOPT_URL=$url
  ADOPT_TAG="kit-v$best"
}

# Copies the template's files (a shallow, hardened, unchecked-out clone of the pinned tag) into the
# clone. Nothing under .git crosses and a link in the template is refused. Sets ADOPT_EXEC to the paths
# that git records as executable. Arguments: clone folder. Status 1 on a refusal, 2 when the template
# holds more than 2000 files or 20 MB.
adopt_fill() {
  local clone=$1 tmp rec meta mode p list="" dir size n=0 total=0
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/gp-tpl.XXXXXX") || return 1
  ADOPT_EXEC=""
  if ! run_bounded 120 git_cmd -c fetch.fsckObjects=true -c transfer.fsckObjects=true -c core.autocrlf=false \
    clone -q --no-checkout --depth 1 --branch "$ADOPT_TAG" -- "$ADOPT_URL" "$tmp/tpl" > /dev/null 2>&1; then
    rm -rf "$tmp"
    return 1
  fi
  while IFS= read -r -d '' rec; do
    meta=${rec%%$'\t'*}
    mode=${meta%% *}
    size=${meta##* }
    p=${rec#*$'\t'}
    case $mode in
      100644) ;;
      100755) ADOPT_EXEC="$ADOPT_EXEC$p"$'\n' ;;
      *)
        rm -rf "$tmp"
        return 1
        ;;
    esac
    n=$((n + 1))
    case $size in
      '' | *[!0-9]*)
        rm -rf "$tmp"
        return 1
        ;;
    esac
    total=$((total + size))
    if [ "$n" -gt 2000 ] || [ "$total" -gt 20971520 ]; then
      rm -rf "$tmp"
      return 2
    fi
    # Any letter case of .git is refused (no fork per entry: a template may list 2000 files).
    case /$p/ in
      */../* | */./* | */[.][Gg][Ii][Tt]/* | //* | *\\* | *$'\n'*)
        rm -rf "$tmp"
        return 1
        ;;
    esac
    list="$list$p"$'\n'
  done < <(git_cmd -C "$tmp/tpl" ls-tree -r -l -z HEAD 2> /dev/null)
  [ -n "$list" ] || {
    rm -rf "$tmp"
    return 1
  }
  git_cmd -C "$tmp/tpl" -c core.autocrlf=false checkout -q HEAD -- . > /dev/null 2>&1 || {
    rm -rf "$tmp"
    return 1
  }
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if [ -L "$tmp/tpl/$p" ] || [ ! -f "$tmp/tpl/$p" ]; then
      rm -rf "$tmp"
      return 1
    fi
    dir=$(dirname -- "./$p")
    # The destination goes first, so a link put there after the check is not written through.
    mkdir -p "$clone/$dir" && rm -f "$clone/$p" && cp -- "$tmp/tpl/$p" "$clone/$p" || {
      rm -rf "$tmp"
      return 1
    }
  done <<EOF
$list
EOF
  rm -rf "$tmp"
}
verb_new() {
  local id=$1 vis="" mock="" tokfile="" shard=commons base i a clone name url d persona=""
  local have_persona="" repo="" repo_re='^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$' p
  local kit="" kit_re='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.]+)?$'
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
      --repo)
        [ $# -ge 2 ] || die 2 usage
        [ -z "$repo" ] || die 1 repo_bad
        repo=$2
        [[ $repo =~ $repo_re ]] || die 1 repo_bad
        case ${repo#*/} in . | ..) die 1 repo_bad ;; esac
        shift 2
        ;;
      --kit-version)
        [ $# -ge 2 ] || die 1 kit_version_bad
        [ -z "$kit" ] || die 1 kit_version_bad
        [[ $2 =~ $kit_re ]] || die 1 kit_version_bad
        kit=$2
        shift 2
        ;;
      *) die 2 usage ;;
    esac
  done
  # --kit-version only means something with --repo: it names the template release to copy.
  if [ -n "$kit" ] && [ -z "$repo" ]; then die 1 kit_version_bad; fi
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
  NEW_ADOPT=""
  if [ -n "$repo" ]; then
    NEW_ADOPT=1
    NEW_REPO=$repo
    adopt_verify "$gh" "$repo" "$NEW_VIS"
    adopt_template_tag "$kit"
  fi
  [ "$NEW_VIS" = "private" ] || say public_notice
  [ -z "$mock" ] || say mock_note

  # The human's own clone and directory keep the user's normal modes.
  umask 022
  NEW_PLAYERS_DIR=$players
  NEW_PLAYERS_MADE=""
  [ -d "$players" ] || NEW_PLAYERS_MADE=1
  mkdir -p "$players"
  clone="$players/$name"
  if [ -z "$repo" ]; then
    (cd "$players" && run_bounded 120 "$gh" repo create "$name" \
      --template SandboxServers/geldar-player-template "--$NEW_VIS") > /dev/null 2>&1 ||
      die 1 gh_failed "$id" 'create'
  fi
  i=0
  while :; do
    i=$((i + 1))
    # A clone counts only if it has a commit: GitHub can fill the template after repo create returns.
    if (cd "$players" && run_bounded 120 "$gh" repo clone "${repo:-$name}" "$name") > /dev/null 2>&1 &&
      [ -d "$clone/.git" ] && git_cmd -C "$clone" rev-parse --verify -q HEAD > /dev/null 2>&1; then
      break
    fi
    rm -rf "$clone"
    [ "$i" -lt 5 ] || die_after_create "$clone" "$id" clone clone_timeout "$id"
    gp_sleep 3
  done

  if [ -n "$repo" ]; then
    # Only the three names git lists in the clone may be there; a link would carry the copy outside it.
    adopt_check_clone "$clone" || adopt_refuse "$clone" repo_not_empty "$repo"
    adopt_fill "$clone"
    case $? in
      0) ;;
      2) adopt_refuse "$clone" template_too_big ;;
      *) die_after_create "$clone" "$id" template gh_failed "$id" template ;;
    esac
    add=-A
  fi
  write_player_json "$clone/player.json" "$id" "$shard" "$url"
  if [ -n "$have_persona" ]; then
    mkdir -p "$clone/memory"
    printf '%s' "$PERSONA_IDENTITY" > "$clone/memory/identity.md"
    printf '%s' "$PERSONA_GOALS" > "$clone/memory/goals.md"
    [ -n "$repo" ] || add="player.json memory/identity.md memory/goals.md"
  fi
  # shellcheck disable=SC2086
  git_cmd -C "$clone" add $add > /dev/null 2>&1 ||
    die_after_create "$clone" "$id" add gh_failed "$id" add
  if [ -n "$repo" ]; then
    while IFS= read -r p; do
      [ -z "$p" ] || git_cmd -C "$clone" update-index --chmod=+x -- "$p" > /dev/null 2>&1
    done <<EOF
$ADOPT_EXEC
EOF
  fi
  a="player-$id@users.noreply.github.com"
  GIT_AUTHOR_NAME=$name GIT_AUTHOR_EMAIL=$a GIT_COMMITTER_NAME=$name GIT_COMMITTER_EMAIL=$a \
    git_cmd -C "$clone" -c "user.name=$name" -c "user.email=$a" -c commit.gpgsign=false \
    -c tag.gpgsign=false commit -q -m "player: $id" > /dev/null 2>&1 ||
    die_after_create "$clone" "$id" commit gh_failed "$id" commit
  run_bounded 120 git_cmd -C "$clone" push -q origin HEAD > /dev/null 2>&1 ||
    die_after_create "$clone" "$id" push gh_failed "$id" push

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
