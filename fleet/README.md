# Fleet scripts

The VM side of the player-host fleet: the scripts that place, add, restart, remove and report on
player hosts. The campaign and design live in `docs/analysis/fleet/`. Fleet scripts run on
Debian 12 under bash, and never call `docker compose` themselves: they reach the launcher only
through the root-owned wrapper.

## F-02a

Shared library and volume choice.

Files: `lib/common.sh` (helpers), `bin/place.sh` (`geldar-fleet-place`), `conf/allowed-repos.txt`
(empty until the orchestrator writes the allow-list), and tests under `test/`. `test/fake-run.sh`
is a fake wrapper for the tests.

### Test seams

Read only when `GELDAR_INTERNAL=1`; otherwise ignored.

| Name | Meaning |
|---|---|
| `GEL_ROOT` | prefix for every absolute path in the Contract (empty on the VM) |
| `GEL_RUN` | the wrapper command (default `sudo -n /usr/local/sbin/geldar-fleet-run`) |
| `GEL_DF` | a command that prints the `df -B1 --output=avail,size` shape for a path |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | done, including an idempotent no-op |
| 2 | usage, invalid id, repo, roster text, wrapper verb or flag, or dispatch input |
| 3 | no data volume with enough free space |
| 4 | repo not in the roster or different from the roster or placement; restart of an unknown host |
| 5 | `max_hosts` cap reached, or `fleet.conf` missing or invalid; the global lock wait ran out |
| 6 | secret or shared login missing, empty or unreadable by `geldar` (only from the `check-secrets` and `check-login` built-ins) |
| 7 | launcher verb failure, including a 6 from any other verb and the wrapper's sudo refusal |
| 8 | another operation holds this id's lock |

### Placement

`geldar-fleet-place <id> [--reserve]` prints `volume=nvme-<x> free_pct=<n>`. Volumes are
`nvme-d`, `nvme-e` and `nvme-g`, mounted under `/srv/geldar`. A volume is skipped when its free
percentage is below `min_free_pct`; the one with the most free bytes wins. An existing placement
file wins. `--reserve` takes `_global.lock`, applies the `max_hosts` cap and writes
`/etc/geldar/placement/<id>`.

`place.sh` has no mountpoint guard: whether `/srv/geldar/nvme-<x>` is really mounted is checked by
F-01b, not here.

`_global.lock` is not re-entrant. F-02b must call `place.sh --reserve` itself and must not hold
`_global.lock` around it, or the call deadlocks until the 60-second wait runs out (exit 5).

A refusal (exit 3, 4 or 5) from `place.sh` leaves one result line in `/var/log/geldar-hosts.log`.
Logging is best-effort: an unwritable log never changes the exit code.
