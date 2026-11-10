# SC-75: the human-only local-world override (decision 33). Sourced; bash 3.2 syntax only.
# GELDAR_DEV_MCP_URL is read from the environment of the shell that runs geldar-play, never from
# player.json or any file. The only check on it is the exact shape below; valid_mcp_url is not
# used, because it refuses host.docker.internal on purpose.

# dev_world_url id: prints the URL when GELDAR_DEV_MCP_URL is set and is exactly
# http://host.docker.internal:PORT/p/ID (PORT 1024 to 65535, no leading zero, ID the player's
# own id). Prints nothing and returns 0 when it is unset or empty; returns 1 when it is set and wrong.
dev_world_url() {
  local id=$1 v=${GELDAR_DEV_MCP_URL-} rest port path
  [ -n "$v" ] || return 0
  case $v in
    http://host.docker.internal:*) ;;
    *) return 1 ;;
  esac
  rest=${v#http://host.docker.internal:}
  port=${rest%%/*}
  path=${rest#"$port"}
  case $port in
    '' | 0* | *[!0-9]*) return 1 ;;
  esac
  [ "${#port}" -le 5 ] || return 1
  [ "$port" -ge 1024 ] && [ "$port" -le 65535 ] || return 1
  [ "$path" = "/p/$id" ] || return 1
  printf '%s' "$v"
}
