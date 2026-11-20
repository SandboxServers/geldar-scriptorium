# Runner

The self-hosted GitHub Actions runner of the fleet: the account `geldar-runner`, its directory
`/opt/geldar-runner`, the label `geldar-hosts` and the systemd unit `geldar-runner.service`. The
runner executes the `deploy-player` workflow on the VM; the root wrapper and its sudo rule come with
F-05b.

## Install

Run as root on the VM, after `bootstrap.sh`, with the one-time registration token of the repo in a
file the operator placed (the token is not a value in this repo):

```
install-runner.sh --url https://github.com/<org>/<repo> --token-file <file>
```

What the script does, in order:

1. Checks the arguments (exit 2), then the pins in `versions.env`: `RUNNER_VERSION` and
   `RUNNER_SHA256` must be set, not `FILL_ME`, and well formed (exit 5).
2. Reads the token file. The token reaches `config.sh` only through the environment of `runuser`
   (`ACTIONS_RUNNER_INPUT_TOKEN`); it is never an argument, never printed, never logged.
3. Creates `geldar-runner` when absent (a system user, no login shell). Refuses the account when it
   is in `docker`, `sudo` or `wheel` (exit 6).
4. Downloads the pinned linux-x64 tarball, checks its sha256 before anything is unpacked (a mismatch
   is exit 5), and unpacks it into `/opt/geldar-runner`, owned by `geldar-runner`. Skipped when
   `config.sh` is already there.
5. Registers the runner as `geldar-runner` through `runuser` with `--unattended --replace`. The
   custom label is `geldar-hosts`; the default labels `self-hosted`, `Linux` and `X64` are kept.
   Skipped when `.runner` is already there.
6. Copies `geldar-runner.service` to `/etc/systemd/system/`, then runs `systemctl enable --now`.

Notes on a re-run:

- A re-run does not restart a unit that is already running. After a change to the unit, restart it
  by hand (`systemctl restart geldar-runner.service`).
- The script does not run `bin/installdependencies.sh` of the runner, so it does not install the
  runner's dependencies (libicu). F-08 step 1 verifies libicu on the VM.

### Self-update

The runner updates itself. This is the owner's choice (D-FL-10): runner binaries may change without
a PR. `RUNNER_VERSION` and `RUNNER_SHA256` govern the first install only; they do not pin the runner
after it is running. A reviewer who wants a pinned runner must change this section and the unit,
not the pins alone.

### Why the unit has no NoNewPrivileges

`geldar-runner.service` must not set `NoNewPrivileges=yes`. The runner reaches the wrapper through
the setuid `sudo` binary, and `NoNewPrivileges` stops a setuid binary from raising privileges, which
breaks that path. The snapshot test asserts the line is absent.

The setuid `sudo` child inherits the unit's mount namespace, so the wrapper and the launcher run
inside it. `ProtectHome=read-only` keeps `/home/geldar` readable, and `ReadWritePaths` names the
only places they write: the launcher clone, its state directory and `/srv/geldar`, plus the runner
paths. `/etc/geldar` stays read-only. This is reasoned, not verified: running one wrapper verb
through the real unit on the VM (F-08 step 1) is mandatory before the unit is enabled for real work.
If it fails, the orchestrator adjusts `ReadWritePaths` and the snapshot together.

### Test seam

`GEL_ROOT` prefixes the install paths (`/opt/geldar-runner`, the unit path) for the tests. It is read
only when `GELDAR_INTERNAL=1`; on the VM it is empty. The table in `fleet/README.md` lists it.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | installed (`result=installed version=<v> labels=geldar-hosts`) |
| 2 | usage, not root, a URL that is not `https://github.com/<org>/<repo>`, a token file that is missing, unreadable or malformed |
| 5 | `RUNNER_VERSION` or `RUNNER_SHA256` is `FILL_ME`, empty or malformed; the tarball does not match `RUNNER_SHA256` |
| 6 | `geldar-runner` is in `docker`, `sudo` or `wheel` |
| 7 | a step failed (download, unpack, `config.sh`, `systemctl`) |
