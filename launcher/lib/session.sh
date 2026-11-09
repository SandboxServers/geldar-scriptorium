# The session: allowlist, per-player CLI volume, compose override, start (H-06, H-07, H-08, H-19).
# Sourced; bash 3.2 syntax only. Compose files come only from the launcher's own share.

GP_GROUPS="$GP_GROUPS session"

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

# H-08: the host of mcp_url, alone on one line. 0644 in a 0755 directory, because Squid runs
# without capabilities and cannot read a private file.
write_allowlist() {
  local sd=$1 url=$2 host
  host=${url#*://}
  host=${host%%/*}
  host=${host%%:*}
  chmod 755 "$sd"
  printf '%s\n' "$host" > "$sd/allowlist-world.txt"
  chmod 644 "$sd/allowlist-world.txt"
}

# H-06: the override. Absolute host paths only; one read-only bind per kit entry.
write_override() {
  local id=$1 sd=$2 mcp=$3 f="$sd/override.yml" entry name v
  [ -d "$sd/export" ] || die 1 no_such_player "$id" "$id"
  (
    umask 022
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
  v=$(yaml_q "$mcp") || die 1 bad_state_path
  {
    printf '    environment:\n      GELDAR_MCP_URL: %s\n      GELDAR_MCP_TOKEN:\n' "$v"
    if [ "${GELDAR_INTERNAL:-}" = "1" ]; then
      for name in $(compgen -v GELDAR_STUB_ 2> /dev/null); do
        [[ $name =~ ^GELDAR_STUB_[A-Z0-9_]+$ ]] || continue
        printf '      %s:\n' "$name"
      done
    fi
    printf 'volumes:\n  geldar_ws:\n    external: true\n    name: "geldar-ws-%s"\n' "$id"
    printf '  geldar_cli:\n    external: true\n    name: "geldar-cli-%s-claude"\n' "$id"
  } >> "$f.new"
  mv "$f.new" "$f"
}

# start_session id mode: needs prepare_session to have run (export/, start, running).
start_session() {
  local id=$1 mode=$2 d sd start share ov wl cmd word rc extra tty=-T
  local -a words args files
  case $mode in
    play | setup) ;;
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

  write_allowlist "$sd" "$PL_MCP_URL"
  docker_cmd volume create "geldar-cli-$id-claude" > /dev/null 2>&1 ||
    die 1 workspace_failed "$id" 'the CLI volume could not be created'
  write_override "$id" "$sd" "$PL_MCP_URL"

  words=()
  while IFS= read -r word; do
    words+=("$word")
  done < <(harness_command claude "$mode")
  ov="$sd/override.yml"
  wl="$sd/allowlist-world.txt"
  files=(-f "$share/compose/session.yml" -f "$ov")
  extra=$(gp_env GELDAR_EXTRA_COMPOSE)
  if [ -n "$extra" ]; then
    case $extra in
      /* | [A-Za-z]:*) files+=(-f "$extra") ;;
      *) die 1 bad_state_path ;;
    esac
  fi
  [ -t 0 ] && tty=""
  args=(-p "geldar-$id" ${files[@]+"${files[@]}"})

  say session_start "$(printf '%s' "$PL_NAME" | sanitize)"
  (
    unset GH_TOKEN GITHUB_TOKEN ANTHROPIC_API_KEY
    unset GELDAR_MCP_TOKEN
    if [ -f "$d/token" ]; then
      IFS= read -r GELDAR_MCP_TOKEN < "$d/token" || true
      export GELDAR_MCP_TOKEN
    fi
    export GELDAR_UID=1000 GELDAR_GID=1000 GELDAR_WORKSPACE="geldar-ws-$id"
    export GELDAR_CLI_HOME="geldar-cli-$id-claude" KIT_IMAGE="$PL_KIT_IMAGE"
    export GELDAR_WORLD_ALLOWLIST="$wl" GELDAR_MODE="$mode"
    docker_cmd compose "${args[@]}" run --rm ${tty:+$tty} --label geldar.role=session \
      session "${words[@]}"
  )
  rc=$?
  printf '%s\n' "$rc" > "$sd/exit"
  (
    unset GELDAR_MCP_TOKEN
    export GELDAR_UID=1000 GELDAR_GID=1000 GELDAR_WORKSPACE="geldar-ws-$id"
    export GELDAR_CLI_HOME="geldar-cli-$id-claude" KIT_IMAGE="$PL_KIT_IMAGE"
    export GELDAR_WORLD_ALLOWLIST="$wl" GELDAR_MODE="$mode"
    docker_cmd compose "${args[@]}" down --remove-orphans > /dev/null 2>&1
  )
  if [ "$rc" -eq 125 ]; then
    die 1 compose_failed
  fi
  say session_end "$(printf '%s' "$PL_NAME" | sanitize)"
  return 0
}

verb___session() {
  [ $# -eq 2 ] || die 2 usage
  start_session "$1" "$2"
}
