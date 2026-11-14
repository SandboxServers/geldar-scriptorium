# Fleet work packets (F-01..F-09)

Ledger and design: [README.md](README.md). Process: `.claude/skills/campaign-packet/SKILL.md`. A coder reads only its own section plus the Dispatch rules and the Contract below. Specs only: nothing here changes a live player before F-08.

**Decision note (inputs).** The README's design rule 2 listed inputs `player_id`, `action` (`add`, `remove`, `restart`) and `kit_version`. The owner's spec supersedes it: inputs are `id`, `repo` and `action` (`add` or `remove`) only. `restart` is a VM-side script the operator runs over ssh, not a dispatch; the kit version comes from `/etc/geldar/fleet.conf`, never an input.

## Waves

| Wave | Cards | Notes |
|---|---|---|
| 1 | F-01, F-02 | independent; both build against the Contract |
| 2 | F-09, F-03, F-04, F-05 | F-09 edits F-02's scripts; all need wave 1 merged |
| 3 | F-06, F-07 | docs and runbook |
| 4 | F-08 | operator run, not a coder; needs the owner and geldar-93 |

Manual infra, recorded, not cards:

- **M-1 UniFi policy.** "Geldar hosts VM to Colo MCP (443)" (VM 192.168.1.10 to the Colo node, TCP 443) already exists (applied 2026-11-14). Backup: `/data/firewall_policy-backup-20261114.json`. Undo: delete the policy document, then re-provision by restarting unifi and zeroing the udm cfgversion. New rules are requested from geldar-93, never edited here.
- **M-2 VM address.** The owner chose a DHCP reservation for the VM (router, done by the owner). No card; nothing in the repo hard-codes the address.
- **M-3 Repo settings (owner).** Turn on "Require approval for all outside collaborators' workflows" in the Actions settings; protect `main` so a change under `.github/workflows/` needs the owner's PR approval (CODEOWNERS entry in F-04). The owner confirms both before F-08.

Decisions needed (placeholders; scriptorium decision numbers start at 80 and are reserved from origin/main when written): D-FL-05 whether `geldar-runner` may be in the docker group (root-equivalent on the VM) or a narrower path is used; D-FL-06 the global cap value; D-FL-07 the pinned git and runner versions with their checksums. The orchestrator fills these before dispatching F-01 and F-05; a coder never guesses them.

## Dispatch rules

1. One coder per card, one worktree, one commit. Branch `fleet/f-NN` from the wave branch `fleet/wave<N>`; worktree `.claude/worktrees/fleet-f-NN`. Every commit ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never push; never touch another card's files.
2. Repo rules to inline: pin exact versions at least two weeks old (tarballs by sha256, Actions by commit SHA); LF endings; no secrets, account names or IPs in code or docs beyond M-1; file soft cap 500 lines, hard 700; each behaviour change has a test that fails when the change is reverted (do it once and say so in the report); never weaken or skip an existing test.
3. Do NOT edit: `launcher/lib/local.*`, `launcher/lib/player.*`, `launcher/lib/new.*`, `launcher/lib/commands.*`, `launcher/geldar-play`, `launcher/geldar-play.ps1`, `launcher/messages.d/73-local.tsv`, `launcher/test/local.test.ts`, `test/hostile/seams.json` (another session owns them). F-03 adds new files only.
4. Scripts are bash 5 on Debian 12 (`#!/usr/bin/env bash`, `set -euo pipefail`), shellcheck-clean. Tests are vitest files under `fleet/test/` (the root config already includes `**/test/**/*.test.ts`) that run the scripts with a fake docker and temp dirs, like `launcher/test/fake-docker.sh`. Without bash locally they skip with a visible reason; CI fails.
5. Checks, in order: `./scriptorium.ps1 pnpm lint`, `./scriptorium.ps1 pnpm typecheck`, `./scriptorium.ps1 pnpm vitest run fleet tools`, `./scriptorium.ps1 check`. Report: `.claude/reports/fleet/F-NN-coder.md`. Return line: `F-NN <done|blocked|failed> <sha|-> <report-path>`.
6. Test seams: a fleet script reads `GEL_ROOT` (empty by default; prefixes every absolute path in the Contract), `GEL_DOCKER` (default `docker`) and `GEL_DF` only when `GELDAR_INTERNAL=1`; otherwise it ignores them. A test proves the ignore case.

