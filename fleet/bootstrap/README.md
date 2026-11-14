# Fleet VM bootstrap

Two scripts set up the fleet VM's host state on Debian 12. Run them as root, `bootstrap.sh` only:

1. `bootstrap.sh` checks the pins in `versions.env` and the VM user `geldar` first. A `FILL_ME`
   pin stops it with exit 5, and a missing `geldar` with exit 6, before any step acts.
2. It runs `bootstrap-git.sh`, which installs the apt packages and the pinned git (2.47.1 or
   newer). Running `bootstrap-git.sh` by hand first is also fine; `bootstrap.sh` runs it again.
3. The rest of `bootstrap.sh`: the three data volumes (`/srv/geldar/nvme-d`, `-e` and `-g`,
   mounted by label), the `geldar-runner` account, `/etc/geldar`, the installed fleet scripts and
   the launcher clone, then the self-check.

Before either script, the VM user `geldar` (the ssh account) must exist. The scripts never create
it, and `bootstrap.sh` exits 6 when it is missing.

`bootstrap.sh` skips the fleet scripts and the launcher clone, and says so, when the checkout has no
`fleet/bin`. Run it again from a checkout that has it. `fleet/conf/allowed-repos.txt` ships empty:
the orchestrator fills it with the allowed `<org>/player-ag-*` lines (the exact org and glob are
TBC by scriptorium-orchestrator). Until it is filled, the installed copy has no lines.

The VM's address is a DHCP reservation set on the gateway (M-2). Nothing in the repo holds an
address, so use the VM's host name.

## Launcher clone and its deploy key

The launcher clone is `~geldar/scriptorium`, cloned from `LAUNCHER_URL` and checked out at
`LAUNCHER_COMMIT` (both in `versions.env`). `LAUNCHER_URL` is the ssh address
`git@github.com:SandboxServers/geldar-scriptorium.git`; ssh versus https is TBC by
scriptorium-orchestrator.

The repo is private, so the clone authenticates with a read-only deploy key that the operator
places on the VM. Nothing in the repo holds a key. The operator places two files before the first
run:

- `/etc/geldar/keys/launcher-read`: the deploy key, `root:geldar` 0640.
- `/etc/geldar/launcher_known_hosts`: a known_hosts entry for the git host, provided by the operator
  and checked by ssh (`StrictHostKeyChecking=yes`).

The clone runs as `geldar` with `GIT_SSH_COMMAND="ssh -i /etc/geldar/keys/launcher-read
-o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/geldar/launcher_known_hosts"`.
When `~geldar/scriptorium` already exists, the clone and the key are skipped and only the checkout
runs. When a clone is needed and either file is missing, `bootstrap.sh` exits 5 and names it.

After the checkout, `bootstrap.sh` compares the clone's HEAD with the commit that `LAUNCHER_COMMIT`
resolves to in that clone. A different commit exits 6. A `LAUNCHER_COMMIT` that does not resolve
also exits 6.

## Confirm git

```sh
/usr/local/bin/git --version
runuser -u geldar -- git --version
runuser -u geldar-runner -- git --version
```

Each must print 2.47.1 or newer. The self-check at the end of `bootstrap.sh` runs the same three
commands. It prints `bootstrap: ok` when they pass, and otherwise the name of each failed check.

## Exit codes

`bootstrap.sh` exits 0 when done, 1 when the self-check fails, 2 when not run as root, 5 for a
pinned value that is `FILL_ME`, empty or malformed, or for a launcher clone that is needed while the
deploy key or the known_hosts file is missing, 6 when `geldar` is missing or the launcher clone is
not at the commit `LAUNCHER_COMMIT` names, and 7 when a step fails. A step that fails without a
mapped code (for example a directory that cannot be created) exits 7 and names its line. The codes
2, 5, 6 and 7 from `bootstrap-git.sh` pass through unchanged.

## Secrets

Tokens and keys for the players are not placed by these scripts. The operator puts them in
`/etc/geldar/tokens` and `/etc/geldar/keys` (F-03). The launcher deploy key above is the one
exception the operator places by hand, before the first run.
