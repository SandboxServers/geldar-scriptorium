# resolve, archive and status. Sourced; bash 3.2 syntax only.

GP_GROUPS="${GP_GROUPS-} commands"

# One key of held/info (matched with case, never sourced).
held_field() {
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in
      "$2="*)
        printf '%s' "${line#*=}"
        return 0
        ;;
    esac
  done < "$(player_dir "$1")/held/info" 2> /dev/null
  return 0
}

# The tip of the branch in the held bundle (host git list-heads). Needs PL_CLONE and PL_BRANCH.
held_tip() {
  local f out sha ref
  f="$(player_dir "$1")/held/bundle.bundle"
  [ -f "$f" ] || return 1
  out=$(git_cmd -C "$PL_CLONE" bundle list-heads "$f" 2> /dev/null) || return 1
  while read -r sha ref; do
    if [ "$ref" = "refs/heads/$PL_BRANCH" ] && [[ $sha =~ ^[0-9a-f]{40}$ ]]; then
      printf '%s' "$sha"
      return 0
    fi
  done << LIST
$out
LIST
  return 1
}

# The number of commits in the held bundle after START, counted in a scratch repository.
held_count() {
  local id=$1 start sc n="?"
  held_tip "$id" > /dev/null || {
    printf '?'
    return 0
  }
  start=$(held_field "$id" start)
  [[ $start =~ ^[0-9a-f]{40}$ ]] || {
    printf '?'
    return 0
  }
  sc=$(mktemp -d "${TMPDIR:-/tmp}/gp-count.XXXXXX") || {
    printf '?'
    return 0
  }
  if git_cmd init --bare -q "$sc" > /dev/null 2>&1 &&
    git_cmd -C "$sc" -c fetch.fsckObjects=true -c transfer.fsckObjects=true fetch --no-tags "$(player_dir "$id")/held/bundle.bundle" \
      "refs/heads/$PL_BRANCH:refs/held" > /dev/null 2>&1; then
    n=$(git_cmd -C "$sc" rev-list --count refs/held --not "$start" 2> /dev/null) || n="?"
  fi
  rm -rf "$sc"
  printf '%s' "$n"
}

resolve_discard() {
  local id=$1 d clone="" n=0
  d=$(player_dir "$id")
  IFS= read -r clone < "$d/clone" 2> /dev/null || true
  if [ -d "$d/held" ]; then
    PL_CLONE=$clone
    PL_BRANCH=""
    IFS= read -r PL_BRANCH < "$d/branch" 2> /dev/null || true
    n="?"
    if [ -d "$clone" ] && valid_branch "$PL_BRANCH"; then
      n=$(held_count "$id")
    fi
  fi
  [ ! -d "$clone" ] || git_cmd -C "$clone" update-ref -d refs/launcher/incoming > /dev/null 2>&1
  docker_cmd volume rm "geldar-ws-$id" > /dev/null 2>&1
  rm -rf "$d/held" "$d/session"
  rm -f "$d/start" "$d/mode"
  say discarded "$id" "$n"
}

