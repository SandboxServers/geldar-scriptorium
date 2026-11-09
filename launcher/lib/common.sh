# Shared functions for geldar-play. Sourced; bash 3.2 syntax only.

GP_GROUPS="${GP_GROUPS-}"
GP_DIR="${GP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)}"

# Test-only variables are read only through this function (decision 9): the value of the
# named variable when GELDAR_INTERNAL=1, else nothing.
gp_env() {
  [ "${GELDAR_INTERNAL:-}" = "1" ] || return 0
  printf '%s' "${!1:-}"
}

# The text of a message key, from every messages.d table.
msg_text() {
  awk -F '\t' -v k="$1" '$1 == k { print substr($0, length(k) + 2); exit }' "$GP_DIR"/messages.d/*.tsv
}

# Prints "geldar-play: <text>" on stderr; %s placeholders take the arguments.
say() {
  local key=$1 fmt
  shift
  fmt=$(msg_text "$key")
  [ -n "$fmt" ] || fmt=$key
  # shellcheck disable=SC2059
  printf -- "geldar-play: ${fmt}\n" ${1+"$@"} >&2
}

die() {
  local code=$1
  shift
  say "$@"
  exit "$code"
}

# H-16: stdin to stdout, one trailing newline dropped, every C0, DEL and C1 code point a space.
sanitize() {
  perl -CSD -0777 -pe 's/\n\z//; s/[\x00-\x1f\x7f-\x9f]/ /g'
}

state_dir() {
  if [ -n "${GELDAR_STATE_DIR:-}" ]; then
    printf '%s' "$GELDAR_STATE_DIR"
  else
    printf '%s' "${XDG_STATE_HOME:-$HOME/.local/state}/geldar"
  fi
}

player_dir() {
  printf '%s/%s' "$(state_dir)" "$1"
}

valid_player_id() {
  local re='^[a-z][a-z0-9-]{1,38}$'
  [[ ${1-} =~ $re ]]
}

# Verify's rule for a branch name.
valid_branch() {
  local re='^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$'
  [[ ${1-} =~ $re ]] || return 1
  case $1 in
    *..* | */ | *.lock) return 1 ;;
  esac
  return 0
}

# A digest-pinned image reference (decision 5, H-19).
valid_kit_image() {
  local re='^[a-z0-9][a-z0-9./-]*@sha256:[0-9a-f]{64}$'
  [[ ${1-} =~ $re ]]
}

# Decision 5: sets GP_IMAGE from GELDAR_KIT_IMAGE, else from the given player.json value.
resolve_kit_image() {
  local ref=${GELDAR_KIT_IMAGE:-}
  GP_IMAGE=$1
  [ -n "$ref" ] || return 0
  if valid_kit_image "$ref"; then
    GP_IMAGE=$ref
  elif [ "$(gp_env GELDAR_UNSAFE_IMAGE)" = "1" ]; then
    GP_IMAGE=$ref
    say image_unsafe
  else
    die 1 image_refused
  fi
}

# The one function that builds the harness command words (one per line); SC-71 changes it.
harness_command() {
  local cli=$1 mode=$2
  case $cli in
    claude)
      printf '%s\n' claude --settings "/etc/geldar/settings/$mode.json" "/$mode"
      ;;
    *) return 1 ;;
  esac
}

docker_cmd() {
  "${GELDAR_DOCKER:-docker}" "$@"
}

# N4: mkdir -p, then 0700 on the leaf too (it may exist from an older, looser layout).
private_mkdir() {
  mkdir -p "$1" && chmod 700 "$1"
}

# git on the human's own clone: the files it writes keep the user's normal modes.
git_host() {
  (
    umask 022
    git_cmd "$@"
  )
}

git_cmd() {
  local hooks
  hooks="$(state_dir)/empty-hooks"
  [ -d "$hooks" ] || private_mkdir "$hooks"
  GIT_NO_REPLACE_OBJECTS=1 GIT_TERMINAL_PROMPT=0 "${GELDAR_GIT:-git}" -c "core.hooksPath=$hooks" "$@"
}

# Is the tool there? Under GELDAR_INTERNAL=1, GELDAR_TOOL_PATH replaces PATH for this check.
tool_found() {
  local tp seam=""
  tp=$(gp_env GELDAR_TOOL_PATH)
  case $1 in
    docker) seam=${GELDAR_DOCKER:-} ;;
    git) seam=${GELDAR_GIT:-} ;;
    gh) seam=${GELDAR_GH:-} ;;
  esac
  if [ -n "$seam" ]; then
    [ -f "$seam" ]
    return
  fi
  if [ -n "$tp" ]; then
    PATH=$tp command -v "$1" > /dev/null 2>&1
  else
    command -v "$1" > /dev/null 2>&1
  fi
}

