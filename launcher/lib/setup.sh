# setup: the birth session. The unborn check lives in prepare_session (mode setup).
# Sourced; bash 3.2 syntax only.

GP_GROUPS="$GP_GROUPS setup"

verb_setup() {
  local id=$1 d clone st
  # SC-75: a bad GELDAR_DEV_MCP_URL is refused before any lock, state or docker call.
  dev_world_url "$id" > /dev/null || die 1 dev_world_bad "$id"
  lock_acquire "$id"
  guard_not_held "$id"
  prepare_session "$id" setup
  start_session "$id" setup
  finish_session "$id"
  d=$(player_dir "$id")
  IFS= read -r clone < "$d/clone" 2> /dev/null
  st=$(git_cmd -C "$clone" show HEAD:memory/identity.md 2> /dev/null | tr -d '\r' |
    grep -v -e '^[[:space:]]*$' -e '^# Identity$')
  if [ "$st" = "Who you are. Written once, at your birth." ] || [ -z "$st" ]; then
    die 1 setup_empty "$id"
  fi
  return 0
}
