# The session: allowlist, per-player CLI volume, compose override, start (H-06, H-07, H-08, H-19).
# Sourced; bash 3.2 syntax only. Compose files come only from the launcher's own share.

GP_GROUPS="$GP_GROUPS session"

# SC-75: start_session needs dev_world_url, also when only player.sh and session.sh are sourced.
# shellcheck disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/devworld.sh"

# A value for a double-quoted YAML scalar: no quote, backslash or control character; $ doubled.
yaml_q() {
  case $1 in
    *\"* | *\\* | *[[:cntrl:]]*) return 1 ;;
  esac
  printf '"%s"' "${1//\$/\$\$}"
}

# A host path used in a mount: no colon, comma or control character, then quoted.
mount_q() {
  case $1 in
    *:* | *,* | *[[:cntrl:]]*) die 1 bad_state_path ;;
  esac
  yaml_q "$1" || die 1 bad_state_path
}

# H-08: the host of mcp_url, alone on one line, and (SC-76) its effective port in
# allowlist-world-ports.txt. 0644 in a 0755 directory, because Squid runs without capabilities
# and cannot read a private file.
write_allowlist() {
  local sd=$1 url=$2 host port
  host=${url#*://}
  host=${host%%/*}
  port=""
  case $host in
    *:*) port=${host#*:} ;;
  esac
  host=${host%%:*}
  if [ -z "$port" ]; then
    case $url in
      http://*) port=80 ;;
      *) port=443 ;;
    esac
  fi
  mkdir -p "$sd"
  chmod 755 "$sd"
  printf '%s\n' "$host" > "$sd/allowlist-world.txt"
  chmod 644 "$sd/allowlist-world.txt"
  printf '%s\n' "$port" > "$sd/allowlist-world-ports.txt"
  chmod 644 "$sd/allowlist-world-ports.txt"
}

# H-06: the override. Absolute host paths only; one read-only bind per kit entry.
write_override() {
  local id=$1 sd=$2 mcp=$3 dev=${4-} prompt=${5-} turns=${6-} model=${7-}
  local f="$sd/override.yml" entry name v
  [ -d "$sd/export" ] || die 1 no_such_player "$id" "$id"
  (
    {
      printf 'services:\n  session:\n    volumes:\n'
      printf '      - type: volume\n        source: geldar_ws\n        target: /player\n'
      printf '      - type: volume\n        source: geldar_cli\n        target: /cli-home\n'
    } > "$f.new"
  )
  while IFS= read -r -d '' entry; do
    name=${entry##*/}
    [[ $name =~ ^[A-Za-z0-9._-]+$ ]] || {
      rm -f "$f.new"
      die 1 bad_export_name "$id"
    }
    case $name in
      memory | skills | .git) continue ;;
    esac
    v=$(mount_q "$entry") || exit 1
    {
      printf '      - type: bind\n        source: %s\n        target: "/player/%s"\n' "$v" "$name"
      printf '        read_only: true\n        bind:\n          create_host_path: false\n'
    } >> "$f.new"
  done < <(find "$sd/export" -mindepth 1 -maxdepth 1 -print0 | sort -z)
  if [ -n "$prompt" ]; then
    # SC-121: the run prompt file, read-only, at a fixed path; the same path checks as a kit entry.
    v=$(mount_q "$prompt") || exit 1
    {
      printf '      - type: bind\n        source: %s\n        target: /run-input/prompt.txt\n' "$v"
      printf '        read_only: true\n        bind:\n          create_host_path: false\n'
    } >> "$f.new"
  fi
  v=$(yaml_q "$mcp") || die 1 bad_state_path
  {
    printf '    environment:\n      GELDAR_MCP_URL: %s\n      GELDAR_MCP_TOKEN:\n' "$v"
    if [ -n "$turns" ]; then
      printf '      GELDAR_RUN_MAX_TURNS: "%s"\n' "$turns"
    fi
    if [ -n "$model" ]; then
      printf '      GELDAR_RUN_MODEL: %s\n' "$(yaml_q "$model")"
    fi
    if [ "${GELDAR_INTERNAL:-}" = "1" ]; then
      for name in $(compgen -v GELDAR_STUB_ 2> /dev/null); do
        [[ $name =~ ^GELDAR_STUB_[A-Z0-9_]+$ ]] || continue
        printf '      %s:\n' "$name"
      done
    fi
    if [ -n "$dev" ]; then
      printf '  proxy:\n    extra_hosts:\n      - "host.docker.internal:host-gateway"\n'
    fi
    printf 'volumes:\n  geldar_ws:\n    external: true\n    name: "geldar-ws-%s"\n' "$id"
    printf '  geldar_cli:\n    external: true\n    name: "geldar-cli-%s-claude"\n' "$id"
  } >> "$f.new"
  mv "$f.new" "$f"
}

