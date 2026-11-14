# Fleet work packets (F-01a..F-11)

Ledger and design: [README.md](README.md). Process: `.claude/skills/campaign-packet/SKILL.md`. A coder reads only its own section plus the Dispatch rules and the Contract below. Specs only: nothing here changes a live player before F-08.

**Decision note (inputs).** This supersedes the original brief: dispatch inputs are `id`, `repo` and `action` (`add` or `remove`) only. `restart` is a VM-side script the operator runs over ssh, not a dispatch; the kit version comes from `/etc/geldar/fleet.conf`, never an input.

**Launcher rule (scriptorium-orchestrator ruling).** Fleet scripts never call `docker compose` and never re-implement workspace seeding. The VM runs the launcher's own persistent-player code from a clone at `~/scriptorium` pinned to a commit (git 2.47.1 or newer). Stable verbs: `geldar-play new --repo <owner/name> --public --persona-dir <dir> --token-file <file>`, `deploy-key`, `start`, `restart`, `upgrade`, `player-status`. The compose project name is whatever the launcher defines, read from it (currently `geldar-player-<id>`); the session project `geldar-<id>` is a different thing and is never counted or stopped. A verb that is missing (for example a non-interactive remove) becomes a "launcher verb request" (F-11) addressed to scriptorium-orchestrator. Launcher files changed by HC-08b are never edited here.

## Waves

| Wave | Cards | Notes |
|---|---|---|
| 1 | F-01a, F-01b, F-02a, F-11 | independent; build against the Contract; F-11 is an orchestrator request, not a coder card |
| 2 | F-02b, F-02c, F-03, F-04, F-05, F-10 | need wave 1 merged; F-02c also needs F-11 answered |
| 3 | F-06, F-07a, F-07b | docs, scripts and runbook |
| 4 | F-08 | operator run, not a coder; needs the owner and geldar-93 |

Merging is by hand (the `scriptorium.ps1 merge-packet`, `ledger set` and `check:specs` tools only know `scriptorium/wave<N>` and `SC-NN`): wave branch `fleet/wave<N>`, the orchestrator updates the README rows manually.

Manual infra, recorded, not cards:

- **M-1 UniFi policy.** "Geldar hosts VM to Colo MCP (443)" (the VM to the Colo node, TCP 443) exists (applied 2026-11-14). The owner holds the backup. Undo: delete the policy document, then re-provision by restarting unifi and zeroing the udm cfgversion. New rules are requested from geldar-93, never edited here.
- **M-2 VM address.** DHCP reservation for the VM, done by the owner. Nothing in the repo hard-codes an address.
- **M-3 Repo settings (owner).** (1) GitHub environment `fleet`, deployment branches restricted to `main`; (2) "Require approval for all outside collaborators' workflows" on; (3) protect `main` so a change under `.github/workflows/` needs the owner's PR approval (CODEOWNERS, F-04); (4) review the runner's repository collaborator list. **Accepted risk D-FL-08:** anyone with write access to this repo can push a branch whose workflow has `runs-on: [self-hosted, geldar-hosts]` and omits `environment: fleet`; that job runs on the runner and so reaches everything the runner account can. The environment does not stop it; only the collaborator list does. The owner confirms all four before F-08.

Decisions: D-FL-05 settled: the runner reaches docker through a socket proxy limited to compose projects named `geldar-player-*`, no docker group membership (alternative, TBC by scriptorium-orchestrator: a rootless no-sudo user that runs the launcher for us). D-FL-06 global cap value: open. D-FL-07 pinned git, runner and proxy versions with checksums: open. D-FL-08 accepted risk above. D-FL-09 secret deletion: `remove.sh` leaves tokens, keys and roster; the operator's `host-remove` deletes them. D-FL-10 runner self-update versus pinned tarball: TBC by scriptorium-orchestrator. The orchestrator fills open ones before dispatching F-01a and F-05; a coder never guesses them. Decision numbers are reserved from origin/main when written.

## Dispatch rules