## Contract (every card builds against this)

### Names and paths

| Thing | Value |
|---|---|
| Repo folder | `fleet/` (`bin/ lib/ compose/ conf/ bootstrap/ runner/ migrate/ test/`) |
| Installed to | `/usr/local/lib/geldar-fleet/` (copy of `fleet/`); commands linked in `/usr/local/bin/` |
| Commands | `geldar-fleet-place`, `-add`, `-remove`, `-restart`, `-status`, `-dispatch` (sources `fleet/bin/place.sh`, `add.sh`, `remove.sh`, `restart.sh`, `status.sh`, `dispatch.sh`; shared `fleet/lib/common.sh`, `up.sh`, `key.sh`) |
| Data volumes | `/srv/geldar/nvme-d`, `nvme-e`, `nvme-g`, mounted by filesystem label `geldar-nvme-d|e|g` |
| Player state | `/srv/geldar/nvme-<x>/players/player-<id>/` with `workspace cli-home supervisor-state keeper-state clone secrets`; owner `geldar-runner`, 0700, except `secrets/` 0711 |
| Secrets in | `/etc/geldar/tokens/<id>.token`, `/etc/geldar/keys/<id>`: root:geldar-runner 0640, dirs 0750; the operator puts them there by scp |
| Roster | `/etc/geldar/roster/<id>`: one line `<org>/<repo>`, written by the operator with the secrets (root:geldar-runner 0640) |
| Placement | `/etc/geldar/placement/<id>`: lines `volume=nvme-<x>` and `repo=<org>/<repo>`; the directory is owned by `geldar-runner`, 0750 |
| Config | `/etc/geldar/fleet.conf`, `key=value` read as data, never sourced: `kit_image` (digest-pinned), `max_hosts`, `min_free_pct` (10), `mcp_url`, `world_allowlist`; root-owned 0644; unknown keys rejected |
| Allow-list | `fleet/conf/allowed-repos.txt`, installed to `/etc/geldar/allowed-repos.txt`: one `<org>/<name-glob>` per line, `*` allowed only in the name part |
| Log | `/var/log/geldar-hosts.log`: `<UTC ISO8601> <verb> <id> <result> <detail>`; no token, key text or key path |
| Compose | project `geldar-<id>`; base `image/compose/player.yml`; override `fleet/compose/placement.yml` |
| Runner | account `geldar-runner` (no sudo, no login shell), label `geldar-hosts`, dir `/opt/geldar-runner` |
| Workflow | `.github/workflows/deploy-player.yml`, name `deploy-player`, job `deploy`, concurrency group `deploy-player-${{ inputs.id }}` (`cancel-in-progress: false`) |

### Validation

`id` matches `^ag-[a-z0-9-]+$`, at most 40 characters, no `--`, no trailing `-`. `repo` matches `^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$`, matches an allow-list pattern, and equals the roster line for `id` (the roster is the truth; an input that differs is refused). Every script re-validates; the workflow validating first is never trusted. A bad value exits 2 with no filesystem or docker action.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | done, including an idempotent no-op |
| 2 | usage, invalid id or repo |
| 3 | no data volume with enough free space |
| 4 | repo not allow-listed, not in the roster, or different from it; restart of an unknown host |
| 5 | global cap `max_hosts` reached (also: a pinned checksum is still `FILL_ME` or mismatched, in bootstrap and runner scripts) |
| 6 | secret missing or unreadable |
| 7 | docker or compose failure |
| 8 | another operation holds this id's lock (`flock -n` on `/run/geldar-fleet/<id>.lock`) |