resolve_held() {
  local id=$1 d clone st tip start reason remote head mode
  d=$(player_dir "$id")
  IFS= read -r PL_CLONE < "$d/clone" || [ -n "$PL_CLONE" ]
  [ -d "$PL_CLONE" ] || die 1 no_such_player "$id" "$id"
  clone=$PL_CLONE
  read_branch "$id"
  # H-01 (N13)
  st=$(git_cmd -C "$clone" status --porcelain --untracked-files=all 2> /dev/null) || die 1 dirty "$id"
  [ -z "$st" ] || die 1 dirty "$id"
  st=$(git_cmd -C "$clone" symbolic-ref -q --short HEAD 2> /dev/null)
  [ "$st" = "$PL_BRANCH" ] || die 1 branch_changed "$id"
  start=$(held_field "$id" start)
  [[ $start =~ ^[0-9a-f]{40}$ ]] || start=""
  reason=$(held_field "$id" reason)
  mode=$(held_field "$id" mode)
  tip=$(held_tip "$id") || tip=""
  run_bounded 120 git_cmd -C "$clone" fetch origin > /dev/null 2>&1 ||
    die 1 pull_failed "$id" 'fetch failed'
  remote=$(git_cmd -C "$clone" rev-parse "refs/remotes/origin/$PL_BRANCH" 2> /dev/null) || remote=""
  # ff_failed: the held commits are already on origin; bring the host branch up to them.
  if [ -n "$tip" ] && [ -n "$remote" ] &&
    git_cmd -C "$clone" merge-base --is-ancestor "$tip" "$remote" > /dev/null 2>&1; then
    run_bounded 120 git_cmd -C "$clone" pull --ff-only > /dev/null 2>&1 ||
      die 1 pull_failed "$id" 'it could not be brought up to date'
    git_cmd -C "$clone" merge-base --is-ancestor "$tip" HEAD > /dev/null 2>&1 ||
      die 1 pull_failed "$id" 'it could not be brought up to date'
    finish_cleanup "$id" "$clone"
    rm -rf "$d/held"
    say resolved "$id"
    return 0
  fi
  head=$(git_cmd -C "$clone" rev-parse HEAD 2> /dev/null)
  if [ -z "$start" ] || [ "$head" != "$start" ]; then
    if [ "$reason" = "host_moved" ]; then
      die 3 resolve_host_changed "$id"
    fi
    die 3 resolve_diverged "$id"
  fi
  [ "$remote" = "$head" ] || die 3 resolve_diverged "$id"
  # Still at START: retry from the held state (finish re-verifies and pushes).
  case $mode in play | setup) ;; *) mode=play ;; esac
  private_mkdir "$d/session"
  [ ! -f "$d/held/bundle.bundle" ] || cp "$d/held/bundle.bundle" "$d/session/bundle.bundle"
  printf '%s\n' "$start" > "$d/start"
  printf '%s\n' "$mode" > "$d/mode"
  finish_session "$id"
  rm -rf "$d/held"
}

# resolve <id> [--discard]
verb_resolve() {
  local id=$1 d discard=0
  shift
  case ${1-} in
    '') ;;
    --discard)
      discard=1
      [ $# -eq 1 ] || die 2 usage
      ;;
    *) die 2 usage ;;
  esac
  d=$(player_dir "$id")
  [ -f "$d/clone" ] || die 1 no_such_player "$id" "$id"
  lock_acquire "$id"
  if [ "$discard" = "1" ]; then
    resolve_discard "$id"
    return 0
  fi
  [ -d "$d/held" ] || die 1 resolve_nothing "$id"
  resolve_held "$id"
}

