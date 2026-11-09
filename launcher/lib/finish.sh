# After the session: bundle, verify, host re-check, hold. Sourced; bash 3.2 syntax only.
# This is the minimal form (SC-51a); the fetch, push and fast-forward steps extend it.

# A failure after the session: the bundle and the workspace stay, the host branch is untouched.
finish_hold() {
  local id=$1 reason=$2 d start="" mode=""
  d=$(player_dir "$id")
  mkdir -p "$d/held"
  [ ! -f "$d/session/bundle.bundle" ] || cp "$d/session/bundle.bundle" "$d/held/bundle.bundle"
  IFS= read -r start < "$d/start" 2> /dev/null
  IFS= read -r mode < "$d/mode" 2> /dev/null
  {
    printf 'reason=%s\n' "$reason"
    printf 'start=%s\n' "$start"
    printf 'mode=%s\n' "$mode"
    printf 'branch=%s\n' "${PL_BRANCH:-}"
  } > "$d/held/info"
  exit 3
}

# The bundle is fetched into a scratch repository, so the re-check runs on objects the host
# git has checked itself.
recheck_scratch() {
  local id=$1 start=$2 mode=$3 sd repo
  sd="$(player_dir "$id")/session"
  repo="$sd/recheck.git"
  rm -rf "$repo"
  git_cmd init --bare -q "$repo" > /dev/null 2>&1 || return 1
  git_cmd -C "$repo" -c fetch.fsckObjects=true -c transfer.fsckObjects=true fetch --no-tags \
    "$sd/bundle.bundle" "refs/heads/$PL_BRANCH:refs/launcher/incoming" > /dev/null 2>&1 || {
    RC_WHY='fetch'
    rm -rf "$repo"
    return 1
  }
  host_recheck "$repo" "$start" refs/launcher/incoming "$mode"
  local rc=$?
  rm -rf "$repo"
  return $rc
}

# finish_session id [--until verify]
finish_session() {
  local id=$1 until="" d start mode
  [ "${2:-}" != "--until" ] || until=${3:-}
  d=$(player_dir "$id")
  IFS= read -r start < "$d/start" 2> /dev/null || die 1 no_such_player "$id" "$id"
  IFS= read -r mode < "$d/mode" 2> /dev/null || die 1 no_such_player "$id" "$id"
  read_player "$id" "$start"
  GP_FAIL=""
  if ! make_bundle "$id"; then
    say "$GP_FAIL" "$id"
    finish_hold "$id" "$GP_FAIL"
  fi
  if ! verify_bundle "$id" "$start" "$mode"; then
    case $GP_FAIL in
      verify_rejected | verify_unreadable) say "$GP_FAIL" "$id" ;;
    esac
    finish_hold "$id" "$GP_FAIL"
  fi
  if ! recheck_scratch "$id" "$start" "$mode"; then
    say recheck_failed "$RC_WHY" "$id"
    finish_hold "$id" recheck_failed
  fi
  say verify_ok
  [ "$until" = "verify" ] || die 2 not_yet
  return 0
}

verb___finish() {
  [ $# -eq 1 ] || { [ $# -eq 3 ] && [ "$2" = "--until" ] && [ "$3" = "verify" ]; } || die 2 usage
  finish_session "$@"
}