### Output

One stdout line of `key=value` pairs separated by single spaces; messages go to stderr.
- `add`: `result=added|exists id=<id> volume=nvme-<x> project=geldar-<id>`
- `remove`: `result=removed|absent id=<id>`; `restart`: `result=restarted id=<id> volume=nvme-<x>`; `place`: `volume=nvme-<x> free_pct=<n>`; `status`: one such line per host, then `running=<n> max=<n>`.
- Token and key contents are never printed. The token reaches docker through the environment (`GELDAR_MCP_TOKEN`) only, never an argument.

### Workflow inputs

`id`, `repo` (both `type: string`, required) and `action` (`type: choice`, options `add`, `remove`). Nothing else. No secret is referenced anywhere; `permissions: {}`. The run summary carries the one-line output and the exit code.

### Idempotence

`add` on an existing placement ensures the group is up and returns `result=exists`. `remove` on a missing host returns `result=absent`, exit 0. Two dispatches for one id queue behind each other (concurrency group), they do not cancel.

## F-01 VM bootstrap script and docs

**Goal.** One re-runnable script takes a clean Debian 12 VM (three labelled data disks) to the state the Contract assumes.

**Files (create).** `fleet/bootstrap/bootstrap.sh`, `fleet/bootstrap/versions.env`, `fleet/bootstrap/README.md`, `fleet/test/bootstrap.test.ts`. Edit nothing else.

**Steps** (root only, exit 2 otherwise; each step checks before it acts):
1. apt: `ca-certificates curl build-essential gettext libcurl4-openssl-dev libssl-dev zlib1g-dev libexpat1-dev util-linux`, then Docker Engine and the Compose plugin from Docker's apt repo at the versions in `versions.env`.
2. **git >= 2.40.** Debian 12 ships 2.39 and the launcher needs 2.40 or newer. `versions.env` holds `GIT_VERSION=2.47.1`, `GIT_SHA256=<64 hex>` and `GIT_URL=<tarball URL>`. Download, `sha256sum -c` before unpacking (mismatch: exit 5, nothing unpacked), then `make prefix=/usr/local all install`. Skip when `/usr/local/bin/git --version` equals the pin. `/etc/profile.d/geldar-git.sh` puts `/usr/local/bin` first for `geldar-runner`; the final `git --version` must be >= 2.40, else exit 6. The orchestrator puts the checksum in `versions.env` (D-FL-07), checked against the kernel.org signed sums; while it is `FILL_ME` the script exits 5 and the test asserts that. The coder never invents it.
3. Volumes: for each label mount `/srv/geldar/nvme-<x>` through one `LABEL=` fstab line each (no duplicates on re-run), create `players/`, chown `geldar-runner`.
4. Account `geldar-runner`: system user, `--shell /usr/sbin/nologin`, home `/opt/geldar-runner`, no sudo. Docker group per D-FL-05 (`RUNNER_DOCKER_GROUP=yes|no` in `versions.env`, default yes, README warns it is root-equivalent).
5. `/etc/geldar/{tokens,keys,placement,roster}` with the Contract modes; `/var/log/geldar-hosts.log` (0660 root:geldar-runner); `/etc/tmpfiles.d/geldar-fleet.conf` creating `/run/geldar-fleet`.
6. Copy `fleet/` to `/usr/local/lib/geldar-fleet/` and link the commands (skipped with a message when `fleet/bin` is absent).
7. Final self-check prints `ok` or each failed check; exit 0 or 1.

**Tests** (`GEL_ROOT` temp tree; fake `apt-get`, `useradd`, `make`, `sha256sum`, `git` in a PATH dir): second run changes nothing (hashes equal, fstab has three lines); bad checksum exits 5 and fake `make` never ran; `FILL_ME` exits 5; git 2.39 triggers the build, 2.47.1 skips it, a final 2.39 exits 6; Contract modes hold (`stat -c %a`); non-root refused. Each fails when its step is deleted.

