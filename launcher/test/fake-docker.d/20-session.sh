# Fake docker: `compose config` (the real docker compose when it works), `compose run` (runs
# $FAKE_SESSION in the workspace volume directory) and `compose down` (logged only).

fake_compose() {
  if [ "${1:-}" = "version" ]; then
    echo "Docker Compose version v2.40.3 (fake)"
    return 0
  fi
  # Find the compose subcommand after any -p <name> and -f <file> options.
  sub=""
  skip=0
  for a in "$@"; do
    if [ $skip = 1 ]; then
      skip=0
      continue
    fi
    case $a in
      -p | -f) skip=1 ;;
      *)
        sub=$a
        break
        ;;
    esac
  done
  case $sub in
    config)
      command docker compose version > /dev/null 2>&1 || return 98
      command docker compose "$@"
      ;;
    run)
      [ -n "${FAKE_SESSION:-}" ] || return 0
      ws="$FAKE_DOCKER_ROOT/vol/${GELDAR_WORKSPACE:-none}"
      mkdir -p "$ws"
      cd "$ws" || return 99
      sh "$FAKE_SESSION"
      ;;
    down)
      return 0
      ;;
    *)
      echo "fake docker: unsupported compose command: $sub" >&2
      return 99
      ;;
  esac
}
