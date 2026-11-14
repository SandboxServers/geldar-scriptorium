# geldar-play run, run-status, run-stop (SC-122, decision 60). Sourced; bash 3.2 syntax only.
# The supervisor keeps one player living: it loops full play cycles in the headless run mode and
# never skips the post-session gate or the commit. State lives in <state>/<id>/run/. It never
# prints the token, the prompt text or the stream contents.

RUN_STOP_FLAG=0
RUN_SLEEP_PID=""
RUN_LOCKED=""
RUN_DELAY_NOW=0

# The current time in seconds since the epoch (GELDAR_RUN_NOW is a gated test seam: a command).
run_now() {
  local c
  c=$(gp_env GELDAR_RUN_NOW)
  if [ -n "$c" ]; then "$c"; else date +%s; fi
}

# run_fmt <epoch> <date|stamp>: UTC text for the epoch.
run_fmt() {
  local f='%Y-%m-%dT%H:%M:%SZ'
  [ "$2" != date ] || f='%Y-%m-%d'
  date -u -d "@$1" "+$f" 2> /dev/null || date -u -r "$1" "+$f"
}

# run_sleep <seconds>: interruptible; returns early on a stop signal or a STOP file. The gated
# GELDAR_RUN_SLEEP command replaces the real wait (one call with the whole span).
run_sleep() {
  local secs=$1 c left step
  c=$(gp_env GELDAR_RUN_SLEEP)
  if [ -n "$c" ]; then
    "$c" "$secs"
    return 0
  fi
  left=$secs
  while [ "$left" -gt 0 ] && [ "$RUN_STOP_FLAG" -eq 0 ] && [ ! -e "$RUN_DIR/STOP" ]; do
    step=5
    [ "$left" -ge "$step" ] || step=$left
    sleep "$step" &
    RUN_SLEEP_PID=$!
    wait "$RUN_SLEEP_PID" 2> /dev/null
    kill "$RUN_SLEEP_PID" 2> /dev/null
    RUN_SLEEP_PID=""
    left=$((left - step))
  done
  return 0
}

# A stop signal (INT, TERM, HUP) never kills a running cycle or the summary call: it sets the
# flag, which ends the loop after the current round, and wakes the sleep.
run_on_signal() {
  [ "$RUN_STOP_FLAG" -ne 0 ] || say run_stopping
  RUN_STOP_FLAG=1
  [ -z "$RUN_SLEEP_PID" ] || kill "$RUN_SLEEP_PID" 2> /dev/null
}

# run_lock <id>: the lock folder appears whole (its pid file already in it) by one rename. An
# empty or unreadable pid means someone is starting: wait up to 2 seconds. Stale only when a
# pid is there and no such process exists.
run_lock() {
  local id=$1 l="$RUN_DIR/lock" t="$RUN_DIR/lock.$$" pid waited=0
  while :; do
    rm -rf "$t"
    { mkdir "$t" && printf '%s\n' "$$" > "$t/pid"; } || die 1 bad_state_path
    if [ ! -e "$l" ] && mv "$t" "$l" 2> /dev/null && [ "$(cat "$l/pid" 2> /dev/null)" = "$$" ]; then
      return 0
    fi
    rm -rf "$t"
    pid=$(cat "$l/pid" 2> /dev/null)
    if [[ $pid =~ ^[0-9]+$ ]]; then
      if kill -0 "$pid" 2> /dev/null; then die 1 run_already_running "$id" "$l" "$pid"; fi
      rm -rf "$l"
      continue
    fi
    [ "$waited" -lt 4 ] || die 1 run_already_running "$id" "$l" "unknown"
    waited=$((waited + 1))
    sleep 0.5
  done
}

run_cleanup() {
  lock_release
  [ -z "$RUN_LOCKED" ] || rm -rf "$RUN_DIR/lock"
  RUN_LOCKED=""
}

# run_num <name> <default> <min> <max> <result variable>: the validated integer value of a
# run setting (not a command substitution, so a refusal ends the launcher).
run_num() {
  local v=${!1:-$2}
  [[ $v =~ ^[0-9]{1,9}$ ]] || die 2 run_setting_bad "$1"
  { [ "$((10#$v))" -ge "$3" ] && [ "$((10#$v))" -le "$4" ]; } || die 2 run_setting_bad "$1"
  printf -v "$5" '%s' "$((10#$v))"
}