# archive <id>
verb_archive() {
  local id=$1 d clone url re owner line cid head remote st
  [ $# -eq 1 ] || die 2 usage
  d=$(player_dir "$id")
  [ -f "$d/clone" ] || die 1 no_such_player "$id" "$id"
  lock_acquire "$id"
  [ ! -d "$d/held" ] || die 1 archive_held "$id" "$id"
  if [ -f "$d/session/running" ]; then
    cid=$(docker_cmd ps -q --filter label=geldar.role=session \
      --filter "label=com.docker.compose.project=geldar-$id" 2> /dev/null)
    [ -z "$cid" ] || die 1 locked "$id"
    if [ -f "$d/start" ] && [ -f "$d/mode" ] && docker_cmd volume inspect "geldar-ws-$id" > /dev/null 2>&1; then
      say recovering
      finish_session "$id"
    else
      die 1 archive_held "$id" "$id"
    fi
  fi
  IFS= read -r clone < "$d/clone" || [ -n "$clone" ]
  [ -d "$clone" ] || die 1 no_such_player "$id" "$id"
  read_branch "$id"
  # B10: the target comes from the origin URL, by a strict pattern, and from nothing else.
  url=$(git_cmd -C "$clone" config --get remote.origin.url 2> /dev/null)
  re="^(https://([A-Za-z0-9._~-]+@)?|git@|ssh://git@)github\\.com[:/]([A-Za-z0-9-]+)/player-${id}(\\.git)?\$"
  [[ $url =~ $re ]] || die 1 archive_target "$id"
  owner=${BASH_REMATCH[3]}
  run_bounded 120 git_cmd -C "$clone" fetch origin > /dev/null 2>&1 || die 1 not_pushed "$id"
  st=$(git_cmd -C "$clone" status --porcelain --untracked-files=all 2> /dev/null) || die 1 not_pushed "$id"
  [ -z "$st" ] || die 1 not_pushed "$id"
  head=$(git_cmd -C "$clone" rev-parse HEAD 2> /dev/null)
  remote=$(git_cmd -C "$clone" rev-parse "refs/remotes/origin/$PL_BRANCH" 2> /dev/null) || remote=""
  { [ -n "$head" ] && [ "$head" = "$remote" ]; } || die 1 not_pushed "$id"
  [ ! -t 0 ] || say archive_confirm "$id" "$owner/player-$id" "$id"
  line=""
  IFS= read -r line || true
  [ "$line" = "archive $id" ] || die 1 archive_confirm "$id" "$owner/player-$id" "$id"
  run_bounded 120 "${GELDAR_GH:-gh}" repo archive "$owner/player-$id" --yes > /dev/null 2>&1 ||
    die 1 gh_failed "$id" archive
  docker_cmd volume rm "geldar-ws-$id" > /dev/null 2>&1
  docker_cmd volume rm "geldar-cli-$id-claude" > /dev/null 2>&1
  rm -rf "$d"
  say archived "$id"
}

# The state of one player as a tab-separated line on stdout.
status_line() {
  local id=$1 d clone="" branch="" word reason cid ident
  d=$(player_dir "$id")
  IFS= read -r clone < "$d/clone" 2> /dev/null || true
  if [ ! -f "$d/clone" ] || [ ! -d "$clone" ]; then
    printf '%s\tmissing\n' "$id"
    return 0
  fi
  IFS= read -r branch < "$d/branch" 2> /dev/null || true
  valid_branch "$branch" || branch=""
  if [ -d "$d/held" ]; then
    reason=$(held_reason "$id")
    printf '%s\theld\t%s\t%s\n' "$id" "$branch" "$reason"
    return 0
  fi
  cid=""
  if [ -f "$d/session/running" ]; then
    cid=$(docker_cmd ps -q --filter label=geldar.role=session \
      --filter "label=com.docker.compose.project=geldar-$id" 2> /dev/null)
  fi
  if [ -n "$cid" ]; then
    word=running
  elif [ -f "$d/session/running" ] || [ -f "$d/start" ] ||
    docker_cmd volume inspect "geldar-ws-$id" > /dev/null 2>&1; then
    word=unfinished
  else
    ident=$(git_cmd -C "$clone" show HEAD:memory/identity.md 2> /dev/null | tr -d '\r' |
      grep -v -e '^[[:space:]]*$' -e '^# Identity$')
    if [ -z "$ident" ] || [ "$ident" = "Who you are. Written once, at your birth." ]; then
      word=unborn
    else
      word=ready
    fi
  fi
  printf '%s\t%s\t%s\n' "$id" "$word" "$branch"
}

# status [<id>...]: data on stdout, no network.
verb_status() {
  local id e
  local -a ids
  ids=("$@")
  for id in ${ids[@]+"${ids[@]}"}; do
    valid_player_id "$id" || die 2 bad_player_id "$id"
  done
  if [ ${#ids[@]} -eq 0 ]; then
    while IFS= read -r e; do
      e=${e##*/}
      valid_player_id "$e" || continue
      [ -f "$(player_dir "$e")/clone" ] || continue
      ids+=("$e")
    done < <(find "$(state_dir)" -mindepth 1 -maxdepth 1 -type d 2> /dev/null | sort)
  fi
  for id in ${ids[@]+"${ids[@]}"}; do
    status_line "$id"
  done
  return 0
}
