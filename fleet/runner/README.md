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

Whether `sudo` works under `ProtectSystem=strict` and `PrivateTmp` (timestamp and log writes) is
verified on the real unit in F-08 step 1. If it fails, the orchestrator adjusts `ReadWritePaths` and
the snapshot together.

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

## Confinement

The runner reaches the fleet only through the root wrapper `geldar-fleet-run`, installed as
`/usr/local/sbin/geldar-fleet-run` (root:root 0755) and allowed by one sudo rule in
`/etc/sudoers.d/geldar-fleet` (root:root 0440, `geldar-runner ALL=(root) NOPASSWD:` the wrapper).
Run as root on the VM, after `install-runner.sh`:

```
install-wrapper.sh
verify-confinement.sh
```

`install-wrapper.sh` checks the sudoers rule with `visudo -cf` before it lands. `verify-confinement.sh`
runs the probes as `geldar-runner` through `runuser` and prints `ok <probe>` or `FAIL <probe>`; it
exits 1 on any FAIL. The probes cover the reads that must be refused, the sudo list (exactly the
wrapper), the groups, `docker ps`, the wrapper's refusals of bad ids, verbs and flags, a positive
control (`check-secrets ag-probe-00` exits 0 or 6, never 2, so a wrapper that refuses everything
cannot pass), and the unit's `NoNewPrivileges=no`. F-08 step 1 runs it once on the VM.

The wrapper validates every id, verb and flag before it runs anything; a refused input exits 2 with
nothing started. It starts the launcher verb as `geldar` with a fixed environment (`HOME`, `PATH`,
`DOCKER_HOST` and the state directory only); the caller's environment is never passed on.

Policy:

- dispatch only; a separate unprivileged account with one sudo rule;
- the runner never reads tokens, keys or the login and never touches docker;
- tokens are read from root-owned files by `geldar` at run time, never in inputs or logs;
- a workflow change needs the owner's PR approval;
- fork approval and the `fleet` environment's `main` restriction are required (M-3);
- write access to this repo can still run a branch workflow on the runner (D-FL-08), reaching only
  the wrapper's verbs, so the collaborator list is reviewed by the owner;
- the runner has no route to the owner's desktop.
