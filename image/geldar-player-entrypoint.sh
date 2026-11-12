#!/bin/sh
# The entrypoint of the `player` service (decision 64). It starts as root with only CHOWN, FOWNER,
# SETUID and SETGID, fixes the ownership of the mounted state directories, seeds the CLI home as
# the player user (the kit entrypoint is reused, not copied), then execs the supervisor as the
# `supervisor` user (uid 1001). The supervisor keeps SETUID and SETGID as ambient capabilities so it
# can start each run as the `player` user (uid 1000); nothing else survives, and the children it
# starts hold no capability at all. Every exec after the first drop has no_new_privs set.
#
# Modes: /state/supervisor is supervisor:keeper 2750, so the keeper user reads it and the player
# user cannot. /keeper-state is mounted read-only here; its group (supervisor) lets the
# supervisor read HELD.
set -eu
umask 027

chown 1001:1002 /state/supervisor
chmod 2750 /state/supervisor
# A workspace or CLI home first filled by root is handed to the player once; later starts only
# check the top directory.
for dir in /player /cli-home; do
  [ "$(stat -c %u "$dir")" = 1000 ] || chown -R 1000:1000 "$dir"
done

as_user() {
  uid=$1
  shift
  setpriv --reuid="$uid" --regid="$uid" --clear-groups --bounding-set=-all --no-new-privs "$@"
}

# The kit entrypoint seeds workspace trust in /cli-home; its `true` argument just ends it.
as_user 1000 /usr/local/bin/geldar-entrypoint.sh true || echo "geldar-player-entrypoint: CLI home seeding failed; continuing" >&2

exec setpriv --reuid=1001 --regid=1001 --clear-groups \
  --bounding-set=-all,+setuid,+setgid --inh-caps=+setuid,+setgid --ambient-caps=+setuid,+setgid \
  --no-new-privs geldar-supervisor "$@"