**Doc.** README: order, how to confirm `git --version`, the docker-group warning, M-2 (DHCP reservation), no addresses.

**Branch/commit.** `fleet/f-01`; `feat(fleet): VM bootstrap with pinned git and data volumes (F-01)`.

## F-02 fleet scripts: place, add, remove, restart, status

**Goal.** The VM-side verbs, idempotent, tested against a fake docker.

**Files (create).** `fleet/bin/{place,add,remove,restart,status}.sh`, `fleet/lib/common.sh`, `fleet/lib/up.sh`, `fleet/compose/placement.yml`, `fleet/conf/allowed-repos.txt`, `fleet/README.md`, `fleet/test/{place,add,remove,restart}.test.ts`, `fleet/test/fake-docker.sh`.

**Behaviour.**
- `common.sh`: `gf_validate_id`, `gf_validate_repo` (bash regex, no eval), `gf_conf KEY`, `gf_log verb id result detail` (strips control characters), `gf_lock id` (`exec 9>` plus `flock -n 9`, else exit 8), `gf_die code msg`.
- `place.sh [id]`: free percent of each volume (`df --output=pcent`, `GEL_DF` under the seam rule); skip volumes below `min_free_pct`; choose the most free bytes; none left exits 3 naming the threshold. An existing placement file wins (D-FL-03).
- `add.sh <id> <repo>`: validate (2); roster file equals `<repo>` and allow-list matches, else 4; lock; if a placement exists jump to `up`; count running `geldar-*` compose projects and refuse at `max_hosts` (5); token and key files readable else 6; place; create the tree with Contract modes; write the placement; `up.sh`. A failure after the tree was created and before `up` succeeded removes what this call created and exits 7 (an earlier placement is never removed on failure).
- `up.sh`: `docker compose -p geldar-<id> -f <repo>/image/compose/player.yml -f fleet/compose/placement.yml up -d` with environment `GELDAR_ID`, `KIT_IMAGE`, `GELDAR_MCP_URL`, `GELDAR_KEEPER_REMOTE` (ssh remote built from the repo), `GELDAR_DEPLOY_KEY_FILE`, `GELDAR_WORLD_ALLOWLIST`, `GELDAR_PLACE_DIR`, and `GELDAR_MCP_TOKEN` read from the token file in-process. F-09 changes how `GELDAR_DEPLOY_KEY_FILE` is set; here it is the `/etc/geldar/keys/<id>` path.
- `placement.yml` redeclares volumes `workspace`, `cli-home`, `supervisor-state`, `keeper-state`, `clone` with `driver: local` and `driver_opts: {type: none, o: bind, device: ${GELDAR_PLACE_DIR}/<subdir>}` so state lives on the chosen drive. A test compares its volume key set with `image/compose/player.yml`'s.
- `remove.sh <id>`: validate; lock; no placement and no group: `absent`. Else `compose -p geldar-<id> down -v`, then delete the state tree with a root helper container from the pinned kit image (`docker run --rm --user 0:0 --network none --cap-drop ALL --cap-add DAC_OVERRIDE --cap-add FOWNER -v <dir>:/d <kit> sh -c 'rm -rf /d/* /d/.[!.]*'`), because the entrypoints chown the bind sources and the runner cannot delete them. Then `rmdir`, and delete placement, token, key and roster files, and log. The GitHub repo is untouched (D-FL-04).
- `restart.sh <id>`: placement must exist (else 4); `up -d --force-recreate`. `status.sh`: placements with running state, then `running=` and `max=`.

**Tests** (fake docker logs argv and models `ps`, `compose`, `run`): invalid ids (`AG-x`, `ag-`, `ag-a b`, `../x`, 41 chars) exit 2 with an empty docker log; repo not allow-listed, and repo different from roster, exit 4; add twice gives `added` then `exists`, one placement file; cap reached exits 5 (`max_hosts=1`, one fake running project); low-space volume skipped, all low exits 3, placement stays after free space changes; failing fake `up` exits 7 and the tree is gone; the token string never appears in the docker log (env only); remove twice gives `removed` then `absent`, and removal uses the helper container; lock held exits 8; the log has no token text; seam variables ignored without `GELDAR_INTERNAL=1`.

