# Fake docker: volumes, images, and `docker run` with the workspace-init role.
# The fake runs the launcher's own `sh -c` script; it adds no git steps of its own.

fake_volume() {
  sub=${1:-}
  [ $# -eq 0 ] || shift
  case $sub in
    create)
      mkdir -p "$FAKE_DOCKER_ROOT/vol/$1"
      echo "$1"
      ;;
    rm)
      [ -d "$FAKE_DOCKER_ROOT/vol/$1" ] || return 1
      rm -rf "$FAKE_DOCKER_ROOT/vol/$1"
      ;;
    inspect)
      [ -d "$FAKE_DOCKER_ROOT/vol/$1" ] || return 1
      echo "[{\"Name\": \"$1\"}]"
      ;;
    *)
      echo "fake docker: unsupported volume command: $sub" >&2
      return 99
      ;;
  esac
}

fake_image() {
  if [ "${1:-}" = "inspect" ]; then
    [ -z "${FAKE_IMAGE_MISSING:-}" ] || return 1
    echo "[{}]"
    return 0
  fi
  echo "fake docker: unsupported image command: ${1:-}" >&2
  return 99
}

fake_pull() {
  return 0
}

# Path-prefix tokens only: /in/, /player and /tmp, when not part of a longer name. Placeholders
# first, real paths second, so a real path that contains /tmp is never rewritten again.
fake_subst() {
  printf '%s' "$1" | sed -E \
    -e 's#(^|[^A-Za-z0-9_./-])/in/#\1@@IN@@/#g' \
    -e 's#(^|[^A-Za-z0-9_./-])/player([^A-Za-z0-9_.-]|$)#\1@@PL@@\2#g' \
    -e 's#(^|[^A-Za-z0-9_./-])/tmp([^A-Za-z0-9_.-]|$)#\1@@TMP@@\2#g' |
    sed -e "s#@@IN@@#$FAKE_IN#g" -e "s#@@PL@@#$FAKE_PL#g" -e "s#@@TMP@@#$FAKE_TMP#g"
}

fake_run() {
  role=""
  mounts=""
  envs=""
  nl='
'
  while [ $# -gt 0 ]; do
    case $1 in
      --rm | --init) shift ;;
      --label)
        case $2 in
          geldar.role=*) role=${2#geldar.role=} ;;
        esac
        shift 2
        ;;
      --name | --memory | --pids-limit | --log-driver | --cap-drop | --security-opt)
        shift 2
        ;;
      -v)
        mounts="$mounts$2$nl"
        shift 2
        ;;
      -e)
        envs="$envs$2$nl"
        shift 2
        ;;
      -*)
        echo "fake docker: unsupported run option: $1" >&2
        return 99
        ;;
      *) break ;;
    esac
  done
  [ $# -gt 0 ] || return 99
  shift # the image
  if [ -n "${FAKE_ROLE_SLEEP:-}" ]; then
    trap '' PIPE
    sleep "$FAKE_ROLE_SLEEP" &
    [ -z "${FAKE_PIDFILE:-}" ] || echo "$!" >> "$FAKE_PIDFILE"
    wait
  fi
  fn="fake_role_$(printf '%s' "$role" | tr -c 'A-Za-z0-9' '_')"
  if [ -z "$role" ] || ! type "$fn" > /dev/null 2>&1; then
    echo "fake docker: unknown run role: $role" >&2
    return 99
  fi
  FAKE_IN=""
  FAKE_PL=""
  FAKE_TMP="$FAKE_DOCKER_ROOT/scratch/$$"
  mkdir -p "$FAKE_TMP"
  while IFS= read -r m; do
    [ -n "$m" ] || continue
    case $m in
      *:ro | *:rw) m=${m%:*} ;;
    esac
    dst=${m##*:}
    src=${m%:*}
    case $src in
      */*) ;;
      *)
        src="$FAKE_DOCKER_ROOT/vol/$src"
        mkdir -p "$src"
        ;;
    esac
    case $dst in
      /in) FAKE_IN=$src ;;
      /player) FAKE_PL=$src ;;
      *)
        echo "fake docker: unsupported mount target: $dst" >&2
        return 99
        ;;
    esac
  done << MOUNTS
$mounts
MOUNTS
  while IFS= read -r e; do
    [ -n "$e" ] || continue
    case $e in
      *=*) export "${e%%=*}=$(fake_subst "${e#*=}")" ;;
    esac
  done << ENVS
$envs
ENVS
  "$fn" "$@"
  rc=$?
  rm -rf "$FAKE_TMP"
  return $rc
}

# Runs `sh -c <script>` with the tokens mapped, cwd the scratch directory.
fake_exec_script() {
  if [ "${1:-}" != "sh" ] || [ "${2:-}" != "-c" ] || [ $# -ne 3 ]; then
    echo "fake docker: a helper role runs sh -c <script> only" >&2
    return 99
  fi
  script=$(fake_subst "$3")
  cd "$FAKE_TMP" || return 99
  sh -c "$script"
}

fake_role_workspace_init() {
  fake_exec_script "$@"
}