# start_session id mode [n]: needs prepare_session to have run (export/, start, running).
# SC-121: mode run (with its number n) is one headless play session: no TTY, the prompt file named
# by GELDAR_RUN_PROMPT_FILE mounted read-only, stdout saved to <state>/<id>/run/session-<n>.jsonl.
start_session() {
  local id=$1 mode=$2 n=${3-} d sd start share ov wl wp cmd word rc extra dev tty=-T
  local cmode=$2 prompt="" turns="" model="" out=""
  local -a words args files
  case $mode in
    play | setup) [ -z "$n" ] || die 2 usage ;;
    run)
      [[ $n =~ ^[0-9]{1,9}$ ]] || die 2 usage
      cmode=play
      prompt=${GELDAR_RUN_PROMPT_FILE-}
      case $prompt in
        *[[:cntrl:]]* | *,* | *:*) die 2 run_setting_bad GELDAR_RUN_PROMPT_FILE ;;
        /*) [ -f "$prompt" ] || die 2 run_setting_bad GELDAR_RUN_PROMPT_FILE ;;
        *) die 2 run_setting_bad GELDAR_RUN_PROMPT_FILE ;;
      esac
      turns=${GELDAR_RUN_MAX_TURNS:-300}
      [[ $turns =~ ^[0-9]{1,6}$ ]] || die 2 run_setting_bad GELDAR_RUN_MAX_TURNS
      model=${GELDAR_RUN_MODEL-}
      [ -z "$model" ] || [[ $model =~ ^[A-Za-z0-9._:/-]+$ ]] || die 2 run_setting_bad GELDAR_RUN_MODEL
      ;;
    *) die 2 usage ;;
  esac
  d=$(player_dir "$id")
  sd="$d/session"
  IFS= read -r start < "$d/start" 2> /dev/null || die 1 no_such_player "$id" "$id"
  read_player "$id" "$start"
  case $sd in
    *[[:cntrl:]]* | *,* | *:*) die 1 bad_state_path ;;
  esac
  share=$(share_dir)
  if [ "$mode" = run ]; then
    # A link at the run folder or the stream file would make the launcher truncate its target.
    out="$d/run/session-$n.jsonl"
    if [ -L "$d/run" ] || [ -L "$out" ]; then die 1 bad_state_path; fi
  fi

  # SC-75: a set GELDAR_DEV_MCP_URL replaces the URL for this launch only. It goes straight to the
  # allowlist writer and the override; it is never passed through valid_mcp_url.
  dev=$(dev_world_url "$id") || die 1 dev_world_bad "$id"
  if [ -n "$dev" ]; then
    say dev_world_active "$dev"
    PL_MCP_URL=$dev
  fi

  private_mkdir "$sd"
  write_allowlist "$d/pub" "$PL_MCP_URL"
  docker_cmd volume create "geldar-cli-$id-claude" > /dev/null 2>&1 ||
    die 1 workspace_failed "$id" 'the CLI volume could not be created'
  write_override "$id" "$sd" "$PL_MCP_URL" "$dev" "$prompt" "$turns" "$model"
  if [ "$mode" = run ]; then
    private_mkdir "$d/run"
    (umask 077 && : > "$out") && chmod 600 "$out" || die 1 bad_state_path
    tty=-T
  fi

  words=()
  while IFS= read -r word; do
    words+=("$word")
  done < <(harness_command claude "$mode")
  ov="$sd/override.yml"
  wl="$d/pub/allowlist-world.txt"
  wp="$d/pub/allowlist-world-ports.txt"
  files=(-f "$share/compose/session.yml" -f "$ov")
  extra=$(gp_env GELDAR_EXTRA_COMPOSE)
  if [ -n "$extra" ]; then
    case $extra in
      /* | [A-Za-z]:*) files+=(-f "$extra") ;;
      *) die 1 bad_state_path ;;
    esac
  fi
  if [ "$mode" != run ] && [ -t 0 ]; then tty=""; fi
  args=(-p "geldar-$id" ${files[@]+"${files[@]}"})

  say session_start "$(printf '%s' "$PL_NAME" | sanitize)"
  (
    unset GH_TOKEN GITHUB_TOKEN ANTHROPIC_API_KEY
    unset GELDAR_MCP_TOKEN GELDAR_DEV_MCP_URL
    if [ -f "$d/token" ]; then
      IFS= read -r GELDAR_MCP_TOKEN < "$d/token" || true
      export GELDAR_MCP_TOKEN
    fi
    export GELDAR_UID=1000 GELDAR_GID=1000 GELDAR_WORKSPACE="geldar-ws-$id"
    export GELDAR_CLI_HOME="geldar-cli-$id-claude" KIT_IMAGE="$PL_KIT_IMAGE"
    export GELDAR_WORLD_ALLOWLIST="$wl" GELDAR_WORLD_PORTS="$wp" GELDAR_MODE="$cmode"
    if [ "$mode" = run ]; then
      docker_cmd compose "${args[@]}" run --rm ${tty:+$tty} --label geldar.role=session \
        session "${words[@]}" < /dev/null > "$out"
    else
      docker_cmd compose "${args[@]}" run --rm ${tty:+$tty} --label geldar.role=session \
        session "${words[@]}"
    fi
  )
  rc=$?
  printf '%s\n' "$rc" > "$sd/exit"
  (
    unset GELDAR_MCP_TOKEN GELDAR_DEV_MCP_URL
    export GELDAR_UID=1000 GELDAR_GID=1000 GELDAR_WORKSPACE="geldar-ws-$id"
    export GELDAR_CLI_HOME="geldar-cli-$id-claude" KIT_IMAGE="$PL_KIT_IMAGE"
    export GELDAR_WORLD_ALLOWLIST="$wl" GELDAR_WORLD_PORTS="$wp" GELDAR_MODE="$cmode"
    docker_cmd compose "${args[@]}" down --remove-orphans > /dev/null 2>&1
  )
  if [ "$rc" -eq 125 ]; then
    die 1 compose_failed
  fi
  say session_end "$(printf '%s' "$PL_NAME" | sanitize)"
  return 0
}

verb___session() {
  [ $# -eq 2 ] || { [ $# -eq 3 ] && [ "$2" = run ]; } || die 2 usage
  start_session "$@"
}