**Branch/commit.** `fleet/f-02`; `feat(fleet): place, add, remove, restart and status scripts (F-02)`.

## F-09 native-Linux deploy key readability

**Problem.** `image/compose/player.yml` gives the keeper secret `uid: "1002"`, `gid: "1002"`, `mode: 0400`. Compose applies those only under Swarm; on plain Docker Engine the secret is a bind mount that keeps the host file's owner and mode, so a 0640 `root:geldar-runner` key is unreadable by the keeper (uid 1002, no groups). The interim fix was a manual `chown 1002` on the VM. The proper fix stages a keeper-owned copy per player.

**Fix.** `fleet/lib/key.sh` function `gf_stage_key id place_dir`:
1. Create `<place_dir>/secrets/` (0711, owner runner).
2. One-shot root helper from the pinned kit image: `docker run --rm --user 0:0 --network none --read-only --cap-drop ALL --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE -v /etc/geldar/keys/<id>:/in/key:ro -v <place_dir>/secrets:/out <kit> sh -c 'install -o 1002 -g 1002 -m 0400 /in/key /out/deploy_key'`. The key text is never in an argument.
3. `up.sh` sets `GELDAR_DEPLOY_KEY_FILE=<place_dir>/secrets/deploy_key`. Staging runs on every `add` and `restart`, so a rotated key is picked up.
4. `remove.sh` already deletes the tree; add a check that nothing is left under `secrets/`.
5. Do not edit `image/compose/player.yml`: its `uid/mode` stay right for Swarm and Docker Desktop.

**Files.** create `fleet/lib/key.sh`, `fleet/test/key.test.ts`; edit `fleet/lib/up.sh`, `fleet/bin/add.sh`, `fleet/bin/restart.sh`, `fleet/bin/remove.sh`, `fleet/README.md` (a short "why the key is copied" paragraph).

**Tests** (fake docker): add makes exactly one helper `run` whose argv has `--cap-add CHOWN`, `-o 1002` and `-m 0400`; the compose environment's `GELDAR_DEPLOY_KEY_FILE` ends in `secrets/deploy_key` and does not start with `/etc/geldar/keys`; `secrets/` mode is 0711; the fixture key text is absent from the docker log; restart stages again; a missing key file exits 6 before any helper call. Optional Linux-only case (skips without Docker, runs in CI where available): a real helper run on a busybox image leaves `1002:1002 0400`. Each fails when the stage call is deleted.

**Branch/commit.** `fleet/f-09`; `fix(fleet): stage a keeper-owned deploy key copy on native Linux (F-09)`.

## F-03 launcher verbs host-add and host-remove (operator side)

**Goal.** From the operator's machine, copy a player's secrets to the VM and call the scripts over ssh. This is provisioning (design rule 1), not the workflow.

**Overlap, flagged.** Another session is editing `launcher/lib/player.*`, `commands.*`, `local.*`, `new.*` and both `geldar-play` scripts. Do not touch them. Create `launcher/lib/host.sh`, `launcher/lib/host.ps1` (functions `host_add`, `host_remove` and `Invoke-HostAdd`, `Invoke-HostRemove`) and `launcher/messages.d/74-host.tsv` (ids `host_added`, `host_exists`, `host_removed`, `host_absent`, `host_bad_id`, `host_ssh_failed`, `host_remote_failed`). The hook is one documented stanza: write the exact dispatch lines for both launchers under a new "Fleet verbs (pending hook)" section in `launcher/README.md`; the orchestrator adds them to `geldar-play` and `geldar-play.ps1` after the other session merges. Say this overlap in the report and the PR.

