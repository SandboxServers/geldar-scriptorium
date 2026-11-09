# After the session: bundle, verify, host re-check, fetch, push, fast-forward, hold (H-09 to H-17).
# Sourced; bash 3.2 syntax only. finish_session is the one function the play and the
# crash-recovery paths share; it uses only <state>/<id>/{start,mode,branch}.

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
# git has checked itself. Used by `--until verify` only; the full finish uses the host clone.
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

# The last check before the push: the host clone is clean, on the stored branch, and HEAD is
# START or an ancestor of what is about to be pushed.
host_still_ok() {
  local clone=$1 st
  st=$(git_cmd -C "$clone" status --porcelain --untracked-files=all 2> /dev/null) || return 1
  [ -z "$st" ] || return 1
  st=$(git_cmd -C "$clone" symbolic-ref -q --short HEAD 2> /dev/null)
  [ "$st" = "$PL_BRANCH" ] || return 1
  git_cmd -C "$clone" merge-base --is-ancestor HEAD refs/launcher/incoming > /dev/null 2>&1
}

# H-15: only after the memory is on origin and in the host branch.
finish_cleanup() {
  local id=$1 clone=$2 d
  d=$(player_dir "$id")
  git_cmd -C "$clone" update-ref -d refs/launcher/incoming > /dev/null 2>&1
  docker_cmd volume rm "geldar-ws-$id" > /dev/null 2>&1
  rm -rf "$d/session"
  rm -f "$d/start" "$d/mode"
}

# Fetch (H-12), re-check (H-13), push by SHA, then fast-forward the host branch (H-14).
finish_publish() {
  local id=$1 start=$2 mode=$3 clone=$PL_CLONE sd sha n line out rc hooks
  sd="$(player_dir "$id")/session"
  hooks="$(state_dir)/empty-hooks"
  git_cmd -C "$clone" update-ref -d refs/launcher/incoming > /dev/null 2>&1
  if ! run_bounded 120 git_cmd -C "$clone" -c fetch.fsckObjects=true -c transfer.fsckObjects=true \
    fetch --no-tags "$sd/bundle.bundle" "refs/heads/$PL_BRANCH:refs/launcher/incoming" > /dev/null 2>&1; then
    say fetch_failed "$id"
    finish_hold "$id" fetch_failed
  fi
  if ! host_recheck "$clone" "$start" refs/launcher/incoming "$mode"; then
    say recheck_failed "$RC_WHY" "$id"
    finish_hold "$id" recheck_failed
  fi
  sha=$(git_cmd -C "$clone" rev-parse refs/launcher/incoming 2> /dev/null)
  if ! [[ $sha =~ ^[0-9a-f]{40}$ ]]; then
    say fetch_failed "$id"
    finish_hold "$id" fetch_failed
  fi
  # The last check before the push.
  if ! host_still_ok "$clone"; then
    say host_moved "$id" "$id"
    finish_hold "$id" host_moved
  fi
  if [ "$sha" = "$start" ]; then
    finish_cleanup "$id" "$clone"
    say nothing_to_save "$id"
    return 0
  fi
  n=$(git_cmd -C "$clone" rev-list --count "$start..$sha" 2> /dev/null) || n=0
  out=$(mktemp "${TMPDIR:-/tmp}/gp-push.XXXXXX")
  run_bounded 120 git_cmd -C "$clone" push origin "$sha:refs/heads/$PL_BRANCH" > "$out" 2>&1
  rc=$?
  if [ "$rc" -ne 0 ] || grep -q 'rejected' "$out"; then
    rm -f "$out"
    say push_failed "$id"
    finish_hold "$id" push_failed
  fi
  rm -f "$out"
  # Only now does the human's branch move.
  if [ -n "$(gp_env GELDAR_TEST_FORCE_FF_FAIL)" ] ||
    ! git_cmd -C "$clone" -c "core.hooksPath=$hooks" -c core.autocrlf=false -c core.fsmonitor=false \
      merge --ff-only refs/launcher/incoming > /dev/null 2>&1; then
    say ff_failed "$id" "$id"
    finish_hold "$id" ff_failed
  fi
  say saved "$n" "$id"
  git_cmd -C "$clone" log -n 5 --format=%s "$start..$sha" 2> /dev/null | while IFS= read -r line; do
    printf '  %s\n' "$(printf '%s' "$line" | sanitize)" >&2
  done
  finish_cleanup "$id" "$clone"
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
  if [ "$until" = "verify" ]; then
    if ! recheck_scratch "$id" "$start" "$mode"; then
      say recheck_failed "$RC_WHY" "$id"
      finish_hold "$id" recheck_failed
    fi
    say verify_ok
    return 0
  fi
  finish_publish "$id" "$start" "$mode"
}

verb___finish() {
  [ $# -eq 1 ] || { [ $# -eq 3 ] && [ "$2" = "--until" ] && [ "$3" = "verify" ]; } || die 2 usage
  finish_session "$@"
}