tool_hint() {
  case $1 in
    docker) printf '%s' 'Install Docker with Compose v2.' ;;
    git) printf '%s' 'Install git 2.40 or newer.' ;;
    tar) printf '%s' 'Install tar (Windows 10 and later include it).' ;;
    perl) printf '%s' 'Install perl (it comes with Git for Windows).' ;;
    tmux) printf '%s' 'Install tmux to run several players.' ;;
    gh) printf '%s' 'Install the GitHub CLI (gh) to create or archive a player.' ;;
  esac
}

git_version_text() {
  local tp
  if [ -n "${GELDAR_GIT:-}" ]; then
    "$GELDAR_GIT" --version 2> /dev/null
    return
  fi
  tp=$(gp_env GELDAR_TOOL_PATH)
  if [ -n "$tp" ]; then
    PATH=$tp git --version 2> /dev/null
  else
    git --version 2> /dev/null
  fi
}

# need tool...: exit 1 with missing_tool when one is absent (docker also needs Compose v2,
# git needs 2.40 or newer).
need() {
  local t v major minor re='([0-9]+)\.([0-9]+)'
  for t in "$@"; do
    tool_found "$t" || die 1 missing_tool "$t" "$(tool_hint "$t")"
    case $t in
      docker)
        docker_cmd compose version > /dev/null 2>&1 || die 1 missing_tool docker "$(tool_hint docker)"
        ;;
      git)
        v=$(git_version_text)
        [[ $v =~ $re ]] || die 1 missing_tool git "$(tool_hint git)"
        major=${BASH_REMATCH[1]}
        minor=${BASH_REMATCH[2]}
        if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 40 ]; }; then
          die 1 git_too_old "$major.$minor"
        fi
        ;;
    esac
  done
}

GP_LOCK_ID=""

lock_release() {
  [ -n "$GP_LOCK_ID" ] || return 0
  rm -rf "$(player_dir "$GP_LOCK_ID")/lock"
  GP_LOCK_ID=""
}

# mkdir is the lock; the owner's PID is stored inside. A dead owner's lock is never stolen.
lock_acquire() {
  local id=$1 d pid
  d="$(player_dir "$id")/lock"
  private_mkdir "$(state_dir)" && private_mkdir "$(player_dir "$id")"
  if ! mkdir "$d" 2> /dev/null; then
    pid=$(cat "$d/pid" 2> /dev/null)
    if [ -n "$pid" ] && ! kill -0 "$pid" 2> /dev/null; then
      say locked_stale "$id" "$d"
    fi
    die 1 locked "$id"
  fi
  printf '%s\n' "$$" > "$d/pid"
  GP_LOCK_ID=$id
  trap lock_release EXIT
}

# run_bounded <seconds> [--container <name>] <cmd...>: bash only, no timeout(1). The command
# runs as a job in its own process group; on expiry the group gets TERM then KILL and a named
# container gets docker kill then docker rm -f. Returns the command's status, or 124.
run_bounded() {
  local secs=$1 name="" pid t0 rc override
  shift
  if [ "${1:-}" = "--container" ]; then
    name=$2
    shift 2
  fi
  override=$(gp_env GELDAR_HELPER_TIMEOUT_SEC)
  case $override in
    '' | *[!0-9]*) ;;
    *) secs=$override ;;
  esac
  case $secs in
    '' | 0 | 0* | *[!0-9]*) die 2 usage ;;
  esac
  set -m
  "$@" &
  pid=$!
  t0=$SECONDS
  set +m
  while kill -0 "$pid" 2> /dev/null; do
    if [ $((SECONDS - t0)) -gt "$secs" ]; then
      kill -TERM -- "-$pid" 2> /dev/null
      kill -TERM "$pid" 2> /dev/null
      sleep 1
      kill -KILL -- "-$pid" 2> /dev/null
      kill -KILL "$pid" 2> /dev/null
      wait "$pid" 2> /dev/null
      if [ -n "$name" ]; then
        docker_cmd kill "$name" > /dev/null 2>&1
        docker_cmd rm -f "$name" > /dev/null 2>&1
      fi
      return 124
    fi
    sleep 0.1
  done
  wait "$pid"
  rc=$?
  return "$rc"
}
