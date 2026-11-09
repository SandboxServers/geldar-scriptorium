# Before the session: clean clone, START, kit export, isolated workspace (H-01 to H-05).
# Sourced; bash 3.2 syntax only. State lives under <state>/<id>/ (see the shared shape).

PREP_ID=""
PREP_OWNS=0
PREP_VOL=0

# Exit handler: a launch that stopped after H-03 and did not finish leaves no start, mode or
# running file and no volume this run made, so a refusal changes nothing.
prepare_cleanup() {
  local d
  lock_release
  [ "$PREP_OWNS" = "1" ] || return 0
  d=$(player_dir "$PREP_ID")
  rm -f "$d/start" "$d/mode" "$d/session/running"
  if [ "$PREP_VOL" = "1" ]; then
    docker_cmd volume rm "geldar-ws-$PREP_ID" > /dev/null 2>&1
  fi
  PREP_OWNS=0
  PREP_VOL=0
}

# A docker run for a helper role. Every flag the harness audit and the fake expect is here.
# helper_run <role> <name> <image> <mounts-and-env...> -- <script>
helper_run() {
  local role=$1 name=$2 image=$3 script
  local -a opts
  shift 3
  opts=()
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do
    opts+=("$1")
    shift
  done
  [ $# -eq 2 ] || return 2
  script=$2
  run_bounded 120 --container "$name" docker_cmd run --rm \
    --label "geldar.role=$role" --name "$name" \
    --memory 1g --pids-limit 256 --log-driver none \
    --cap-drop ALL --security-opt no-new-privileges \
    -e HOME=/tmp -e GIT_CONFIG_GLOBAL=/dev/null -e GIT_CONFIG_NOSYSTEM=1 -e GIT_NO_REPLACE_OBJECTS=1 \
    "${opts[@]}" "$image" sh -c "$script"
}

# The checks run in a read-only mount of the new workspace (H-05).
WS_CHECK='[ -z "$(git -C /player remote)" ] || exit 1
[ -z "$(ls -A /player/.git/refs/remotes 2> /dev/null)" ] || exit 1
if git -C /player config --local --list | grep -E -q "^branch\..*\.remote="; then exit 1; fi
if sed "s#/in/start\.bundle##g" /player/.git/config | grep -E -q "(^|[=[:space:]\"])/[^[:space:]\"]|[A-Za-z]:[/\\]"; then exit 1; fi
exit 0'

WS_INIT='git clone --no-local --no-hardlinks -c core.autocrlf=false -b "$GELDAR_BRANCH" /in/start.bundle /tmp/c && cp -a /tmp/c/. /player/ && git -C /player remote remove origin'

# prepare_session id mode: mode is play or setup. On success the session directory holds
# export/, start.bundle and running, the volume geldar-ws-<id> holds the workspace, and
# PL_* hold the validated player.json at START.
prepare_session() {
  local id=$1 mode=$2 d sd clone start entry st out rc name tag
  local -a entries
  case $mode in
    play | setup) ;;
    *) die 2 usage ;;
  esac
  guard_not_held "$id"
  d=$(player_dir "$id")
  sd="$d/session"
  PREP_ID=$id
  trap prepare_cleanup EXIT

  # H-03 (guard): a start with a running session is crash recovery, not a new launch.
  if [ -f "$d/start" ] && [ -f "$sd/running" ]; then
    die 1 unfinished "$id" "$id"
  fi

  [ -f "$d/clone" ] || die 1 no_such_player "$id" "$id"
  IFS= read -r clone < "$d/clone" || [ -n "$clone" ]
  [ -d "$clone" ] || die 1 no_such_player "$id" "$id"
  read_branch "$id"

  # H-01
  st=$(git_cmd -C "$clone" status --porcelain --untracked-files=all 2> /dev/null) ||
    die 1 dirty "$id"
  [ -z "$st" ] || die 1 dirty "$id"
  st=$(git_cmd -C "$clone" symbolic-ref -q --short HEAD 2> /dev/null)
  [ "$st" = "$PL_BRANCH" ] || die 1 branch_changed "$id"

  if [ -n "$(gp_env GELDAR_TEST_HOOK_AFTER_CLEAN)" ]; then
    (cd "$clone" && sh "$(gp_env GELDAR_TEST_HOOK_AFTER_CLEAN)")
  fi

  # H-02
  out=$(mktemp "${TMPDIR:-/tmp}/gp-pull.XXXXXX")
  run_bounded 120 git_cmd -C "$clone" pull --ff-only > "$out" 2>&1
  rc=$?
  rm -f "$out"
  if [ "$rc" -ne 0 ]; then
    if [ "$rc" -eq 124 ]; then
      tag='timed out'
    else
      tag="git exit status $rc"
    fi
    die 1 pull_failed "$id" "$(printf '%s' "$tag" | sanitize)"
  fi

  # H-03
  start=$(git_cmd -C "$clone" rev-parse HEAD 2> /dev/null)
  [[ $start =~ ^[0-9a-f]{40}$ ]] || die 1 pull_failed "$id" 'no commit'
  mkdir -p "$sd"
  printf '%s\n' "$start" > "$d/start"
  printf '%s\n' "$mode" > "$d/mode"
  PREP_OWNS=1
  if [ "$mode" = "setup" ]; then
    # Born only counts after the pull: a stale clone must not run setup on a born player.
    st=$(git_cmd -C "$clone" show "$start:memory/identity.md" 2> /dev/null | tr -d '\r' |
      grep -v -e '^[[:space:]]*$' -e '^# Identity$')
    [ "$st" = "Who you are. Written once, at your birth." ] || die 1 already_born "$id"
  fi
  # The validated values belong to the exported commit (N4).
  read_player "$id" "$start"
  say start_recorded "${start:0:12}"

  case $sd in
    *[[:cntrl:]]* | *,* | *:*) die 1 bad_state_path ;;
  esac

  # H-04
  rm -rf "$sd/export" "$sd/start.bundle" "$sd/running"
  mkdir -p "$sd/export"
  entries=()
  while IFS= read -r -d '' entry; do
    case $entry in
      memory | skills) ;;
      *) entries+=(":(literal)$entry") ;;
    esac
  done < <(git_cmd -C "$clone" ls-tree -z --name-only "$start")
  if [ ${#entries[@]} -gt 0 ]; then
    # A committed symlink must never reach a host-side mount; check the tree itself too.
    if git_cmd -C "$clone" ls-tree -r -z "$start" -- "${entries[@]}" | tr '\0' '\n' |
      grep -q '^120000 '; then
      die 1 export_symlink "$id"
    fi
    git_cmd -C "$clone" archive --format=tar "$start" -- "${entries[@]}" |
      tar -x -f - -C "$sd/export"
    st=("${PIPESTATUS[@]}")
    if [ "${st[0]}" -ne 0 ] || [ "${st[1]}" -ne 0 ]; then
      die 1 workspace_failed "$id" 'the kit files could not be exported'
    fi
  fi
  if [ -n "$(find "$sd/export" ! -type f ! -type d -print -quit)" ]; then
    die 1 export_symlink "$id"
  fi
  git_cmd -C "$clone" bundle create "$sd/start.bundle" "refs/heads/$PL_BRANCH" > /dev/null 2>&1 ||
    die 1 workspace_failed "$id" 'the start bundle could not be made'

  # H-05
  if docker_cmd volume inspect "geldar-ws-$id" > /dev/null 2>&1; then
    docker_cmd volume rm "geldar-ws-$id" > /dev/null 2>&1 ||
      die 1 workspace_exists "$id" "$id"
  fi
  docker_cmd volume create "geldar-ws-$id" > /dev/null 2>&1 ||
    die 1 workspace_failed "$id" 'the volume could not be created'
  PREP_VOL=1
  name="geldar-workspace-init-$id-$$"
  helper_run workspace-init "$name" "$PL_KIT_IMAGE" \
    -e "GELDAR_BRANCH=$PL_BRANCH" -v "$sd:/in:ro" -v "geldar-ws-$id:/player" \
    -- "$WS_INIT" > /dev/null 2>&1
  rc=$?
  [ "$rc" -eq 0 ] || die 1 workspace_failed "$id" "$([ "$rc" -eq 124 ] && echo 'timed out' || echo 'it failed')"
  helper_run workspace-init "$name-check" "$PL_KIT_IMAGE" \
    -v "geldar-ws-$id:/player:ro" -- "$WS_CHECK" > /dev/null 2>&1 ||
    die 1 host_path_in_workspace "$id"

  printf '%s\n' "$$" > "$sd/running"
  PREP_OWNS=0
  PREP_VOL=0
  return 0
}

verb___prepare() {
  [ $# -eq 2 ] || die 2 usage
  prepare_session "$1" "$2"
}
