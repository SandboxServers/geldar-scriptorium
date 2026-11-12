#!/bin/sh
# The entrypoint of the `keeper` service (decision 64). It starts as root with only CHOWN, FOWNER,
# SETUID and SETGID, fixes the ownership of the keeper's own directories, then execs the keeper as
# the `keeper` user (uid 1002) with an empty capability set and no_new_privs.
#
# /keeper-state is keeper:supervisor 2750 (the supervisor user reads it, the player user cannot).
# /clone is keeper-only. /workspace and /supervisor-state are read-only mounts and are never
# touched. The deploy key is a read-only secret file and is never touched either.
set -eu
umask 027

chown 1002:1001 /keeper-state
chmod 2750 /keeper-state
chown 1002:1002 /clone
chmod 0700 /clone

exec setpriv --reuid=1002 --regid=1002 --clear-groups --bounding-set=-all --no-new-privs \
  geldar-keeper "$@"