1. One coder per card, one worktree, one commit. Branch `fleet/f-NN[x]` from `fleet/wave<N>`; worktree `.claude/worktrees/fleet-f-NN`. Every commit ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never push; never touch another card's files.
2. Repo rules to inline: pin exact versions at least two weeks old (tarballs by sha256, Actions by commit SHA); LF endings; no secrets, account names or IP addresses in code or docs (the repo is public; say "the VM", "the Colo node"); file soft cap 500 lines, hard 700; each behaviour change has a test that fails when the change is reverted (do it once and say so in the report); never weaken or skip an existing test.
3. Do NOT edit: `launcher/lib/local.*`, `launcher/lib/player.*`, `launcher/lib/new.*`, `launcher/lib/commands.*`, `launcher/geldar-play`, `launcher/geldar-play.ps1`, `launcher/messages.d/73-local.tsv`, `launcher/test/local.test.ts`, `launcher/test/hostile/seams.json`, nor any file HC-08b changes. F-03 adds new files only and adds no `GELDAR_*` names.
4. Scripts are bash 5 on Debian 12 (`#!/usr/bin/env bash`, `set -euo pipefail`). Executable bit: `git update-index --chmod=+x <file>` (or tests invoke `bash <file>`). Tests are vitest files under `fleet/test/` run with a fake `geldar-play` and temp dirs, like `launcher/test/fake-docker.sh`. Needs-bash and needs-`flock` tests skip with a visible reason locally; when `CI` is set they fail, using the `ciRequiresShells` pattern at `launcher/test/core.test.ts:55` copied as is. A vitest case `fleet/test/lint.test.ts` (owned by F-02a) runs `shellcheck` over `fleet/**/*.sh` and greps that no fleet script contains `set -x` or `bash -x`; it fails when `CI` is set and shellcheck is missing.
5. Checks, in order: `./scriptorium.ps1 pnpm lint`, `./scriptorium.ps1 pnpm lint:md` (docs), `./scriptorium.ps1 pnpm typecheck`, `./scriptorium.ps1 pnpm vitest run fleet tools/repo-checks`, `./scriptorium.ps1 check`. A packet that runs real docker sets `KIT_IMAGE=geldar-kit:<packet>` for isolation. Report: `.claude/reports/fleet/F-NN-coder.md`. Return line: `F-NN <done|blocked|failed> <sha|-> <report-path>`.
6. Test seams: a fleet script reads `GEL_ROOT` (empty by default; prefixes every absolute path in the Contract), `GEL_PLAY` (the launcher command, default `geldar-play`), `GEL_DF` and `GEL_CHOWN` only when `GELDAR_INTERNAL=1`; otherwise it ignores them. The test proves the ignore case with a fixture where the seam would change the result (a fake launcher that would log, a root prefix that would move a file). Modes and ownership assertions run only on Linux and skip with the reason on win32 (no real root: `GEL_CHOWN` records the call). The names are listed in `fleet/README.md`. None is a launcher name.

## Contract (every card builds against this)

### Names and paths

| Thing | Value |
|---|---|
| Repo folder | `fleet/` (`bin/ lib/ conf/ bootstrap/ runner/ migrate/ test/`) |
| Installed to | `/usr/local/lib/geldar-fleet/` (copy of `fleet/`, same commit as the launcher clone); commands linked in `/usr/local/bin/` |
| Launcher clone | `~/scriptorium` of the operating account, pinned to a commit in `fleet/bootstrap/versions.env` (`LAUNCHER_COMMIT`, TBC by scriptorium-orchestrator) |
| Commands | `geldar-fleet-place`, `-add`, `-remove`, `-restart`, `-status`, `-dispatch` (sources `fleet/bin/{place,add,remove,restart,status,dispatch}.sh`; shared `fleet/lib/common.sh`, `up.sh`) |
| Data volumes | `/srv/geldar/nvme-d`, `nvme-e`, `nvme-g`, mounted by filesystem label `geldar-nvme-d|e|g` |
| Player state | `/srv/geldar/nvme-<x>/players/player-<id>/`, owner `geldar-runner`, 0700; how it is bound into the launcher's volumes is request R-2 (F-11) |
| Secrets in | `/etc/geldar/tokens/<id>.token`, `/etc/geldar/keys/<id>`: `root:geldar-runner` 0640, dirs 0750; the operator puts them there by scp; the shared Claude login is not one of them (F-10) |
| Roster | `/etc/geldar/roster/<id>`: one line `<org>/<repo>`, read with `read -r`; any extra line or CR is refused (exit 2) |
| Placement | `/etc/geldar/placement/<id>`: lines `volume=nvme-<x>` and `repo=<org>/<repo>`; directory owned by `geldar-runner`, 0750 |
| Config | `/etc/geldar/fleet.conf`, `key=value` read as data, never sourced: `kit_image` (digest-pinned), `max_hosts` (missing or non-numeric: exit 5, no default), `min_free_pct` (10), `mcp_url`; root-owned 0644; unknown keys rejected. Template `fleet/conf/fleet.conf.example` |
| Allow-list | `fleet/conf/allowed-repos.txt` to `/etc/geldar/allowed-repos.txt`: one `<org>/<name-glob>` per line, `*` only in the name part. Content: one line `<org>/ag-*`, the org taken by the coder from `git remote get-url origin` of the player template owner, TBC by scriptorium-orchestrator |
| Log | `/var/log/geldar-hosts.log` (0660 `root:geldar-runner`): `<UTC ISO8601> <verb> <id> <result> <detail>`; no token, key text or key path |
| Locks | `/run/geldar-fleet` (tmpfiles `d /run/geldar-fleet 0770 root geldar-runner -`); per id `<id>.lock`, global `_global.lock`; umask 007 |
| Runner | account `geldar-runner` (no sudo, no login shell, not in the docker group), custom label `geldar-hosts` (default labels kept), dir `/opt/geldar-runner` |
| Workflow | `.github/workflows/deploy-player.yml`, name `deploy-player`, job `deploy`, `environment: fleet`, concurrency group `deploy-player-${{ inputs.id }}` (`cancel-in-progress: false`) |
| Operator path | the ssh account `geldar` (sudo) runs every verb as `sudo -u geldar-runner geldar-fleet-<verb> ...` |

