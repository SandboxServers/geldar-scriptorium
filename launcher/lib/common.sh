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
      printf '%s\n' claude --autocompact 100000 --settings "/etc/geldar/settings/$mode.json" "/$mode"
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

# H-04 (S4): git archive honours in-tree .gitattributes export-ignore and export-subst, so the
# mounted kit could differ from the commit the gate trusts. Status 0 when the tree of <rev> holds
# any .gitattributes naming one of them (the caller refuses).
tree_has_export_attrs() {
  local clone=$1 rev=$2 meta path sha
  while IFS= read -r -d '' meta; do
    path=${meta#*$'\t'}
    case ${path##*/} in
      [.][gG][iI][tT][aA][tT][tT][rR][iI][bB][uU][tT][eE][sS]) ;;
      *) continue ;;
    esac
    sha=${meta%%$'\t'*}
    sha=${sha##* }
    if git_cmd -C "$clone" cat-file blob "$sha" 2> /dev/null | grep -q -E 'export-(ignore|subst)'; then
      return 0
    fi
  done < <(git_cmd -C "$clone" ls-tree -r -z "$rev" 2> /dev/null)
  return 1
}

# B1: the helper containers run as uid 1000, who need not be this user, so they cannot read the
# 0700 session dir or the 0600 bundles. stage_bundle src name sets STAGE_DIR to a fresh 0755
# directory holding a 0644 copy as <name>; the caller mounts it and runs unstage_bundle at once.
STAGE_DIR=
stage_bundle() {
  STAGE_DIR=$(mktemp -d "$(state_dir)/stage.XXXXXX") || return 1
  chmod 755 "$STAGE_DIR" && cp "$1" "$STAGE_DIR/$2" && chmod 644 "$STAGE_DIR/$2" || {
    unstage_bundle
    return 1
  }
}
unstage_bundle() {
  [ -z "$STAGE_DIR" ] || rm -rf "$STAGE_DIR"
  STAGE_DIR=
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

# The directory holding compose/ and proxy/ (decision 4). Never read from a clone.
share_dir() {
  if [ -n "${GELDAR_SHARE:-}" ]; then
    printf '%s' "$GELDAR_SHARE"
  elif [ -f "$GP_DIR/../image/compose/session.yml" ]; then
    printf '%s' "$(cd "$GP_DIR/../image" && pwd -P)"
  else
    printf '%s' "$GP_DIR/share"
  fi
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
