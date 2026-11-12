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