### Validation

`id` matches `^ag-[a-z0-9-]+$` (ids are `ag-<name>-NN`: ag-kimberly-01, ag-picard-01, ag-riker-01, ag-data-01, ag-troi-01, ag-laforge-01, ag-worf-01, ag-bcrusher-01, ag-wcrusher-01, ag-jason-01), 4 to 39 characters (the launcher's `valid_player_id` allows 39 and reserves `auth`, `run`, `players`), no `--`, no trailing `-`. `repo` matches `^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$`, an allow-list pattern, and the roster line for `id` (the roster is the truth); an existing placement `repo=` that differs from the roster exits 4. Every script re-validates; the workflow validating first is never trusted. A bad value exits 2 with no filesystem or launcher action.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | done, including an idempotent no-op |
| 2 | usage, invalid id, repo, roster text or dispatch input |
| 3 | no data volume with enough free space |
| 4 | repo not allow-listed, not in the roster, or different from the roster or placement; restart of an unknown host; dispatch from a ref other than `refs/heads/main` |
| 5 | cap `max_hosts` reached for a new placement; `max_hosts` missing or invalid; a pinned checksum is `FILL_ME` or mismatched |
| 6 | secret missing, empty or unreadable |
| 7 | launcher verb failure |
| 8 | another operation holds this id's lock (`flock -n`) |

### Output

One stdout line of `key=value` pairs separated by single spaces; messages go to stderr.
- `add`: `result=added|exists id=<id> volume=nvme-<x> project=<launcher project name>`
- `remove`: `result=removed|absent id=<id> secrets=left`; `restart`: `result=restarted id=<id> volume=nvme-<x>`; `place`: `volume=nvme-<x> free_pct=<n>`; `status`: one such line per host, then `running=<n> max=<n>`.
- Token and key contents are never printed. The token reaches the launcher through `--token-file` only, never an argument holding its text, never in a log or summary.

### Workflow inputs

`id`, `repo` (both `type: string`, required) and `action` (`type: choice`, options `add`, `remove`). Nothing else. No secret is referenced; `permissions: {}`. The run summary carries the one-line output and the exit code.

### Idempotence and concurrency

`add` on an existing placement ensures the group is up and returns `result=exists`. `remove` on a missing host returns `result=absent`, exit 0. GitHub keeps one running and one pending run per concurrency group, so a third dispatch for one id cancels the pending one even with `cancel-in-progress: false`; because add and remove are state-based this is acceptable. `flock -n` exit 8 is the second guard. No text in the repo says dispatches "queue".

## F-01a VM bootstrap: packages and pinned git

**Goal.** A re-runnable script installs what the launcher clone needs on a Debian 12 VM.

**Files (create).** `fleet/bootstrap/bootstrap-git.sh`, `fleet/bootstrap/versions.env`, `fleet/test/bootstrap-git.test.ts`. Edit nothing else.

**Steps** (root only, exit 2 otherwise; each step checks before it acts):
1. apt: `ca-certificates curl build-essential gettext libcurl4-openssl-dev libssl-dev zlib1g-dev libexpat1-dev util-linux shellcheck`. Docker is already on the VM and is not installed here.
2. **git >= 2.47.1** (the launcher clone needs it; Debian 12 ships 2.39). `versions.env` holds `GIT_VERSION=2.47.1`, `GIT_SHA256`, `GIT_URL`. Download, `sha256sum -c` before unpacking (mismatch: exit 5, nothing unpacked), `make prefix=/usr/local all install`. Skip when `/usr/local/bin/git --version` equals the pin. `/etc/profile.d` is not used; the final check runs `runuser -u geldar-runner -- git --version` (>= 2.47.1, else exit 6; PATH comes from the systemd unit). The checksum is filled by the orchestrator (D-FL-07, checked against the kernel.org signed sums). While `FILL_ME` the script exits 5, and the test asserts that, so this card ships a script that cannot succeed until the orchestrator edits `versions.env` (say so in the report line). The coder never invents it.

**Tests** (fake `apt-get`, `make`, `sha256sum`, `git` on a PATH dir, `GEL_ROOT` temp tree): second run changes nothing; bad checksum exits 5 and fake `make` never ran; `FILL_ME` exits 5; git 2.39 triggers the build, 2.47.1 skips it, a final 2.39 exits 6; non-root refused. Each fails when its step is deleted.

**Branch/commit.** `fleet/f-01a`; `feat(fleet): bootstrap packages and pinned git (F-01a)`.

## F-01b VM bootstrap: volumes, account, directories, install

**Goal.** The rest of the Contract's host state. Depends on F-01a for `versions.env`.

**Files (create).** `fleet/bootstrap/bootstrap.sh` (calls `bootstrap-git.sh` first), `fleet/conf/fleet.conf.example`, `fleet/bootstrap/README.md`, `fleet/test/bootstrap.test.ts`.

**Steps.** (1) For each label mount `/srv/geldar/nvme-<x>` through one `LABEL=` fstab line (no duplicates on re-run), create `players/`, chown `geldar-runner`. (2) Account `geldar-runner`: system user, `--shell /usr/sbin/nologin`, home `/opt/geldar-runner`, no sudo, never in the docker group (docker is reached through the F-05 proxy). (3) `/etc/geldar/{tokens,keys,placement,roster}` with the Contract modes; install `fleet/conf/allowed-repos.txt` to `/etc/geldar/allowed-repos.txt`; write `/etc/geldar/fleet.conf` from the example only when absent (0644); `/var/log/geldar-hosts.log` 0660 `root:geldar-runner`; `/etc/tmpfiles.d/geldar-fleet.conf` with the Contract line. (4) Copy `fleet/` to `/usr/local/lib/geldar-fleet/`, link the commands, and clone the launcher to the pinned `LAUNCHER_COMMIT` (skipped with a message when `fleet/bin` is absent). (5) Self-check prints `ok` or each failed check; exit 0 or 1.

**Tests** (`GEL_ROOT` temp tree, fakes for `useradd`, `mount`, `git`): second run changes nothing (hashes equal, fstab has three lines); an existing `fleet.conf` is kept; Contract modes hold (Linux only, `stat -c %a`; skipped on win32 with the reason); no docker-group line; non-root refused. Each fails when its step is deleted.

**Doc.** README: order, how to confirm `git --version`, M-2, no addresses.

**Branch/commit.** `fleet/f-01b`; `feat(fleet): bootstrap volumes, account and directories (F-01b)`.

## F-02a fleet scripts: common library and place

**Goal.** Shared helpers and volume choice, tested.

**Files (create).** `fleet/lib/common.sh`, `fleet/bin/place.sh`, `fleet/conf/allowed-repos.txt`, `fleet/README.md`, `fleet/test/{place,lint}.test.ts`, `fleet/test/fake-play.sh` (a fake `geldar-play` that logs argv and the names, not values, of env variables, and models `new`, `deploy-key`, `start`, `restart`, `player-status`).

**Behaviour.**
- `common.sh`: `gf_validate_id`, `gf_validate_repo` (bash regex, no eval), `gf_read_roster id` (`read -r`, one line, rejects CR and extras), `gf_conf KEY`, `gf_log verb id result detail` (strips control characters), `gf_lock id` (`exec 9>` plus `flock -n 9`, else exit 8), `gf_lock_global`, `gf_die code msg`, `gf_remove_tree id` (stub, completed in F-02c).
- `place.sh <id> [--reserve]`: free percent of each volume (`df --output=pcent`, `GEL_DF`); skip volumes below `min_free_pct`; choose the most free bytes; none left exits 3 naming the threshold. An existing placement file wins (D-FL-03). `--reserve` writes the placement file (`volume=`, `repo=` from the roster) so a later `add` reuses it (used by F-07a).

**Tests.** Invalid ids (`AG-x`, `ag-`, `ag-a b`, `../x`, 40 characters) exit 2 with an empty launcher log; low-space volume skipped, all low exits 3, placement stays after free space changes; roster with CR or two lines exits 2; seam variables ignored without `GELDAR_INTERNAL=1` (fixture per Dispatch rule 6); lint test per rule 4. Each fails when its change is reverted.

**Branch/commit.** `fleet/f-02a`; `feat(fleet): common library and place (F-02a)`.

## F-02b fleet scripts: add, up, restart, status

**Goal.** The idempotent VM verbs, implemented as calls to launcher verbs. Depends on F-02a.

**Files (create).** `fleet/bin/{add,restart,status}.sh`, `fleet/lib/up.sh`, `fleet/test/{add,restart,status}.test.ts`; edit `fleet/README.md`.

**Behaviour.**
- `add.sh <id> <repo>`: validate (2); roster equals `<repo>`, allow-list matches, an existing placement `repo=` equals the roster, else 4; per-id lock; if a placement exists, jump to `up.sh` and skip the cap. For a new placement: take `_global.lock` across count, place and the placement write; count placement files (not running groups, so stopped hosts count); at `max_hosts` exit 5; token and key files readable and non-empty else 6; place; create the tree; write the placement; `up.sh`.
- `up.sh`: with the launcher clone as the working directory, calls `geldar-play new --repo <repo> --public --persona-dir <dir> --token-file /etc/geldar/tokens/<id>.token` on first creation (workspace seeding, allowlist and compose are the launcher's), then `deploy-key` with the key at `/etc/geldar/keys/<id>`, then `start`. Whether `deploy-key` also solves the keeper-uid readability problem (compose secret uid/mode ignored outside Swarm; a 0640 `root:geldar-runner` key is unreadable by uid 1002) is TBC by scriptorium-orchestrator; if it does not, a staging step belongs in F-11. The token is passed as a file only; the fake launcher also logs the env variable names it received.
- Failure after the tree was created and before `up` succeeded calls `gf_remove_tree` (same helper as `remove`, F-02c); an earlier placement is never removed on failure. Exit 7.
- `restart.sh <id>`: placement must exist (else 4); `geldar-play restart`. `status.sh`: placements with `player-status` result, then `running=` and `max=`.

**Tests** (fake launcher): repo not allow-listed, roster missing, roster differing from placement exit 4; add twice gives `added` then `exists`, one placement file; two concurrent adds with `max_hosts=1` give one success and one exit 5; missing or non-numeric `max_hosts` exits 5; an over-cap stopped host with a placement still starts; empty token file exits 6; failing fake `start` exits 7 and the failure path calls the removal helper; lock held exits 8. Positive control: the fake launcher saw `--token-file` and no argv or log or summary contains the token fixture text. Each fails when reverted.

**Branch/commit.** `fleet/f-02b`; `feat(fleet): add, up, restart and status via launcher verbs (F-02b)`.

## F-02c fleet scripts: remove

**Goal.** Remove a host without deleting secrets. Depends on F-02a, F-02b and the F-11 answer for a non-interactive remove (R-1). If R-1 is refused the card is blocked; no compose call is allowed instead.

**Files (create).** `fleet/bin/remove.sh`, `fleet/test/remove.test.ts`; edit `fleet/lib/common.sh` (`gf_remove_tree`).

**Behaviour.** `remove.sh <id>`: validate; lock; no placement and no group: `absent`. Else the launcher's non-interactive remove (R-1) stops the group and deletes the state tree (the runner cannot delete bind sources the entrypoints chowned; the launcher's remove, or its helper, does it; shared with the failure path of `add`). Then delete the placement file and log. Tokens, keys and the roster are left (the runner cannot write those directories under `ProtectSystem=strict`), and the line prints `secrets=left`. The operator's `host-remove` (F-03) deletes them after the dispatch. The GitHub repo is untouched (D-FL-04).

**Tests.** `remove` twice gives `removed` then `absent`; the secret files are still present; the line has `secrets=left`; the tree is gone with a fake removal that fails on a chowned fixture unless the helper `run` appears; with a variable-checking fake, `remove` works with the same env block as `add`. Each fails when reverted.

**Branch/commit.** `fleet/f-02c`; `feat(fleet): remove leaves secrets, removes state (F-02c)`.

## F-03 launcher verbs host-add and host-remove (operator side)

**Goal.** From the operator's machine, copy a player's secrets to the VM and call the scripts over ssh. This is provisioning (design rule 1), not the workflow.

**Overlap, flagged.** Another session edits `launcher/lib/player.*`, `commands.*`, `local.*`, `new.*` and both `geldar-play` scripts. Do not touch them. Create `launcher/lib/host.sh`, `launcher/lib/host.ps1` (`host_add`, `host_remove`, `Invoke-HostAdd`, `Invoke-HostRemove`) and `launcher/messages.d/74-host.tsv` (ids `host_added`, `host_exists`, `host_removed`, `host_absent`, `host_bad_id`, `host_ssh_failed`, `host_remote_failed`; the card lists the English text; exit code 4 is named in `host_remote_failed` and the F-06 table agrees). The hook is one documented stanza in `launcher/README.md` under "Fleet verbs (pending hook)"; the orchestrator adds the dispatch lines after the other session merges. Do not add a new `GP_GROUPS` entry: only define the functions. If the orchestrator later adds group `host`, `parity.ts` must list it for both launchers (twin-drift) and that edit is merge-ordered after the other session's `local` group.

**Behaviour.** `geldar-play host-add <id> --repo <org/repo> --token-file <f> --key-file <f> --ssh <user@host>`: the ssh target comes from `--ssh` or a file `hosts-ssh` in the launcher state dir (TBC by scriptorium-orchestrator for the dir helper); no new `GELDAR_*` names, `ssh` and `scp` found through PATH, options `-o BatchMode=yes -o StrictHostKeyChecking=yes` (known_hosts is the operator's own). Steps: validate the id; `scp` the two files (umask 077) to `/tmp/geldar-host-<id>.token` and `.key` on the VM; one `ssh` command `sudo install -o root -g geldar-runner -m 0640 ...` into `/etc/geldar/{tokens,keys}`, writes the roster line, then `sudo -u geldar-runner geldar-fleet-add <id> <repo>`; the temp files are deleted on every exit (remote `rm -f` in a trap). `host-remove <id> --ssh <t>`: dispatch-then-cleanup: after the dispatched `remove` returned `absent` or `removed` (checked with `sudo -u geldar-runner geldar-fleet-status`), one ssh call deletes `/etc/geldar/{tokens,keys,roster}/<id>*`; without a finished remove it refuses. A `--run` flag runs `geldar-fleet-remove` itself first. Token and key are never printed or in an argument list. Output is the remote line through `sanitize`; a non-zero remote code maps to `host_remote_failed` naming it.

**Tests.** `launcher/test/host.test.ts` through the shared harness with fake `ssh` and `scp` first on PATH: a bad id is refused before any ssh; the fake ssh log never holds the token fixture; the temp file is removed after a failing ssh; remote exit 4 maps to `host_remote_failed` with 4; `host-remove` deletes secrets only after a finished remove; the same file passes for both launchers (`forGroup`, including pwsh on Linux CI). If pwsh runs out of budget, split into F-03a bash and F-03b pwsh. The hostile seams test must stay green.

**Branch/commit.** `fleet/f-03`; `feat(launcher): host-add and host-remove verbs (F-03)`.

## F-04 deploy-player workflow

**Goal.** The one trigger path to the VM: `workflow_dispatch`, nothing else.

**Files (create).** `.github/workflows/deploy-player.yml`, `fleet/bin/dispatch.sh`, `fleet/test/dispatch.test.ts`, `tools/repo-checks/src/deploy-player-workflow.test.ts`, and a `.github/CODEOWNERS` line `/.github/workflows/ @OWNER_LOGIN` (the orchestrator replaces the placeholder with a team handle or login before merge; the test rejects the literal `OWNER_LOGIN`, since GitHub ignores an unknown owner).

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
    environment: fleet
    timeout-minutes: 20
    steps:
      - name: Run
        env:
          INPUT_ID: ${{ inputs.id }}
          INPUT_REPO: ${{ inputs.repo }}
          INPUT_ACTION: ${{ inputs.action }}
        run: /usr/local/bin/geldar-fleet-dispatch
```
Inputs reach the script through `env`, never interpolated into `run:`. No checkout, no third-party action, no secret. `dispatch.sh` refuses when `GITHUB_REF` is not `refs/heads/main` (4; this does not stop a branch workflow that skips it, D-FL-08), validates id and action (2), checks the repo against `/etc/geldar/roster/<id>` (4; `remove` with no roster entry uses the placement `repo=`; with neither, `remove` returns `absent` exit 0), then calls `geldar-fleet-add` or `-remove` and writes the one-line result to `$GITHUB_STEP_SUMMARY`. The kit image is pulled in bootstrap/launcher `upgrade`, not in the job; `timeout-minutes: 20` stands.

**Repo test.** Parses the file with `yaml`; calls `checkWorkflow` from `tools/repo-checks/src/workflows.ts` and expects `[]` (it already covers triggers, secrets, injection, timeout, pin, permissions), then adds only: `Object.keys(wf.on)` equals `['workflow_dispatch']`; input keys equal `['id','repo','action']`, options `['add','remove']`; no input name matches `/token|secret|key|password|credential/i`; `runs-on` equals `['self-hosted','geldar-hosts']`; **every job has `environment: fleet`**; concurrency group contains `inputs.id`; there are no `uses:` at all (no `actions/checkout`); CODEOWNERS covers `.github/workflows/` and has no `OWNER_LOGIN`. Negative cases: mutated copies (an added `pull_request` trigger, an added `token` input, a `secrets.X` line, an interpolated `run:`, the `environment:` line removed) must each produce a finding. `dispatch.test.ts`: `GITHUB_REF` not main exits 4; roster mismatch 4; bad id 2; `INPUT_ACTION` outside add/remove 2; `remove` with no roster and no placement returns `absent` exit 0; `remove` works from the placement file; the summary line is written and, with the fake `-add` seeing a token fixture in a file, it is in no output.

**Branch/commit.** `fleet/f-04`; `feat(fleet): deploy-player workflow, dispatch only, environment fleet (F-04)`.

## F-05 runner install, socket proxy and hardening

**Goal.** A script and doc that install the self-hosted runner under `geldar-runner` with docker reached only through a project-limited socket proxy, and prove the account is confined.

**Files (create).** `fleet/runner/install-runner.sh`, `fleet/runner/verify-confinement.sh`, `fleet/runner/geldar-runner.service` (snapshot), `fleet/runner/versions.env`, `fleet/runner/README.md`, `fleet/test/runner.test.ts`.

**Behaviour.** `install-runner.sh --url <repo-url> --token-file <f>` (root): the one-time registration token is read in-process and handed to `config.sh` through the environment (`ACTIONS_RUNNER_INPUT_TOKEN`, `_URL`, `_LABELS`, `_NAME`), never an argument; `config.sh` runs as `geldar-runner` through `runuser` (it refuses root) with `--unattended --replace`; the custom label list equals `geldar-hosts` (default labels `self-hosted`, `Linux`, `X64` are kept). Download the pinned runner tarball (`RUNNER_VERSION`, `RUNNER_SHA256`; `FILL_ME` or mismatch exits 5 before unpacking). Self-update (D-FL-10) is TBC by scriptorium-orchestrator; the README states the choice. Refuse when `geldar-runner` is in `sudo`, `wheel` or `docker`.

*Docker access.* A socket proxy (image and version `FILL_ME` for the orchestrator, pinned by digest, at least two weeks old, in `versions.env`) listens on a socket or loopback port the runner account may use and forwards only to the real daemon, allowing container create and compose operations only for the compose project name pattern `geldar-player-*`. Whether an existing proxy image can filter on the compose project label or a small custom filter is needed is TBC by scriptorium-orchestrator. The proxy must also be tested to refuse bind mounts of host paths outside the launcher's expected volumes (`-v /:/h` style). The runner's `DOCKER_HOST` is set in the unit. No default `yes` for any docker-group variable exists. Alternative, TBC: a rootless no-sudo user run by the orchestrator that executes the launcher for us.

*Unit* (exact text in `geldar-runner.service`, a snapshot test compares it): `User=geldar-runner`, `WorkingDirectory=/opt/geldar-runner`, `ExecStart=/opt/geldar-runner/run.sh`, `Restart=always`, `KillMode=process`, `Environment=PATH=/usr/local/bin:/usr/bin:/bin`, `Environment=DOCKER_HOST=<proxy endpoint>`, `NoNewPrivileges=yes`, `ProtectHome=yes`, `PrivateTmp=yes`, `ProtectSystem=strict`, `ReadWritePaths=` entries prefixed with `-` where the path may not exist yet: `/srv/geldar`, `/etc/geldar/placement`, `/var/log/geldar-hosts.log`, `/run/geldar-fleet`, `/opt/geldar-runner`, and the launcher state dir TBC.

`verify-confinement.sh` (root; probes through `runuser -u geldar-runner --`) runs exactly these commands and prints `ok <probe>` or `FAIL <probe>`, exit 1 on any FAIL: `test -r /etc/shadow` (must fail), `ls /home/*` (must fail), `sudo -n true` (must fail), `test -w /etc/geldar/keys` (must fail), token and key files readable by name, `/var/log/geldar-hosts.log` appendable, `id -nG` has no `docker`, and a container create outside `geldar-player-*` through the proxy is refused (including a `-v /:/h` create). The probe list is in the snapshot test. F-08 step 1 runs the real script once on the VM.

**README policy text** (verbatim list): dispatch only; a separate unprivileged account; tokens read from a root-owned file at run time, never in inputs or logs; a workflow change needs the owner's PR approval; fork approval and the `fleet` environment's `main` restriction are required (M-3); write access to this repo can still run a branch workflow on the runner (D-FL-08), so the collaborator list is reviewed by the owner; the runner has no route to the owner's desktop.

**Tests** (fake `useradd`, `systemctl`, `curl`, `sha256sum`, `runuser`, `config.sh` that records argv and env): bad or `FILL_ME` checksum exits 5 and nothing is unpacked; unit text equals the snapshot; custom labels equal `geldar-hosts`; the token appears in the fake `config.sh` env, never argv; `sudo` or `docker` membership is refused; probe names match the snapshot; a fake `runuser` that lets `/etc/shadow` be read, or a fake proxy that accepts an out-of-project create, makes verify print FAIL and exit 1.

**Branch/commit.** `fleet/f-05`; `feat(fleet): runner install, socket proxy and confinement check (F-05)`.

## F-06 registration contract doc

**Goal.** The interface geldar-registration builds against. Docs and one test.

**Files (create).** `docs/fleet-dispatch-contract.md` (at most 200 lines), `tools/repo-checks/src/fleet-docs.test.ts`. A decision record is added only if the orchestrator reserved a number; otherwise the doc says `D-FL-NN`.

**Content.**
- Who calls. Roster add and delete are operator verbs (`tools/admin` and `deploy/colo-admin.sh` of the geldar repo); the register web service must NOT hold a GitHub token.
- The call: `POST /repos/<org>/<this-repo>/actions/workflows/deploy-player.yml/dispatches` (this repository, the one named in the dispatch URL), body `{"ref":"main","inputs":{"id":"<id>","repo":"<org>/<name>","action":"add"}}`, expected `204`. Credential: a fine-grained token with Actions write on this repo only, held by the operator tool.
- Sequence on add: provision (repo, deploy key, world token), `host-add` (F-03), dispatch `add`. On delete: dispatch `remove` (leaves secrets, `secrets=left`), then `host-remove` deletes secrets and roster via ssh, then the operator removes the roster entry on the registration side.
- Failure table: dispatch 404, 403, 422; each Contract exit code 2 to 8 with the operator's action; a repeat dispatch is safe; a third dispatch for one id cancels the pending one (state-based, safe); the cap (5) is a refusal, not a retry loop.
- Results: the run summary line and `/var/log/geldar-hosts.log`. Bodies stay on the Colo node; the VM reaches the MCP server by its public name over TCP 443 (M-1).

**Test.** The doc's example JSON parses; its input keys equal the workflow's (read from F-04's file); each exit code 2 to 8 has a table row matching `^\| *<n> *\|`; no `ghp_`, `github_pat_` or dotted-quad pattern appears; a mutated workflow text with a renamed input makes it fail (included as a case). `lint:md` is part of the checks.

**Branch/commit.** `fleet/f-06`; `docs: fleet dispatch contract for registration (F-06)`.

## F-07a migration scripts

**Goal.** Move one running player from the owner's desktop to the VM with a recorded gap and a rollback until the last step. Depends on F-02b, F-03, F-05.

**Files (create).** `fleet/migrate/migrate-player.ps1` (desktop), `fleet/migrate/import-player.sh` (VM), `fleet/test/migrate.test.ts` (scripts only).

**Behaviour.** `migrate-player.ps1 -Id <id> [-DryRun] [-Rollback]` (the `-Finish` mode is a follow-up), one id per run: record the start time; stop the desktop group (the launcher project `geldar-player-<id>`, not `geldar-<id>`; confirm `ps` for it is empty before going on, since two groups on one world token are not allowed); tar each of the five state volumes (names read from the launcher, TBC by scriptorium-orchestrator; `cli-home` is `geldar-cli-<id>-<harness>`) with `tar --numeric-owner` through a throw-away container, each with a `.sha256`; `scp` to the VM; `import-player.sh <id>` verifies checksums, runs `geldar-fleet-place <id> --reserve`, unpacks into the reserved tree (`--numeric-owner`) through the launcher's helper path (R-2), then `geldar-fleet-add` reuses the placement; wait up to 5 minutes for healthy through `player-status`, whose fresh keeper state is read by the launcher (the runner cannot read `keeper-state`); print `recreate_seconds=<n>`. `-Rollback` starts the desktop group and runs `geldar-fleet-remove` on the VM.

**Tests** (fake launcher, ssh, scp): `-DryRun` prints the step list and calls nothing; two ids and an invalid id are refused; call order is stop, tar, scp, import, add, wait; a checksum mismatch stops before `add` and leaves the desktop group stopped and restartable; `-Rollback` issues the documented commands; no token text in any log. Each fails when its guard is removed.

**Branch/commit.** `fleet/f-07a`; `feat(fleet): migration scripts (F-07a)`.

## F-07b migration runbook

**Files (create).** `fleet/migrate/RUNBOOK.md`; edit `fleet/test/migrate.test.ts` (runbook asserts).

**Content.** Pre-flight (F-05 verify green, M-1 present, roster entry present, window agreed); stop the desktop group first and confirm `ps` empty; per-player steps; reading `recreate_seconds`; **rollback only before the VM group has been healthy for one keeper interval**: afterwards the desktop volumes are stale, the keeper holds with `not_fast_forward` and the memory written on the VM is lost, so either sync back (stop the VM group, tar back) or accept the loss with the owner; stop conditions. Test: the file exists and states the rollback limit and the stop-first rule.

**Branch/commit.** `fleet/f-07b`; `docs: migration runbook (F-07b)`.

## F-10 player environment, login and workspace seeding

**Goal.** Make sure a new player created through the launcher's `new` on the VM is complete. Mostly a probe and a doc: the launcher's `new` seeds the workspace (`pl_prepare_ws`) and writes the allowlist; the VM must only supply what is outside it.

**Files (create).** `fleet/lib/login.sh` (checks that the shared login file exists and is not readable by the runner account or the workflow), `fleet/test/login.test.ts`; edit `fleet/README.md`.

**Contract.** The shared Claude login is a file `claude-oauth-token` under the launcher's auth state dir (`~/.local/state/geldar/auth/`), placed by the owner. A fleet workflow and the runner never hold it. Open questions, TBC by scriptorium-orchestrator: which account runs the launcher on the VM, given that the runner account must not read the file (this tension decides whether the rootless-user alternative of F-05 is required); `GELDAR_HARNESS` and `GELDAR_WORLD_PORTS` values and who sets them; where the per-player allowlist is written and who owns it; whether `new` alone leaves `/player` populated for a fresh player (F-08 step 4 depends on it).

**Tests.** Missing login exits 6 with a message naming the path; a login file readable by the runner fixture user is a FAIL (Linux only).

**Branch/commit.** `fleet/f-10`; `feat(fleet): shared login and environment check (F-10)`.

## F-11 launcher verb request (orchestrator, not a coder)

Addressed to scriptorium-orchestrator. Needed from the launcher; fleet calls nothing else, never compose. R-1: a non-interactive `remove <id>` that stops the group, deletes volumes and state and prints a stable result. R-2: a way to place a player's state under a chosen directory (`--state-root <dir>` or equivalent) so the data lands on the chosen drive, and a helper path for unpacking migration tarballs with ownership kept. R-3: machine-readable `player-status <id>` including keeper freshness. R-4: confirm the deploy-key verb leaves a key readable by the keeper uid on native Linux. Names are placeholders until the orchestrator answers; each answer is recorded as TBC by scriptorium-orchestrator until then.

## F-08 migration run (operator, not a coder)

The orchestrator runs this with the owner and geldar-93. Depends on F-07a, F-07b, F-10.
1. Pre-flight per the runbook; run `verify-confinement.sh` once on the VM; the owner confirms M-3 and the collaborator list; geldar-93 confirms the window.
2. Migrate the 6 rangers from the owner's desktop one at a time. After each, geldar-93 confirms the recreate (reconnected to the world, keeper pushing, no held session) before the next. A failure is rolled back and the run stops.
3. Picard last (ag-picard-01). His Body stays on the Colo node; only the group moves, and only after the owner says "ready".
4. The seven new players are created by `host-add` and the dispatched `add` (and F-10's seeding), never on the desktop (D-FL-01).
5. Record per player: start time, `recreate_seconds`, volume. Write `docs/analysis/fleet/worknotes/migration.md`, update RESUME, close the README rows. Desktop groups are removed a day later with the owner's go.

Stop conditions: an unexplained world disconnect for 10 minutes, any keeper key error, any `FAIL` from the confinement check.
