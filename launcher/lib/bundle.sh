# After the session: the workspace bundle and the verify gate (H-09, H-10, H-16).
# Sourced; bash 3.2 syntax only. The workspace is read only through a container with no network.

GP_BUNDLE_CAP=52428800
GP_REASONS=" bad_arguments verify_error bundle_too_large bundle_unreadable bundle_refs_unexpected bundle_fetch_failed too_many_commits not_fast_forward merge_commit identity_mismatch identity_changed path_not_allowed symlink_not_allowed gitlink_not_allowed executable_not_allowed bad_mode "

# The flags every helper container gets.
helper_flags() {
  printf '%s\n' --rm --memory 1g --pids-limit 256 --log-driver none --cap-drop ALL \
    --security-opt no-new-privileges --network none
}

# The pipeline body: the container writes the bundle to stdout, head keeps at most cap+1 bytes.
# When head stops at the cap the container is killed by name (it could otherwise write on).
bundle_pipe() {
  local name=$1 out=$2 rcf=$3 image=$4 branch=$5 id=$6 f size tries
  local -a flags
  flags=()
  while IFS= read -r f; do
    flags+=("$f")
  done < <(helper_flags)
  {
    docker_cmd run "${flags[@]}" --label geldar.role=bundle --name "$name" \
      -e HOME=/tmp -e GIT_CONFIG_GLOBAL=/dev/null -e GIT_CONFIG_NOSYSTEM=1 -e GIT_NO_REPLACE_OBJECTS=1 \
      -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/player \
      -v "geldar-ws-$id:/player:ro" -e "GELDAR_BRANCH=$branch" \
      "$image" sh -c 'git -C /player bundle create - "refs/heads/$GELDAR_BRANCH"'
    echo $? > "$rcf"
  } | {
    head -c $((GP_BUNDLE_CAP + 1)) > "$out"
    # This stage still holds the pipe's read end after head is gone. Drop it, or the writer blocks
    # on a full pipe that nobody reads and never sees the pipe close (so it never ends).
    exec 0< /dev/null
    size=$(wc -c < "$out" | tr -d ' ')
    if [ "${size:-0}" -gt "$GP_BUNDLE_CAP" ]; then
      # One kill can land before the container exists or is blocked (it may still be dying of the
      # closed pipe), so repeat until docker run has ended and written its status.
      tries=0
      while [ ! -f "$rcf" ] && [ "$tries" -lt 300 ]; do
        docker_cmd kill "$name" > /dev/null 2>&1
        [ -f "$rcf" ] || sleep 0.2
        tries=$((tries + 1))
      done
    fi
  }
}

# make_bundle id: needs read_player (PL_BRANCH, PL_KIT_IMAGE). Returns 0, or 1 with GP_FAIL set.
make_bundle() {
  local id=$1 sd out rcf name rc size dockrc=""
  sd="$(player_dir "$id")/session"
  out="$sd/bundle.bundle"
  rcf="$sd/bundle.rc"
  name="geldar-bundle-$id-$$"
  rm -f "$out" "$rcf"
  run_bounded 300 --container "$name" bundle_pipe "$name" "$out" "$rcf" "$PL_KIT_IMAGE" "$PL_BRANCH" "$id"
  rc=$?
  size=0
  [ ! -f "$out" ] || size=$(wc -c < "$out" | tr -d ' ')
  [ -f "$rcf" ] && IFS= read -r dockrc < "$rcf"
  rm -f "$rcf"
  # H-10: a full-size file is too large whatever status the closed pipe gave the docker client.
  if [ "$size" -gt "$GP_BUNDLE_CAP" ]; then
    GP_FAIL=bundle_too_large
    return 1
  fi
  if [ "$rc" -ne 0 ] || [ "$dockrc" != "0" ]; then
    GP_FAIL=bundle_failed
    return 1
  fi
  return 0
}

# Prints the launcher's own text for each reason of a parsed rejection; 1 when unreadable.
print_reasons() {
  local list=$1 r
  local IFS=,
  for r in $list; do
    r=${r//\"/}
    case "$GP_REASONS" in
      *" $r "*) ;;
      *) return 1 ;;
    esac
  done
  for r in $list; do
    r=${r//\"/}
    say "reason_$r"
  done
  return 0
}

# verify_bundle id start mode: 0 only for exit 0 and exactly {"ok":true,"reasons":[]}.
# Otherwise returns 1 with GP_FAIL set and the reasons already printed.
verify_bundle() {
  local id=$1 start=$2 mode=$3 sd out rc name image re list
  local -a flags
  sd="$(player_dir "$id")/session"
  name="geldar-verify-$id-$$"
  flags=()
  while IFS= read -r image; do
    flags+=("$image")
  done < <(helper_flags)
  out=$(run_bounded 300 --container "$name" docker_cmd run "${flags[@]}" \
    --label geldar.role=verify --name "$name" \
    -e HOME=/tmp -e GIT_CONFIG_GLOBAL=/dev/null -e GIT_CONFIG_NOSYSTEM=1 -e GIT_NO_REPLACE_OBJECTS=1 \
    --read-only --tmpfs /tmp:size=256m -v "$sd/bundle.bundle:/in/bundle.bundle:ro" \
    "$PL_KIT_IMAGE" geldar-verify --bundle /in/bundle.bundle --start "$start" \
    --branch "$PL_BRANCH" --mode "$mode" --player-id "$id" 2> /dev/null)
  rc=$?
  if [ "$rc" -eq 0 ] && [ "$out" = '{"ok":true,"reasons":[]}' ]; then
    return 0
  fi
  re='^\{"ok":false,"reasons":\[("[a-z_]+"(,"[a-z_]+")*)\]\}$'
  if [ "$rc" -ne 124 ] && [[ $out =~ $re ]]; then
    list=${out#*\"reasons\":\[}
    list=${list%\]\}}
    if print_reasons "$list"; then
      GP_FAIL=verify_rejected
      return 1
    fi
  fi
  GP_FAIL=verify_unreadable
  return 1
}