# The one-line summary JSON of a stream file (empty when none can be had).
run_summary() {
  local stream=$1 c name
  [ -f "$stream" ] || return 0
  trap '' INT TERM HUP
  c=$(gp_env GELDAR_RUN_SUMMARY_CMD)
  if [ -n "$c" ]; then
    "$c" "$stream" 2> /dev/null | head -n 1
    return 0
  fi
  name="geldar-$$-run-summary"
  run_bounded 120 --container "$name" docker_cmd run --rm -i --label geldar.role=run-summary --name "$name" \
    --memory 1g --pids-limit 256 --log-driver none \
    --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
    --entrypoint geldar-verify "$PL_KIT_IMAGE" run-summary < "$stream" 2> /dev/null | head -n 1
}

# run_field <json> <name> <default>: a number or boolean field of the summary line.
run_field() {
  local re="\"$2\":(true|false|-?[0-9][0-9.eE+-]*)"
  if [[ $1 =~ $re ]]; then printf '%s' "${BASH_REMATCH[1]}"; else printf '%s' "$3"; fi
}

# The character's last words from a summary line: decoded, no control characters, double quotes
# turned into single quotes, at most 1500 characters. It is untrusted text.
run_last_words() {
  printf '%s\n' "$1" | perl -CSD -ne '
    next unless /"last_text":"((?:[^"\\]|\\.)*)"/;
    my $t = $1;
    my %e = (n => " ", t => " ", r => " ", b => " ", f => " ");
    $t =~ s{\\u([dD][89abAB][0-9a-fA-F]{2})\\u([dD][c-fC-F][0-9a-fA-F]{2})|\\u([0-9a-fA-F]{4})|\\(.)}{
      defined $1 ? chr(0x10000 + ((hex($1) - 0xD800) << 10) + (hex($2) - 0xDC00))
      : defined $3 ? (hex($3) >= 0xD800 && hex($3) <= 0xDFFF ? "" : (hex($3) == 10 ? " " : chr(hex($3))))
      : (exists $e{$4} ? $e{$4} : $4)
    }gex;
    $t =~ s/[\x00-\x1f\x7f-\x9f]//g;
    $t =~ s/"/\x27/g;
    $t = substr($t, 0, 1500);
    print $t;
    last;'
}

# run_prompt <id> <n>: writes run/prompt.txt (mode 0600) for waking number n; prints its path.
run_prompt() {
  local n=$2 f="$RUN_DIR/prompt.txt" prev words="" text
  prev="$RUN_DIR/session-$((n - 1)).jsonl"
  if [ "$n" -gt 1 ] && [ -f "$prev" ]; then
    words=$(run_last_words "$(run_summary "$prev")")
  fi
  text="This is your waking number $n. You have been living here a while."
  [ -z "$words" ] || text="$text Last you said: \"$words\"."
  text="$text Read your journal first, then look around. If something does not work, read why and try another way. If you are truly stuck, wait or sleep and try again later; do not stop."
  (umask 077 && printf '%s\n' "$text" > "$f") && chmod 600 "$f" || die 1 bad_state_path
  printf '%s' "$f"
}

