# play with two or more ids: one tmux window per player. Sourced; bash 3.2 syntax only.

# The tmux binary: GELDAR_TMUX under GELDAR_INTERNAL=1, else tmux on PATH (or GELDAR_TOOL_PATH).
multi_tmux() {
  local t tp
  t=$(gp_env GELDAR_TMUX)
  if [ -n "$t" ]; then
    [ -f "$t" ] || return 1
    printf '%s' "$t"
    return 0
  fi
  tp=$(gp_env GELDAR_TOOL_PATH)
  if [ -n "$tp" ]; then
    PATH=$tp command -v tmux > /dev/null 2>&1 || return 1
  else
    command -v tmux > /dev/null 2>&1 || return 1
  fi
  printf '%s' tmux
}

# The window command: env with the seams, then the absolute launcher path, quoted word by word.
multi_command() {
  local id=$1 name cmd="env"
  for name in $(compgen -e); do
    case $name in
      GELDAR_MCP_TOKEN) continue ;;
      GELDAR_* | FAKE_* | XDG_STATE_HOME | GIT_CONFIG_GLOBAL) ;;
      *) continue ;;
    esac
    [[ $name =~ ^[A-Za-z0-9_]+$ ]] || continue
    cmd="$cmd $(printf '%q' "$name=${!name}")"
  done
  printf '%s %s play %s' "$cmd" "$(printf '%q' "$GP_DIR/geldar-play")" "$id"
}

verb_play_many() {
  local id seen=" " n=0 tmux first=1
  for id in "$@"; do
    valid_player_id "$id" || die 2 bad_player_id "$id"
    case $seen in
      *" $id "*) die 1 dup_player "$id" ;;
    esac
    seen="$seen$id "
    n=$((n + 1))
  done
  tmux=$(multi_tmux) || die 1 missing_tool tmux "$(tool_hint tmux)"
  [ "$n" -le 3 ] || say many_players
  if [ -n "${TMUX:-}" ]; then
    for id in "$@"; do
      "$tmux" new-window -n "$id" "$(multi_command "$id")" || die 1 usage
    done
    return 0
  fi
  if "$tmux" has-session -t geldar > /dev/null 2>&1; then
    first=0
  fi
  for id in "$@"; do
    if [ "$first" = "1" ]; then
      "$tmux" new-session -d -s geldar -n "$id" "$(multi_command "$id")" || die 1 usage
      first=0
    else
      "$tmux" new-window -t geldar: -n "$id" "$(multi_command "$id")" || die 1 usage
    fi
  done
  "$tmux" attach-session -t geldar
}
