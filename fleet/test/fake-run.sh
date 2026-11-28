#!/usr/bin/env bash
# A fake wrapper for the fleet tests, standing in for geldar-fleet-run (GEL_RUN). It appends one
# line to $FAKE_RUN_LOG: the argv tab-separated, then the NAMES of the environment variables it was
# started with (never their values). The built-ins check-secrets and check-login exit 6 when
# FAKE_RUN_MISSING is set. The launcher verbs exit FAKE_RUN_EXIT (default 0). Anything else exits 2.
set -euo pipefail
: "${FAKE_RUN_LOG:?FAKE_RUN_LOG is not set}"

names=$(env | cut -d= -f1 | sort | tr '\n' ' ')
line=""
sep=""
for a in "$@"; do
  line="$line$sep$a"
  sep=$'\t'
done
printf '%s\tenv=%s\n' "$line" "$names" >>"$FAKE_RUN_LOG"

case ${1:-} in
  adopt | deploy-key | start | restart | stop | remove | upgrade | player-status)
    exit "${FAKE_RUN_EXIT:-0}"
    ;;
  check-secrets | check-login)
    if [ -n "${FAKE_RUN_MISSING:-}" ]; then
      exit 6
    fi
    exit 0
    ;;
  *) exit 2 ;;
esac