# The next run number: one more than the highest run/session-<n>.jsonl.
run_next_number() {
  local f b max=0
  for f in "$RUN_DIR"/session-*.jsonl; do
    [ -e "$f" ] || continue
    b=${f##*/session-}
    b=${b%.jsonl}
    [[ $b =~ ^[0-9]{1,9}$ ]] || continue
    [ "$((10#$b))" -le "$max" ] || max=$((10#$b))
  done
  printf '%s' $((max + 1))
}

# Cost summed over today's (UTC) lines of costs.csv.
run_cost_today() {
  [ -f "$RUN_DIR/costs.csv" ] || { printf '0'; return 0; }
  LC_ALL=C awk -F, -v d="$1" 'index($2, d) == 1 { s += $4 } END { printf "%.4f", s }' "$RUN_DIR/costs.csv"
}

# run_status_write <run> <state> <last_result> <today's cost>
run_status_write() {
  local now t
  now=$(run_fmt "$(run_now)" stamp)
  t="$RUN_DIR/status.json.new"
  (umask 077 && printf '{"run":%s,"state":"%s","started":"%s","last_result":"%s","cost_today":%s,"updated":"%s"}\n' \
    "$1" "$2" "$RUN_STARTED" "$3" "$4" "$now" > "$t") && mv "$t" "$RUN_DIR/status.json"
}

run_log() {
  printf '%s %s\n' "$(run_fmt "$(run_now)" stamp)" "$*" >> "$RUN_DIR/supervisor.log"
}

# One full play cycle in run mode, in a subshell so a refusal inside it ends only the cycle.
run_cycle() {
  local id=$1 n=$2 d prompt out c cid
  d=$(player_dir "$id")
  out="$RUN_DIR/session-$n.jsonl"
  prompt=$(run_prompt "$id" "$n") || exit 1
  if [ "$(gp_env GELDAR_RUN_DRY)" = 1 ]; then
    (umask 077 && printf '{"dry":true}\n' > "$out") && chmod 600 "$out" || return 1
    c=$(gp_env GELDAR_RUN_DRY_CMD)
    [ -z "$c" ] || "$c" "$n" "$out"
    return $?
  fi
  lock_acquire "$id"
  guard_not_held "$id"
  if [ -f "$d/session/running" ]; then
    cid=$(docker_cmd ps -q --filter label=geldar.role=session --filter "label=com.docker.compose.project=geldar-$id" 2> /dev/null)
    [ -z "$cid" ] || die 1 locked "$id"
    if docker_cmd volume inspect "geldar-ws-$id" > /dev/null 2>&1; then
      say recovering
      finish_session "$id"
      return 0
    fi
    rm -rf "$d/session"
    rm -f "$d/start" "$d/mode"
    say stale_cleared
  fi
  prepare_session "$id" play
  GELDAR_RUN_PROMPT_FILE=$prompt start_session "$id" run "$n"
  finish_session "$id"
}

# run <id>: the supervisor loop.
verb_run() {
  [ $# -eq 1 ] || die 2 usage
  local id=$1 d delay_base fast max_delay max_fails turns cap model delay fails=0 n e t0 t1 secs
  local cpid today cost sum rc ok turns_done cost_done err seen last="none" stop_fail=0
  dev_world_url "$id" > /dev/null || die 1 dev_world_bad "$id"
  run_num GELDAR_RUN_DELAY 20 1 86400 delay_base
  run_num GELDAR_RUN_MAX_DELAY 900 1 86400 max_delay
  run_num GELDAR_RUN_FAST_SEC 30 0 86400 fast
  run_num GELDAR_RUN_MAX_FAILS 5 1 1000 max_fails
  run_num GELDAR_RUN_MAX_TURNS 300 1 999999 turns
  cap=${GELDAR_RUN_DAILY_CAP_USD:-15}
  [[ $cap =~ ^[0-9]{1,6}(\.[0-9]{1,4})?$ ]] || die 2 run_setting_bad GELDAR_RUN_DAILY_CAP_USD
  LC_ALL=C awk -v c="$cap" 'BEGIN { exit !(c + 0 > 0) }' || die 2 run_setting_bad GELDAR_RUN_DAILY_CAP_USD
  model=${GELDAR_RUN_MODEL-}
  [ -z "$model" ] || [[ $model =~ ^[A-Za-z0-9._:/-]+$ ]] || die 2 run_setting_bad GELDAR_RUN_MODEL
  [ "$max_delay" -ge "$delay_base" ] || die 2 run_setting_bad GELDAR_RUN_MAX_DELAY
  export GELDAR_RUN_MAX_TURNS=$turns
  d=$(player_dir "$id")
  read_player "$id"
  [ "$PL_HARNESS" = claude ] || die 1 chatgpt_persistent
  RUN_DIR="$d/run"
  if [ -L "$RUN_DIR" ]; then die 1 bad_state_path; fi
  private_mkdir "$d/run"
  run_lock "$id"
  RUN_LOCKED=1
  trap run_cleanup EXIT
  trap run_on_signal INT TERM HUP
  # A manual STOP is stale at the start and cleared; one the supervisor wrote itself is not.
  if [ -f "$RUN_DIR/STOP" ]; then
    IFS= read -r seen < "$RUN_DIR/STOP"
    case $seen in
      auto:*) die 1 run_stopped_auto "${seen#auto: }" "$RUN_DIR/STOP" ;;
    esac
    rm -f "$RUN_DIR/STOP"
  fi
  RUN_STARTED=$(run_fmt "$(run_now)" stamp)
  delay=$delay_base
  n=0
  say run_start "$id"
  while :; do
    if [ "$RUN_STOP_FLAG" -ne 0 ] || [ -e "$RUN_DIR/STOP" ]; then break; fi
    e=$(run_now)
    today=$(run_fmt "$e" date)
    sum=$(run_cost_today "$today")
    if LC_ALL=C awk -v s="$sum" -v c="$cap" 'BEGIN { exit !(s + 0 >= c + 0) }'; then
      secs=$((86400 - e % 86400))
      say run_cap_reached "$cap"
      run_log "cap reached cost=$sum waiting=$secs"
      run_status_write "$n" sleeping "$last" "$sum"
      run_sleep "$secs"
      continue
    fi
    n=$(run_next_number)
    run_status_write "$n" running "$last" "$sum"
    t0=$(run_now)
    ( trap '' INT TERM HUP; run_cycle "$id" "$n" ) &
    cpid=$!
    wait "$cpid"
    rc=$?
    while kill -0 "$cpid" 2> /dev/null; do
      wait "$cpid"
      rc=$?
    done
    t1=$(run_now)
    secs=$((t1 - t0))
    sum=$(run_summary "$RUN_DIR/session-$n.jsonl")
    turns_done=$(run_field "$sum" turns 0)
    cost_done=$(run_field "$sum" cost 0)
    err=$(run_field "$sum" is_error true)
    seen=$(run_field "$sum" result_seen false)
    printf '%s,%s,%s,%s\n' "$n" "$(run_fmt "$t1" stamp)" "$turns_done" "$cost_done" >> "$RUN_DIR/costs.csv"
    ok=1
    if [ "$rc" -ne 0 ] || [ "$secs" -lt "$fast" ] || [ "$err" = true ] || [ "$seen" != true ]; then ok=0; fi
    if [ "$ok" -eq 1 ]; then
      fails=0
      delay=$delay_base
      last=ok
    else
      fails=$((fails + 1))
      delay=$((delay * 2))
      [ "$delay" -le "$max_delay" ] || delay=$max_delay
      last=failed
    fi
    cost=$(run_cost_today "$(run_fmt "$t1" date)")
    run_log "run=$n turns=$turns_done cost=$cost_done secs=$secs exit=$rc result=$last delay=$delay fails=$fails"
    run_status_write "$n" sleeping "$last" "$cost"
    if [ "$rc" -eq 3 ] || [ -d "$d/held" ]; then
      (umask 077 && printf 'auto: the saved session was held back\n' > "$RUN_DIR/STOP")
      say run_held "$id" "$id"
      stop_fail=1
      break
    fi
    if [ "$fails" -ge "$max_fails" ]; then
      (umask 077 && printf 'auto: %s failed cycles in a row\n' "$fails" > "$RUN_DIR/STOP")
      say run_too_many_failures "$fails"
      stop_fail=1
      break
    fi
    if [ "$RUN_STOP_FLAG" -ne 0 ] || [ -e "$RUN_DIR/STOP" ]; then break; fi
    if [ "$ok" -eq 0 ]; then say run_backoff "$n" "$delay"; fi
    run_sleep "$delay"
  done
  run_status_write "${n:-0}" stopped "$last" "$(run_cost_today "$(run_fmt "$(run_now)" date)")"
  run_log "stopped"
  say run_stopped "${n:-0}"
  return $stop_fail
}

# run-status <id>: the status file, the last 5 cost lines and the tool-call counts of the latest stream.
verb_run_status() {
  [ $# -eq 1 ] || die 2 usage
  local id=$1 f latest="" b max=0 sum tools
  [ -d "$(player_dir "$id")" ] || die 1 no_such_player "$id" "$id"
  RUN_DIR="$(player_dir "$id")/run"
  [ -d "$RUN_DIR" ] || die 0 run_status_none "$id"
  if [ -f "$RUN_DIR/status.json" ]; then cat "$RUN_DIR/status.json"; fi
  if [ -f "$RUN_DIR/costs.csv" ]; then tail -n 5 "$RUN_DIR/costs.csv"; fi
  for f in "$RUN_DIR"/session-*.jsonl; do
    [ -e "$f" ] || continue
    b=${f##*/session-}
    b=${b%.jsonl}
    [[ $b =~ ^[0-9]{1,9}$ ]] || continue
    if [ "$((10#$b))" -gt "$max" ]; then max=$((10#$b)); latest=$f; fi
  done
  [ -n "$latest" ] || return 0
  read_player "$id"
  sum=$(run_summary "$latest")
  tools=$(printf '%s' "$sum" | sed -n 's/^.*"tools":\({[^}]*}\).*$/\1/p')
  [ -n "$tools" ] || if [ -n "$sum" ]; then tools='{}'; else tools=unavailable; fi
  printf 'tools: %s\n' "$tools"
}

# run-stop <id>: asks a running supervisor to stop after the current cycle.
verb_run_stop() {
  [ $# -eq 1 ] || die 2 usage
  local id=$1 d
  d=$(player_dir "$id")
  [ -d "$d" ] || die 1 no_such_player "$id" "$id"
  if [ -L "$d/run" ]; then die 1 bad_state_path; fi
  private_mkdir "$d/run"
  (umask 077 && printf 'manual\n' > "$d/run/STOP")
  say run_stop_requested "$id"
}
