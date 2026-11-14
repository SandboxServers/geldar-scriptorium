# Fleet VM bootstrap

Two scripts set up the fleet VM's host state on Debian 12. Run them as root, in this order:

1. `bootstrap-git.sh` installs the apt packages and the pinned git (2.47.1 or newer). It reads
   `versions.env`. A `FILL_ME` pin stops it with exit 5 until the orchestrator fills the value.
2. `bootstrap.sh` does the rest: the three data volumes (`/srv/geldar/nvme-d`, `-e` and `-g`,
   mounted by label), the `geldar-runner` account, `/etc/geldar`, the installed fleet scripts and
   the launcher clone. It runs `bootstrap-git.sh` first, so running `bootstrap.sh` alone is enough.

Before either script, the VM user `geldar` (the ssh account) must exist. The scripts never create
it, and `bootstrap.sh` exits 6 when it is missing.

Until F-02a adds `fleet/bin`, `bootstrap.sh` skips the install and the launcher clone and says so.
Until F-02a adds `fleet/conf/allowed-repos.txt`, it does not install the allow-list and says so.
Both are run again after those cards land.

The VM's address is a DHCP reservation set on the gateway (M-2). Nothing in the repo holds an
address, so use the VM's host name.

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
pinned value that is `FILL_ME`, empty or malformed, 6 when `geldar` is missing or the launcher
clone is not at the pinned commit, and 7 when a step fails. The codes 2, 5, 6 and 7 from
`bootstrap-git.sh` pass through unchanged.

## Secrets

Tokens and keys are not placed by these scripts. The operator puts them in `/etc/geldar/tokens`
and `/etc/geldar/keys` (F-03).
