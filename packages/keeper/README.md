# geldar-keeper

The loop in the `keeper` service of the player group (decision 64). Every
`GELDAR_KEEPER_INTERVAL` seconds, or when the supervisor drops a `checkpoint-request` file in its
state folder, it fetches the committed history of the read-only workspace into its private bare
clone with hardened git, runs the `geldar-verify` gate on it and pushes fast-forward only to the
repository's branch over SSH with the deploy key. Any refusal writes `HELD` and stops pushing
until a person removes it.

| Variable | Default | Meaning |
|---|---|---|
| `GELDAR_KEEPER_REMOTE` | required | the repository to push to |
| `GELDAR_KEEPER_PLAYER_ID` | required | the player id the gate checks identities against |
| `GELDAR_KEEPER_KEY` | `/run/secrets/geldar-deploy-key` | the deploy key file |
| `GELDAR_KEEPER_INTERVAL` | `600` | seconds between runs |
| `GELDAR_KEEPER_WORKSPACE` | `/workspace` | the workspace volume, read-only |
| `GELDAR_KEEPER_CLONE` | `/clone` | the private bare clone |
| `GELDAR_KEEPER_STATE` | `/keeper-state` | `status.json`, `HELD`, `last-pushed-head` |
| `GELDAR_KEEPER_SUPERVISOR_STATE` | `/supervisor-state` | read-only; only `checkpoint-request` is looked at |
| `GELDAR_KEEPER_BRANCH` | `main` | the branch in the workspace and the remote |
| `GELDAR_KEEPER_PROXY` | `proxy-keeper:3128` | the proxy the CONNECT helper uses |
| `GELDAR_KEEPER_KNOWN_HOSTS` | `/etc/geldar/keeper-known-hosts` | the pinned host keys |

`geldar-keeper-connect <host> <port>` is the ProxyCommand helper. `geldar-keeper --once` runs a
single cycle.

**Upstream offers (SC-167).** Each cycle also fetches the remote branch read only. When it is a
fast-forward of the last pushed head, the commits pass the upstream checks (at most 200 commits,
no symlink, no submodule, no unsafe path, nothing under `memory/`, no blob over 2 MiB) and are
written to `upstream.bundle` with `upstream.json` beside it. Each refusal removes the offer and
writes no bundle. A diverged remote is recorded, not held. Applying the bundle is the supervisor's
job, between runs; this package only offers it.

`upstream.json` keys: `head` (the offered commit), `base` (the last pushed head), `commits` (the
count), `created_utc`.

`status.json` keys added: `upstream_head` (the offered head, or null) and `upstream_result`
(`offered`, `none`, `diverged` or `refused: <code>`).

A `sync-request` file in the keeper state folder wakes the loop at once for an upstream check. It
is deleted when the cycle that serves it finishes.