**Behaviour.** `geldar-play host-add <id> --repo <org/repo> --token-file <f> --key-file <f>`: validate the id with the Contract regex; `scp` both files (umask 077) to temp names on the VM at the ssh target in `GELDAR_HOSTS_SSH` (environment only, through `gp_env`); one `ssh` command installs them into `/etc/geldar/{tokens,keys,roster}` with the Contract modes (the operator's own VM account uses sudo; the runner never does) and runs `geldar-fleet-add <id> <repo>`; the temp files are deleted on every exit. `host-remove <id>` is one ssh call to `geldar-fleet-remove`. Token and key are never printed or placed in an argument list. Output is the remote line through `sanitize`; a non-zero remote code maps to `host_remote_failed` naming it.

**Tests.** `launcher/test/host.test.ts` through the shared harness with fake `ssh` and `scp` on PATH (seams `GELDAR_SSH`, `GELDAR_SCP`, gated): a bad id is refused before any ssh call; the fake ssh log never holds the token fixture text; the temp file is removed after a failing ssh; remote exit 4 maps to `host_remote_failed` with 4; both launchers pass. Register the group in a new `launcher/test/host-parity.ts` if `parity.ts` cannot take it without editing a protected file, and say so.

**Branch/commit.** `fleet/f-03`; `feat(launcher): host-add and host-remove verbs (F-03)`.

## F-04 deploy-player workflow

**Goal.** The one trigger path to the VM: `workflow_dispatch`, nothing else.

**Files (create).** `.github/workflows/deploy-player.yml`, `fleet/bin/dispatch.sh`, `fleet/test/dispatch.test.ts`, `tools/repo-checks/src/deploy-workflow.ts` (exports `checkDeployWorkflow(text): string[]`), `tools/repo-checks/src/deploy-player-workflow.test.ts`, and a `.github/CODEOWNERS` line `/.github/workflows/ @OWNER_LOGIN` (create the file if absent; the orchestrator substitutes the real login; the test checks only the shape `^/\.github/workflows/ @\S+$`).

**Workflow shape.**
```yaml
name: deploy-player
on:
  workflow_dispatch:
    inputs:
      id: {description: Player id, required: true, type: string}
      repo: {description: Player repository org/name, required: true, type: string}
      action: {description: add or remove, required: true, type: choice, options: [add, remove]}
permissions: {}
concurrency:
  group: deploy-player-${{ inputs.id }}
  cancel-in-progress: false
jobs:
  deploy:
    runs-on: [self-hosted, geldar-hosts]
    timeout-minutes: 20
    steps:
      - name: Run
        env:
          INPUT_ID: ${{ inputs.id }}
          INPUT_REPO: ${{ inputs.repo }}
          INPUT_ACTION: ${{ inputs.action }}
        run: /usr/local/bin/geldar-fleet-dispatch
```
Inputs reach the script through `env`, never interpolated into `run:`. No checkout, no third-party action, no secret. `dispatch.sh` validates id and action (2), looks the repo up in `/etc/geldar/roster/<id>` and refuses a differing `INPUT_REPO` (4; `remove` with no roster entry uses the placement file's `repo=` line), then calls `geldar-fleet-add` or `-remove` and writes the one-line result to `$GITHUB_STEP_SUMMARY`. The cap and idempotence live in the F-02 scripts. The token is read from its root-owned file by F-02 at run time and appears in no input, env, log or summary.

**Repo test.** Parses the file with `yaml` (as `publish-template-workflow.test.ts` does) and asserts: `Object.keys(wf.on)` equals `['workflow_dispatch']` (fails on `pull_request`, `pull_request_target`, `push`, `schedule`, `workflow_call` or `repository_dispatch`); input keys equal `['id','repo','action']` and the `action` options equal `['add','remove']`; no input name matches `/token|secret|key|password|credential/i`; the text has no `secrets.` and no `github.token`; `permissions` equals `{}`; `runs-on` equals `['self-hosted','geldar-hosts']`; the concurrency group contains `inputs.id`; no `run:` string contains `${{`; every `uses:` is a 40-hex SHA; CODEOWNERS covers `.github/workflows/`. Negative cases: mutated copies of the text (an added `pull_request` trigger, an added `token` input, a `secrets.X` line, an interpolated `run:`) must each make `checkDeployWorkflow` return a finding. `dispatch.test.ts`: roster mismatch exits 4; bad id exits 2; `remove` works from the placement file; the summary line is written; no token in output.

**Branch/commit.** `fleet/f-04`; `feat(fleet): deploy-player workflow, dispatch only, with repo guard (F-04)`.

## F-05 runner install and hardening

**Goal.** A script and doc that install the self-hosted runner under `geldar-runner` and prove the account is confined.

**Files (create).** `fleet/runner/install-runner.sh`, `fleet/runner/verify-confinement.sh`, `fleet/runner/versions.env`, `fleet/runner/README.md`, `fleet/test/runner.test.ts`.

**Behaviour.** `install-runner.sh --url <repo-url> --token-file <f>` (root): the file holds the one-time registration token the owner generates, read in-process, never in an argument or a log line. Download the pinned runner tarball (`RUNNER_VERSION`, `RUNNER_SHA256` from `versions.env`, D-FL-07; `FILL_ME` or a mismatch exits 5 before unpacking) into `/opt/geldar-runner` owned by `geldar-runner`; register against the single repo that holds the workflow (repo-level, not org-level) with the label `geldar-hosts` only; install a systemd unit that runs as `geldar-runner` with `NoNewPrivileges=yes`, `ProtectHome=yes`, `PrivateTmp=yes`, `ProtectSystem=strict` and `ReadWritePaths=/srv/geldar /etc/geldar/placement /var/log/geldar-hosts.log /run/geldar-fleet /opt/geldar-runner`. Refuse when `geldar-runner` is in `sudo` or `wheel`.

`verify-confinement.sh` (root; probes through `runuser -u geldar-runner`): cannot list other users' homes, cannot read `/etc/shadow`, `sudo -n true` fails, token and key files readable by name, `/etc/geldar/keys` not writable, `/var/log/geldar-hosts.log` appendable. One line `ok <probe>` or `FAIL <probe>` each; exit 1 on any FAIL.

**README policy text** (verbatim list): dispatch only; a separate unprivileged account; tokens read from a root-owned file at run time, never in inputs or logs; a workflow change needs the owner's PR approval (CODEOWNERS, F-04); the fork-approval repo setting is required (M-3); the runner has no route to the owner's desktop (a router rule the owner checks, not a script).

**Tests** (fake `useradd`, `systemctl`, `curl`, `sha256sum`): bad or `FILL_ME` checksum exits 5 and nothing is unpacked; the unit text has the five hardening settings; the label is exactly `geldar-hosts`; the registration token is absent from every fake command's argv; `sudo` membership is refused; the probe names match a snapshot, and a fake `runuser` that lets `/etc/shadow` be read makes the verify script print FAIL and exit 1.

**Branch/commit.** `fleet/f-05`; `feat(fleet): runner install and confinement check (F-05)`.

## F-06 registration contract doc

**Goal.** The interface geldar-registration builds against. Docs and one test.

**Files (create).** `docs/fleet-dispatch-contract.md` (at most 200 lines), `tools/repo-checks/src/fleet-docs.test.ts`. A decision record is added only if the orchestrator reserved a number; otherwise the doc says `D-FL-NN`.

**Content.**
- Who calls. Roster add and delete are operator verbs (the geldar repo's `tools/admin` and `deploy/colo-admin.sh`); after the roster change succeeds, that operator tool dispatches. The register web service must NOT hold a GitHub token. A service that needs a deploy asks the operator path to do it.
- The call: `POST /repos/<org>/<this-repo>/actions/workflows/deploy-player.yml/dispatches`, body `{"ref":"main","inputs":{"id":"<id>","repo":"<org>/<name>","action":"add"}}`, expected `204`. Credential: a fine-grained token with Actions write on this repo only, held by the operator tool and nowhere else. No other input; none is a secret.
- Sequence on add: provision (repo, deploy key, world token), `host-add` copies secrets and the roster entry (F-03), then dispatch `add`. On delete: dispatch `remove`, then delete the roster entry on the operator side.
- Failure table: dispatch 404, 403, 422 and what each means; each Contract exit code 2 to 8 with the operator's action; a repeat dispatch is safe; two dispatches for one id queue; the cap (5) is a refusal, not a retry loop.
- Where results are: the run summary line and `/var/log/geldar-hosts.log`.
- Bodies stay on the Colo node; the VM reaches the MCP server by its public name over TCP 443 (M-1); new firewall rules go to geldar-93.

**Test.** The doc's example JSON parses; its input keys equal the workflow's (read from F-04's file); every exit code 2 to 8 appears in the table; no `ghp_`, `github_pat_` or dotted-quad pattern appears. Renaming a workflow input makes it fail.

**Branch/commit.** `fleet/f-06`; `docs: fleet dispatch contract for registration (F-06)`.

## F-07 migration runbook and script

**Goal.** Move one running player from the owner's desktop to the VM with a recorded gap and a rollback until the last step.

**Files (create).** `fleet/migrate/migrate-player.ps1` (desktop), `fleet/migrate/import-player.sh` (VM), `fleet/migrate/RUNBOOK.md`, `fleet/test/migrate.test.ts`.

**Behaviour.** `migrate-player.ps1 -Id <id> [-DryRun] [-Rollback] [-Finish]`, one id per run (a list is refused): record the start time; `docker compose -p geldar-<id> stop` (stop, so rollback is `start`); tar each state volume (`workspace`, `cli-home`, `supervisor-state`, `keeper-state`, `clone`) through a throw-away container with a `.sha256` file; `scp` to the VM; `import-player.sh <id>` verifies checksums, takes the volume from `geldar-fleet-place`, unpacks into the player tree through the root helper (ownership kept), then runs `geldar-fleet-add`; wait up to 5 minutes for healthy in `geldar-fleet-status` and a fresh keeper `status.json`; print `recreate_seconds=<n>` (stop to healthy). The desktop group stays stopped, never removed, until `-Finish` (`down`, volumes kept one more day). `-Rollback` runs `compose start` on the desktop and `geldar-fleet-remove` on the VM. Secrets are sent beforehand by `host-add` (F-03); this script never reads them.

**Tests** (fake docker, ssh, scp): `-DryRun` prints the step list and calls no docker; two ids and an invalid id are refused; call order is stop, tar, scp, import, add, wait; a checksum mismatch stops before `add` and leaves the desktop group stopped and restartable; `-Rollback` issues the documented commands; no token text in any fake log. Each fails when its guard is removed.

**RUNBOOK.md.** Pre-flight (F-05 verify green, M-1 present, roster entry present, window agreed), per-player steps, reading `recreate_seconds`, rollback, stop conditions.

**Branch/commit.** `fleet/f-07`; `feat(fleet): migration runbook and script (F-07)`.

## F-08 migration run (operator, not a coder)

The orchestrator runs this with the owner and geldar-93.
1. Pre-flight per the runbook; the owner confirms M-3; geldar-93 confirms the window.
2. Migrate the 6 rangers from the owner's desktop one at a time. After each, geldar-93 confirms the recreate (reconnected to the world, keeper pushing, no held session) before the next. A failure is rolled back and the run stops.
3. Picard last. His Body stays on the Colo node; only the group moves, and only after the owner says "ready".
4. The seven new players are made by `host-add` and the dispatched `add`, never on the desktop (D-FL-01).
5. Record per player: start time, `recreate_seconds`, volume. Write `docs/analysis/fleet/worknotes/migration.md`, update RESUME, close the ledger rows. Desktop groups are removed a day later with the owner's go.

Stop conditions: an unexplained world disconnect for 10 minutes, any keeper key error, any `FAIL` from the confinement check.
