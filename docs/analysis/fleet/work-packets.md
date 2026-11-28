# Fleet work packets (F-01a..F-11)

Ledger and design: [README.md](README.md). Process: `.claude/skills/campaign-packet/SKILL.md`. A coder reads only its own section plus the Dispatch rules and the Contract below. Specs only: nothing here changes a live player before F-08.

**Decision note (inputs).** This supersedes the original brief: dispatch inputs are `id`, `repo` and `action` (`add` or `remove`) only. `restart` is a VM-side script the operator runs over ssh, not a dispatch; the kit version comes from the committed player files, never an input.

**Launcher rule (scriptorium-orchestrator ruling).** Fleet scripts never call `docker compose` and never re-implement workspace seeding. The VM runs the launcher's own persistent-player code from a pinned clone at `~/scriptorium` of the VM user `geldar` (tag `kit-v0.1.0-rc21`, commit 79b28f7; git 2.47.1 or newer). **The launcher runs as `geldar`, never as the runner** (D-FL-NN below). Verbs used: `adopt` (R-5), `deploy-key`, `start`, `restart`, `stop`, `remove` (R-1), `upgrade`, `player-status`. The compose project name `geldar-player-<id>` is a constant pinned by a repo test (F-02a); the session project `geldar-<id>` is a different thing and is never counted or stopped. A missing verb is a "launcher verb request" (F-11) addressed to scriptorium-orchestrator. Launcher files changed by HC-08b are never edited here.

**Runner door (owner ruling D-FL-NN).** The runner account `geldar-runner` may `sudo` exactly one root-owned wrapper, `/usr/local/sbin/geldar-fleet-run`. The wrapper validates the id against `^ag-[a-z0-9-]+$` and the verb against a fixed list, then runs the launcher verb as `geldar` (who owns the launcher state dir and the shared login). The runner has no general sudo, no docker group, and cannot read the login, tokens or keys. This supersedes the earlier socket-proxy ruling (D-FL-05): the runner needs no docker access at all, so no proxy is built (one line why: the launcher runs as `geldar`, who is already in the docker group). The wrapper, not the unit or `fleet.conf`, sets `DOCKER_HOST`, `PATH` and the launcher state dir, so the workflow path and the operator path (`sudo -u geldar-runner geldar-fleet-<verb>`) behave the same.

## Waves

| Wave | Cards | Notes |
|---|---|---|
| 1 | F-01a, F-02a, F-11 | independent; F-11 is an orchestrator request, not a coder card |
| 2 | F-01b, F-02b | F-01b needs F-01a; F-02b needs F-02a and F-11 R-1..R-5 answered |
| 3 | F-02c, F-03a, F-04, F-05a, F-05b, F-10 | F-02c needs F-02b; F-03a needs F-02b, HC-08b merged and the dispatch hook P-1; F-05b needs F-05a and F-01b |
| 4 | F-03b, F-07a | F-03b needs F-03a; F-07a needs F-02c, F-03a, F-05b |
| 5 | F-06, F-07b | F-06 needs F-03b and F-04; F-07b needs F-07a |
| 6 | F-08 | operator run, not a coder; needs the owner and geldar-93 |

Merging is by hand (the `scriptorium.ps1 merge-packet`, `ledger set` and `check:specs` tools only know `scriptorium/wave<N>` and `SC-NN`): wave branch `fleet/wave<N>`, the orchestrator updates the README rows manually.

Manual infra, recorded, not cards:

- **M-1 UniFi policy.** "Geldar hosts VM to Colo MCP (443)" (the VM to the Colo node, TCP 443) exists (applied 2026-11-14). The owner holds the backup. Undo: delete the policy document, then re-provision by restarting unifi and zeroing the udm cfgversion. New rules are requested from geldar-93, never edited here.
- **M-2 VM address.** DHCP reservation for the VM, done on the gateway on 2026-11-14 (a fixed-address user record for the VM's host name). Nothing in the repo hard-codes an address. The old record is backed up on the gateway (`/data/user-geldar-hosts-backup-20261114.json`). Undo: set `use_fixedip` false on that record and re-provision as in the operator's UniFi notes.
- **M-3 Repo settings (owner).** (1) GitHub environment `fleet`, deployment branches restricted to `main`; (2) "Require approval for all outside collaborators' workflows" on; (3) protect `main` so a change under `.github/workflows/` needs the owner's PR approval (CODEOWNERS, F-04); (4) review the runner's repository collaborator list. **Accepted risk D-FL-08:** anyone with write access to this repo can push a branch whose workflow has `runs-on: [self-hosted, geldar-hosts]` and omits `environment: fleet`; that job runs on the runner and so reaches everything the runner account can, which is now only the wrapper's verbs (with a valid id) and the files the runner owns. The environment does not stop it; only the collaborator list does. The owner confirms all four before F-08.

Decisions: **D-FL-NN (owner ruled): the runner `sudo`s one wrapper that runs the launcher as `geldar`; supersedes the socket proxy of D-FL-05 and the "which account runs the launcher" question of F-10; the number is reserved from origin/main when written.** D-FL-05 is superseded by it. D-FL-06 global cap value: open (migration is not cap-exempt unless the owner says so). D-FL-07 pinned git and runner versions with checksums: open (the proxy is gone from it). D-FL-08 accepted risk above. D-FL-09 secret deletion: `remove.sh` leaves tokens, keys and roster; the operator's `host-remove` deletes them. D-FL-10 runner self-update versus pinned tarball: TBC by scriptorium-orchestrator. The orchestrator fills open ones before dispatching F-01a and F-05a; a coder never guesses them.

## Dispatch rules

1. One coder per card, one worktree, one commit. Branch `fleet/f-NN[x]` from `fleet/wave<N>`; worktree `.claude/worktrees/fleet-f-NN[x]` (`F-01a` gives `fleet-f-01a`). Every commit ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never push; never touch another card's files. Cards that edit `fleet/README.md` use their own section heading (`## F-02a`, `## F-02b`, `## F-10`).
2. Repo rules to inline: pin exact versions at least two weeks old (tarballs by sha256, Actions by commit SHA); LF endings; no secrets, personal account names or IP addresses in code or docs (the repo is public; say "the VM", "the Colo node", "the ssh account"). Service account names the Contract defines (`geldar`, `geldar-runner`) are allowed. One exception: the CODEOWNERS line carries the owner's public GitHub handle, supplied in the F-04 dispatch brief. File soft cap 500 lines, hard 700; each behaviour change has a test that fails when the change is reverted (do it once and say so in the report); never weaken or skip an existing test.
3. Do NOT edit: `launcher/lib/local.*`, `launcher/lib/player.*`, `launcher/lib/new.*`, `launcher/lib/commands.*`, `launcher/geldar-play`, `launcher/geldar-play.ps1`, `launcher/messages.d/73-local.tsv`, `launcher/test/local.test.ts`, `launcher/test/hostile/seams.json`, `launcher/README.md`, nor any file HC-08b or HC-08c changes. F-03a/b add new files, append to `docs/troubleshooting.md` (after HC-08b merges) and add no `GELDAR_*` names.
4. Fleet scripts run on Debian 12 under bash (`#!/usr/bin/env bash`, `set -euo pipefail`). `launcher/lib/host.sh` is sourced by `geldar-play` on every platform: it must stay bash 3.2 compatible (no bash 5: no `mapfile`, `declare -A`, `${x^^}`, `|&`; `launcher/test/core.test.ts` check 13 enforces this). Executable bit: `git update-index --chmod=+x <file>` (or tests invoke `bash <file>`). Tests are vitest files under `fleet/test/` run with a fake wrapper and temp dirs, like `launcher/test/fake-docker.sh`. Needs-bash and needs-`flock` tests skip with a visible reason locally; when `CI` is set they fail, using the `ciRequiresShells` pattern at `launcher/test/core.test.ts:55` copied as is. `fleet/test/lint.test.ts` (owned by F-02a) runs `shellcheck` over `fleet/**/*.sh` and greps that no fleet script contains `set -x` or `bash -x`; it fails when `CI` is set and shellcheck is missing.
5. Checks, in order: `./scriptorium.ps1 pnpm lint`, `./scriptorium.ps1 pnpm lint:md` (docs), `./scriptorium.ps1 pnpm typecheck`, `./scriptorium.ps1 pnpm vitest run fleet tools/repo-checks`, `./scriptorium.ps1 check`. Every `vitest run` here triggers the repo's global setup (`tests/image/global-setup.ts`), which builds the kit image first whenever docker is up (minutes); always set `KIT_IMAGE=geldar-kit:<packet>` for isolation. Report: `.claude/reports/fleet/F-NN[x]-coder.md`. Return line: `F-NN[x] <done|blocked|failed> <sha|-> <report-path>`.
6. Test seams: a fleet script reads `GEL_ROOT` (empty by default; prefixes every absolute path in the Contract), `GEL_RUN` (the wrapper command, default `sudo -n /usr/local/sbin/geldar-fleet-run`) and `GEL_DF` only when `GELDAR_INTERNAL=1`; otherwise it ignores them. The wrapper itself reads no environment seam (it runs as root): its test copies it to a temp dir and rewrites the `readonly WRAP_*` path constants in its header with `sed`. The test proves the ignore case with a fixture where the seam would change the result (a fake wrapper that would log, a root prefix that would move a file). Modes and ownership assertions run only on Linux and skip with the reason on win32. The names are listed in `fleet/README.md`. None is a launcher name.

## Contract (every card builds against this)

### Names and paths

| Thing | Value |
|---|---|
| Repo folder | `fleet/` (`bin/ lib/ conf/ bootstrap/ runner/ migrate/ test/`) |
| Installed to | `/usr/local/lib/geldar-fleet/` (copy of `fleet/`, same commit as the launcher clone); commands linked in `/usr/local/bin/` |
| Launcher clone | `~/scriptorium` of the VM user `geldar`, from `LAUNCHER_URL` pinned to `LAUNCHER_COMMIT` in `fleet/bootstrap/versions.env`. `LAUNCHER_COMMIT` owner: scriptorium-orchestrator; value: tag `kit-v0.1.0-rc21` (commit 79b28f7, checked after the clone). `/usr/local/bin/geldar-play` links to it |
| Commands | `geldar-fleet-place`, `-add`, `-remove`, `-restart`, `-status`, `-dispatch` (sources `fleet/bin/{place,add,remove,restart,status,dispatch}.sh`; shared `fleet/lib/common.sh`, `up.sh`, `login.sh`) |
| Wrapper | `/usr/local/sbin/geldar-fleet-run` (root:root 0755) plus `/etc/sudoers.d/geldar-fleet` (root 0440, `geldar-runner ALL=(root) NOPASSWD: /usr/local/sbin/geldar-fleet-run`, checked with `visudo -cf`). Source `fleet/runner/geldar-fleet-run`. Usage `geldar-fleet-run <verb> <id> [flags]` |
| Data volumes | `/srv/geldar/nvme-d`, `/srv/geldar/nvme-e`, `/srv/geldar/nvme-g`, each mounted by filesystem label `nvme-d`, `nvme-e`, `nvme-g`; `players/` on each is owned by `geldar` |
| Player data | `/srv/geldar/nvme-<x>/players/player-<id>/`, owner `geldar`, 0700, created by the launcher through `--data-dir` (R-2) |
| Secrets in | `<operator token file for the player>`, `<operator deploy-key file for the player>`: `root:geldar` 0640, dirs 0750; the operator puts them there by scp (F-03); the runner cannot read them; the shared Claude login is not one of them (F-10) |
| Roster | `/etc/geldar/roster/<id>`: `root:geldar-runner` 0644, one line `<org>/<repo>`, read with `read -r`; any extra line or CR is refused (exit 2) |
| Placement | `/etc/geldar/placement/<id>`: lines `volume=nvme-<x>` and `repo=<org>/<repo>`; directory owned by `geldar-runner`, 0750 (the fleet's own record; the launcher keeps its own) |
| Config | `/etc/geldar/fleet.conf`, `key=value` read as data, never sourced; only `max_hosts` and `min_free_pct`; unknown keys rejected; root-owned 0644. Template `fleet/conf/fleet.conf.example` has exactly `max_hosts=FILL_ME` and `min_free_pct=10`; `max_hosts` missing, `FILL_ME` or non-numeric exits 5 (no default) |
| Allow-list | `fleet/conf/allowed-repos.txt` to `/etc/geldar/allowed-repos.txt`: one `<org>/<name-glob>` per line, `*` only in the name part. The launcher names player repos `player-<id>`, so the expected line is `<org>/player-ag-*`; the exact org and glob are TBC by scriptorium-orchestrator and written by the orchestrator, not the coder. F-02a fixtures use `player-<id>` names |
| Log | `/var/log/geldar-hosts.log` (0660 `root:geldar-runner`): `<UTC ISO8601> <verb> <id> <result> <detail>`; no token, key text or key path |
| Locks | `/run/geldar-fleet` (tmpfiles `d /run/geldar-fleet 0770 root geldar-runner -`); per id `<id>.lock`, global `_global.lock`; umask 007 |
| Runner | account `geldar-runner` (no login shell, not in `docker`, `sudo` or `wheel`; its only sudo rule is the wrapper), custom label `geldar-hosts` (default labels kept), dir `/opt/geldar-runner` |
| Workflow | `.github/workflows/deploy-player.yml`, name `deploy-player`, job `deploy`, `environment: fleet`, concurrency group `deploy-player-${{ inputs.id }}` (`cancel-in-progress: false`) |
| Operator path | the ssh account (sudo) runs every verb as `sudo -u geldar-runner geldar-fleet-<verb> ...` |

**Wrapper behaviour (built by F-05b, used by every fleet script).** Verbs: `adopt`, `deploy-key`, `start`, `restart`, `stop`, `remove`, `upgrade`, `player-status` (launcher verbs), plus two built-ins `check-secrets <id>` (token and key exist, non-empty, readable by `geldar`; else exit 6) and `check-login` (shared login exists, owner `geldar`, no group or world bits; else exit 6). Anything else exits 2. Per verb a fixed flag list: `--repo <org/name>` (the repo regex), `--token-file` (only `<operator token file for the player>` for the same id), `--data-dir` (only `/srv/geldar/nvme-[deg]/players/player-<id>` for the same id), `--no-start`, `--yes`, `--kv`; no other argument, no `..`, no shell metacharacter, no empty argument; every violation exits 2 before anything runs. It then `exec`s `runuser -u geldar -- env -i HOME=<geldar home> PATH=/usr/local/bin:/usr/bin:/bin DOCKER_HOST=unix:///var/run/docker.sock XDG_STATE_HOME=<geldar home>/.local/state geldar-play <verb> <id> <flags>` from `<geldar home>/scriptorium` (these env values live in the wrapper's header constants). After a successful `deploy-key` it runs the interim `chown 1002:1002 <state>/<id>/deploy-key` for the keeper until R-4 lands, then deletes that line (its own test). Exit codes of the launcher verb pass through; fleet scripts map any non-zero to 7 except the built-ins' 6.

### Validation

`id` matches `^ag-[a-z0-9-]+$` (ids are `ag-<name>-NN`: ag-kimberly-01, ag-picard-01, ag-riker-01, ag-data-01, ag-troi-01, ag-laforge-01, ag-worf-01, ag-bcrusher-01, ag-wcrusher-01, ag-jason-01), 4 to 39 characters (the launcher's `valid_player_id` allows 39 and reserves `auth`, `run`, `players`), no `--`, no trailing `-`. `repo` matches `^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$`, an allow-list pattern, and the roster line for `id` (the roster is the truth); an existing placement `repo=` that differs from the roster exits 4. Every script and the wrapper re-validate; the workflow validating first is never trusted. A bad value exits 2 with no filesystem or launcher action.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | done, including an idempotent no-op |
| 2 | usage, invalid id, repo, roster text, wrapper verb or flag, or dispatch input |
| 3 | no data volume with enough free space |
| 4 | repo not allow-listed, not in the roster, or different from the roster or placement; restart of an unknown host; dispatch from a ref other than `refs/heads/main` |
| 5 | cap `max_hosts` reached for a new placement or reservation; `max_hosts` missing or invalid; a pinned value (checksum, `LAUNCHER_URL`) is `FILL_ME` or mismatched; the lock wait of 60 seconds ran out for `_global.lock` |
| 6 | secret or shared login missing, empty or unreadable by `geldar` |
| 7 | launcher verb failure (including the wrapper's sudo refusal) |
| 8 | another operation holds this id's lock (`flock -n`) |

### Output

One stdout line of `key=value` pairs separated by single spaces; messages go to stderr.
- `add`: `result=added|exists id=<id> volume=nvme-<x> project=geldar-player-<id>`
- `remove`: `result=removed|absent id=<id> secrets=left`; `restart`: `result=restarted id=<id> volume=nvme-<x>`; `place`: `volume=nvme-<x> free_pct=<n>`; `status`: one such line per host, then `running=<n> max=<n>`.
- Token and key contents are never printed. The token reaches the launcher through `--token-file` only (read by `geldar`, never the runner), never an argument holding its text, never in a log or summary.

### Workflow inputs

`id`, `repo` (both `type: string`, required) and `action` (`type: choice`, options `add`, `remove`). Nothing else. No secret is referenced; `permissions: {}`. The run summary carries the one-line output and the exit code.

### Idempotence and concurrency

`add` on an existing placement ensures the group is up and returns `result=exists`. `remove` on a missing host returns `result=absent`, exit 0. GitHub keeps one running and one pending run per concurrency group, so a third dispatch for one id cancels the pending one even with `cancel-in-progress: false`; because add and remove are state-based this is acceptable. `flock -n` exit 8 is the second guard. No text in the repo says dispatches "queue".

## F-01a VM bootstrap: packages and pinned git

**Goal.** A re-runnable script installs what the launcher clone needs on a Debian 12 VM.

**Files (create).** `fleet/bootstrap/bootstrap-git.sh`, `fleet/bootstrap/versions.env`, `fleet/test/bootstrap-git.test.ts`. Edit nothing else.

**Steps** (root only, exit 2 otherwise; each step checks before it acts):
1. apt: `ca-certificates curl build-essential gettext libcurl4-openssl-dev libssl-dev zlib1g-dev libexpat1-dev util-linux shellcheck`. Docker is already on the VM and is not installed here.
2. **git >= 2.47.1** (the launcher clone needs it; Debian 12 ships 2.39). `versions.env` holds `GIT_VERSION=2.47.1`, `GIT_SHA256=f3d8f9bb23ae392374e91cd9d395970dabc5b9c5ee72f39884613cd84a6ed310` (git-2.47.1.tar.xz, `GIT_URL=https://mirrors.edge.kernel.org/pub/software/scm/git/git-2.47.1.tar.xz`; verified by scriptorium-orchestrator against kernel.org's signed sums), `LAUNCHER_URL=https://github.com/SandboxServers/geldar-scriptorium.git` (a private repo: the VM clone needs a read-only deploy key from the owner, placed by the operator, never in the repo or a command line) and `LAUNCHER_COMMIT=kit-v0.1.0-rc21` (owner scriptorium-orchestrator; comment `# commit 79b28f7`). Download, `sha256sum -c` before unpacking (mismatch: exit 5, nothing unpacked), `make prefix=/usr/local all install`. Skip when `/usr/local/bin/git --version` equals the pin. `/etc/profile.d` is not used. The final check runs `/usr/local/bin/git --version` (>= 2.47.1, else exit 6); no account is involved (the account check is F-01b step 5). The checksum is filled by the orchestrator (D-FL-07, checked against the kernel.org signed sums). While `FILL_ME` the script exits 5, and the test asserts that, so this card ships a script that cannot succeed until the orchestrator edits `versions.env` (say so in the report line). The coder never invents it.

**Tests** (fake `apt-get`, `make`, `sha256sum`, `git` on a PATH dir, `GEL_ROOT` temp tree): second run changes nothing; bad checksum exits 5 and fake `make` never ran; `FILL_ME` exits 5; git 2.39 triggers the build, 2.47.1 skips it, a final 2.39 exits 6; non-root refused. Each fails when its step is deleted.

**Branch/commit.** `fleet/f-01a`; `feat(fleet): bootstrap packages and pinned git (F-01a)`.

## F-01b VM bootstrap: volumes, account, directories, install

**Goal.** The rest of the Contract's host state. Depends on F-01a for `versions.env`.

**Files (create).** `fleet/bootstrap/bootstrap.sh` (calls `bootstrap-git.sh` first), `fleet/conf/fleet.conf.example`, `fleet/bootstrap/README.md`, `fleet/test/bootstrap.test.ts`.

**Steps.** (1) For each label mount `/srv/geldar/nvme-<x>` through one `LABEL=` fstab line (no duplicates on re-run), create `players/`, chown `geldar`. (2) The VM user `geldar` must already exist (it is the ssh account; the script never creates it and exits 6 when absent); account `geldar-runner`: system user, `--shell /usr/sbin/nologin`, home `/opt/geldar-runner`, never in `docker`, `sudo` or `wheel` (its one sudo rule is the wrapper, installed by F-05b). (3) `/etc/geldar/{tokens,keys,placement,roster}` with the Contract modes and owners; install `fleet/conf/allowed-repos.txt` to `/etc/geldar/allowed-repos.txt`; write `/etc/geldar/fleet.conf` from the example only when absent (0644); `/var/log/geldar-hosts.log` 0660 `root:geldar-runner`; `/etc/tmpfiles.d/geldar-fleet.conf` with the Contract line. (4) Copy `fleet/` to `/usr/local/lib/geldar-fleet/`, link the commands and `/usr/local/bin/geldar-play`, and as `geldar` (`runuser`) clone `LAUNCHER_URL` into `~/scriptorium` at `LAUNCHER_COMMIT` (exit 5 while `LAUNCHER_URL` is `FILL_ME`; check `git rev-parse HEAD` equals `git rev-parse LAUNCHER_COMMIT^{commit}` in the clone (the commit the tag names, not a hard-coded hash), else exit 6 (a `LAUNCHER_COMMIT` that does not resolve also exits 6); `LAUNCHER_URL` is ssh (`git@github.com:SandboxServers/geldar-scriptorium.git`) with the operator's read-only deploy key `<operator key directory>/launcher-read` and `/etc/geldar/launcher_known_hosts` (exit 5 when a needed clone lacks either; skipped when `~/scriptorium` already exists; ssh vs https TBC by scriptorium-orchestrator); skipped with a message when `fleet/bin` is absent). (5) Self-check prints `ok` or each failed check, including `runuser -u geldar -- git --version` and `runuser -u geldar-runner -- git --version` (>= 2.47.1, else the failed check); exit 0 or 1. The kit image pull is not here: it is F-08 step 1 (`geldar-play upgrade` once, as `geldar`).

**Tests** (`GEL_ROOT` temp tree, fakes for `useradd`, `mount`, `git`, `runuser`): second run changes nothing (hashes equal, fstab has three lines); an existing `fleet.conf` is kept; Contract modes hold (Linux only, `stat -c %a`; skipped on win32 with the reason); no docker-group line for the runner; missing `geldar` exits 6; `LAUNCHER_URL=FILL_ME` exits 5; a clone at the wrong commit fails the self-check; non-root refused. Each fails when its step is deleted.

**Doc.** README: order, how to confirm `git --version`, M-2, no addresses.

**Branch/commit.** `fleet/f-01b`; `feat(fleet): bootstrap volumes, account and directories (F-01b)`.

## F-02a fleet scripts: common library and place

**Goal.** Shared helpers and volume choice, tested.

**Files (create).** `fleet/lib/common.sh`, `fleet/bin/place.sh`, `fleet/conf/allowed-repos.txt`, `fleet/README.md` (section `## F-02a`), `fleet/test/{place,lint,names}.test.ts`, `fleet/test/fake-run.sh` (a fake wrapper that logs argv and the names, not values, of env variables, and models the wrapper verbs and built-ins).

**Behaviour.**
- `common.sh`: `gf_validate_id`, `gf_validate_repo` (bash regex, no eval), `gf_read_roster id` (`read -r`, one line, rejects CR and extras), `gf_conf KEY` (only `max_hosts`, `min_free_pct`; `FILL_ME` exits 5), `gf_log verb id result detail` (strips control characters), `gf_lock id` (`exec 9>` plus `flock -n 9`, else exit 8), `gf_lock_global` (waits: `flock -w 60`, exit 5 on timeout; a `-n` lock would give 8), `gf_run verb id [flags]` (calls `GEL_RUN` or the sudo wrapper; the only way fleet reaches the launcher), `gf_die code msg`, `gf_remove_tree id` (**stub that calls `gf_die 7 "removal helper not installed"`** until F-02c, so an F-02b failure path cannot pass silently).
- `place.sh <id> [--reserve]`: for each volume read `df -B1 --output=avail,size` (`GEL_DF` returns that shape); `free_pct` is `floor(avail*100/size)`; skip volumes with `free_pct` below `min_free_pct` (a volume at exactly `min_free_pct` is kept); choose the most `avail` bytes; none left exits 3 naming the threshold. An existing placement file wins (D-FL-03). `--reserve` takes `_global.lock`, applies the cap (placement files counted against `max_hosts`, else exit 5), then writes the placement file (`volume=`, `repo=` from the roster) so a later `add` reuses it (used by F-07a).
- `names.test.ts`: the compose project constant `geldar-player-<id>` appears in `launcher/lib/player.sh` (grep, read only); the test fails if it changes.

**Tests.** Invalid ids (`AG-x`, `ag-`, `ag-a b`, `../x`, 40 characters) exit 2 with an empty wrapper log; low-space volume skipped, a volume at exactly `min_free_pct` kept, all low exits 3, placement stays after free space changes; `--reserve` with `max_hosts=1` and one existing placement exits 5, and two concurrent reserves choose different outcomes (one wins, the other waits then sees the cap); roster with CR or two lines exits 2; `FILL_ME` in `max_hosts` exits 5; seam variables ignored without `GELDAR_INTERNAL=1` (fixture per Dispatch rule 6); lint test per rule 4. Each fails when its change is reverted.

**Branch/commit.** `fleet/f-02a`; `feat(fleet): common library and place (F-02a)`.

## F-02b fleet scripts: add, up, restart, status

**Goal.** The idempotent VM verbs, implemented as calls through the wrapper. Depends on F-02a. **BlockedDependency on F-11 R-1..R-5**: until then use existing launcher verbs only; scripting a manual delete is the operator's knowing choice, never a card's.

**Files (create).** `fleet/bin/{add,restart,status}.sh`, `fleet/lib/up.sh`, `fleet/test/{add,restart,status}.test.ts`; edit `fleet/README.md` (section `## F-02b`).

**Behaviour.**
- `add.sh <id> <repo>`: validate (2); roster equals `<repo>`, allow-list matches, an existing placement `repo=` equals the roster, else 4; per-id lock; if a placement exists, jump to `up.sh` and skip the cap. For a new placement: take `_global.lock` across count, place and the placement write; count placement files (not running groups, so stopped hosts count); at `max_hosts` exit 5; `gf_run check-secrets <id>` (exit 6 when missing or empty; the runner cannot read the files itself); place; write the placement; `up.sh`. The data directory is created by the launcher (`--data-dir`, R-2), not by fleet. `_global.lock` is not re-entrant: F-02b calls `place.sh --reserve` itself and does not hold `_global.lock` around it.
- `up.sh`: first `check-login` (F-10 wires `login.sh`; until then a stub that returns 0), then if `gf_run player-status <id> --kv` (R-3) shows no player: `gf_run adopt <id> --repo <repo> --token-file <operator token file for the player> --data-dir <player data dir> --no-start` (R-5; the launcher's `new` needs gh and pushes, so it is not used), then `deploy-key <id>` (the wrapper performs the interim keeper-uid chown until R-4), then `start`. The token is passed as a file path only; the fake wrapper logs the env variable names it received. Env (`DOCKER_HOST`, `PATH`, state dir) is the wrapper's, not fleet's.
- Failure after the placement was written and before `up` succeeded calls `gf_remove_tree` (F-02c: `gf_run remove <id> --yes`, R-1); an earlier placement is never removed on failure. Exit 7. If R-1 is refused the failure path stays incomplete and the card says so.
- `restart.sh <id>`: placement must exist (else 4); `gf_run restart`. `status.sh`: placements with `player-status --kv` result, then `running=` and `max=`.

**Tests** (fake wrapper): repo not allow-listed, roster missing, roster differing from placement exit 4; add twice gives `added` then `exists`, one placement file; two concurrent adds with `max_hosts=1` give one success and one exit 5; missing, `FILL_ME` or non-numeric `max_hosts` exits 5; an over-cap stopped host with a placement still starts; empty token (fake `check-secrets` returns 6) exits 6; failing fake `start` exits 7 and the failure path reaches `gf_remove_tree` (while the stub is in place, exit 7 with the stub's message); lock held exits 8; `add` run with an empty environment still works (the wrapper, not fleet, supplies env). Positive control: the fake wrapper saw `--token-file` and `--data-dir` and no argv or log or summary contains the token fixture text. Each fails when reverted.

**Branch/commit.** `fleet/f-02b`; `feat(fleet): add, up, restart and status via the wrapper (F-02b)`.

## F-02c fleet scripts: remove

**Goal.** Remove a host without deleting secrets. Depends on F-02a, F-02b and F-11 R-1. If R-1 is refused the card is blocked; no compose call and no scripted delete is allowed instead.

**Files (create).** `fleet/bin/remove.sh`, `fleet/test/remove.test.ts`; edit `fleet/lib/common.sh` (`gf_remove_tree` becomes `gf_run remove <id> --yes`).

**Behaviour.** `remove.sh <id>`: validate; lock; no placement and no group (`player-status --kv`): `absent`. Else `gf_run remove <id> --yes` (R-1: idempotent; stops project `geldar-player-<id>`, deletes volumes, the state dir and the launcher's placement; shared with the failure path of `add`). Then delete the fleet placement file and log. Tokens, keys and the roster are left (root-owned; the runner cannot write those directories under `ProtectSystem=strict`), and the line prints `secrets=left`. The operator's `host-remove` (F-03) deletes them after the dispatch. The GitHub repo is untouched (D-FL-04).

**Tests.** `remove` twice gives `removed` then `absent`; the secret files are still present; the line has `secrets=left`; the fake wrapper saw `remove <id> --yes`; the failure path of `add` now deletes through the helper; with the fake wrapper, `remove` sees the same state dir and `DOCKER_HOST` as in `add` (both come from the wrapper). Each fails when reverted.

**Branch/commit.** `fleet/f-02c`; `feat(fleet): remove leaves secrets, removes state (F-02c)`.

## F-03a launcher verbs host-add and host-remove: bash side

**Goal.** From the operator's machine, copy a player's secrets to the VM and call the scripts over ssh. This is provisioning (design rule 1), not the workflow. Depends on F-02b.

**Sequencing and prerequisites (overlap, flagged).** Other sessions edit `launcher/lib/player.*`, `commands.*`, `local.*`, `new.*`, both `geldar-play` scripts, `launcher/README.md` (HC-08c) and `docs/troubleshooting.md` (HC-08b). F-03a is dispatched only after HC-08b is merged (it appends to `docs/troubleshooting.md`; append only, so the merge is textual) and after prerequisite **P-1**: the orchestrator adds the dispatch hook for a new group `host` in `launcher/geldar-play` and `launcher/geldar-play.ps1` and the `parity.ts` twin-drift entry (merge-ordered after the `local` group) and merges it, so the tests below can call `geldar-play host-add`. This card defines functions only and edits none of those files. It does not touch `launcher/README.md`: the verb stanza goes in `fleet/README.md` (section `## F-03`).

**Files (create).** `launcher/lib/host.sh` (bash 3.2 syntax only, core check 13: `host_add`, `host_remove`), `launcher/messages.d/74-host.tsv`, `launcher/test/host.test.ts` (bash cases); append to `docs/troubleshooting.md`; edit `fleet/README.md`.

**Messages (English; `74-host.tsv`, ids and texts).** `host_added` "Host for %s is up (%s)."; `host_installed` "Secrets and roster for %s installed; nothing started."; `host_exists` "Host for %s already exists."; `host_removed` "Host for %s removed; secrets deleted."; `host_absent` "No host for %s."; `host_bad_id` "%s is not a valid player id (ag-<name>-NN)."; `host_ssh_failed` "Could not reach the VM over ssh."; `host_remote_failed` "The VM refused the step with exit code %s (4 means repo or roster mismatch)." Each key gets one `### key` section (three labelled paragraphs, as the file's other entries) appended to `docs/troubleshooting.md`, because `tools/repo-checks/src/troubleshooting.test.ts` requires exactly one section per key. If HC-08b changed the entry format, follow its format.

**Behaviour.** `geldar-play host-add <id> --repo <org/repo> --token-file <f> --key-file <f> --ssh <user@host> [--install-only]`: the ssh target comes from `--ssh` or a file `hosts-ssh` in the launcher state dir (TBC by scriptorium-orchestrator for the dir helper); no new `GELDAR_*` names, `ssh` and `scp` found through PATH, options `-o BatchMode=yes -o StrictHostKeyChecking=yes` (known_hosts is the operator's own). Exact remote steps: (1) validate the id locally (`host_bad_id`, no ssh). (2) `ssh <t> 'umask 077; mktemp -d "$HOME/.geldar-host.XXXXXX"'` returns a 0700 dir `<d>` in the ssh account's home (no predictable name in a shared directory). (3) `scp` (local umask 077) the token and key to `<d>/token` and `<d>/key`. (4) One `ssh <t> bash -s -- <id> <repo> <d> <mode>` with a fixed script on stdin (no value is spliced into the script text; the script re-validates id, repo and `<d>` against `^[A-Za-z0-9_/.-]+$`), which installs `trap 'rm -rf -- "$d"' EXIT` first, then: `sudo install -o root -g geldar -m 0640 "$d/token" <operator token file for the player>`; `sudo install -o root -g geldar -m 0640 "$d/key" <operator deploy-key file for the player>`; writes `<repo>` to `/etc/geldar/roster/<id>` (root:geldar-runner 0644); and unless `<mode>` is `install-only`, runs `sudo -u geldar-runner geldar-fleet-add <id> <repo>`. `--install-only` installs secrets and roster and never calls `geldar-fleet-add` (used by F-07a and the runbook: the migration data must arrive before the group starts, so no empty player starts on the same world token). `host-remove <id> --ssh <t>`: after the dispatched `remove` returned `absent` or `removed` (checked with `sudo -u geldar-runner geldar-fleet-status`), one ssh call runs `rm -f <operator token file for the player> <operator deploy-key file for the player> /etc/geldar/roster/<id>` with exact names, never a glob; without a finished remove it refuses. A `--run` flag runs `geldar-fleet-remove` itself first. Token and key are never printed or in an argument list. Output is the remote line through `sanitize`; a non-zero remote code maps to `host_remote_failed` naming it.

**Tests.** `launcher/test/host.test.ts` through the shared harness with fake `ssh` and `scp` first on PATH: a bad id is refused before any ssh; positive control: the fake `scp` records the sha256 of each file it received and the test asserts both equal the fixtures' hashes, while the fake ssh log never holds the token fixture text (a `host-add` that drops the token fails the first assertion); the remote dir is removed after a failing ssh; remote exit 4 maps to `host_remote_failed` with 4; `--install-only` never calls `geldar-fleet-add`; `host-remove` deletes secrets only after a finished remove; with sibling ids `ag-x-01` and `ag-x-010` in the fake remote tree, removing `ag-x-01` leaves `ag-x-010`'s three files (revert to a `<id>*` glob: the sibling is deleted, the test fails). The hostile seams test and `core.test.ts` check 13 stay green; the troubleshooting test is green with the appended entries.

**Branch/commit.** `fleet/f-03a`; `feat(launcher): host-add and host-remove verbs, bash (F-03a)`.

## F-03b launcher verbs host-add and host-remove: PowerShell twin

**Goal.** The twin for `geldar-play.ps1`. Depends on F-03a (and P-1).

**Files (create).** `launcher/lib/host.ps1` (`Invoke-HostAdd`, `Invoke-HostRemove`, same messages and remote script text as F-03a); edit `launcher/test/host.test.ts` (the same cases run for both launchers with `forGroup`, including pwsh on Linux CI). The parity and hostile tests stay green. No new message keys.

**Branch/commit.** `fleet/f-03b`; `feat(launcher): host-add and host-remove verbs, pwsh twin (F-03b)`.

## F-04 deploy-player workflow

**Goal.** The one trigger path to the VM: `workflow_dispatch`, nothing else.

**Files (create).** `.github/workflows/deploy-player.yml`, `fleet/bin/dispatch.sh`, `fleet/test/dispatch.test.ts`, `tools/repo-checks/src/deploy-player-workflow.test.ts`, and a `.github/CODEOWNERS` line `/.github/workflows/ @<handle>`: the handle (the owner's public GitHub login or a team) is supplied in the dispatch brief by the orchestrator; if the brief has none the card is blocked, and the coder never writes a placeholder. This is the one exception to the "no account names" rule (GitHub ignores an unknown owner).

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
Inputs reach the script through `env`, never interpolated into `run:`. No checkout, no third-party action, no secret. `dispatch.sh` refuses when `GITHUB_REF` is not `refs/heads/main` (4; this does not stop a branch workflow that skips it, D-FL-08), validates id and action (2), checks the repo against `/etc/geldar/roster/<id>` (4; `remove` with no roster entry uses the placement `repo=`; with neither, `remove` returns `absent` exit 0), then calls `geldar-fleet-add` or `-remove` and writes the one-line result to `$GITHUB_STEP_SUMMARY`. The kit image is pulled once at F-08 step 1 (`geldar-play upgrade` as `geldar`), not in the job; `timeout-minutes: 20` stands.

**Repo test.** Parses the file with `yaml`; calls `checkWorkflow` from `tools/repo-checks/src/workflows.ts` and expects `[]` (it already covers triggers, secrets, injection, timeout, pin, permissions), then adds only: `Object.keys(wf.on)` equals `['workflow_dispatch']`; input keys equal `['id','repo','action']`, options `['add','remove']`; no input name matches `/token|secret|key|password|credential/i`; `runs-on` equals `['self-hosted','geldar-hosts']`; **every job has `environment: fleet`**; concurrency group contains `inputs.id`; there are no `uses:` at all (no `actions/checkout`); `.github/CODEOWNERS` has a line covering `/.github/workflows/` with a `@` owner and does not contain the literal `OWNER_LOGIN` (the test reads the file; the handle itself is not asserted). Negative cases: mutated copies (an added `pull_request` trigger, an added `token` input, a `secrets.X` line, an interpolated `run:`, the `environment:` line removed) must each produce a finding. `dispatch.test.ts`: `GITHUB_REF` not main exits 4; roster mismatch 4; bad id 2; `INPUT_ACTION` outside add/remove 2; `remove` with no roster and no placement returns `absent` exit 0; `remove` works from the placement file; the summary line is written and no output holds the token fixture.

**Branch/commit.** `fleet/f-04`; `feat(fleet): deploy-player workflow, dispatch only, environment fleet (F-04)`.

## F-05a runner install and unit

**Goal.** A script and doc that install the self-hosted runner under `geldar-runner`. Depends on F-01b.

**Files (create).** `fleet/runner/install-runner.sh`, `fleet/runner/geldar-runner.service` (snapshot), `fleet/runner/versions.env`, `fleet/runner/README.md` (section `## Install`), `fleet/test/runner.test.ts`.

**Behaviour.** `install-runner.sh --url <repo-url> --token-file <f>` (root): the one-time registration token is read in-process and handed to `config.sh` through the environment (`ACTIONS_RUNNER_INPUT_TOKEN`, `_URL`, `_LABELS`, `_NAME`), never an argument; `config.sh` runs as `geldar-runner` through `runuser` (it refuses root) with `--unattended --replace`; the custom label list equals `geldar-hosts` (default labels `self-hosted`, `Linux`, `X64` are kept). Download the pinned runner tarball (`RUNNER_VERSION=2.338.2`, linux-x64 tarball `actions-runner-linux-x64-2.338.2.tar.gz`, `RUNNER_SHA256=baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40` from the release page, published 2026-10-26; a mismatch exits 5 before unpacking; the F-05a test keeps a `FILL_ME` case). Self-update (D-FL-10) is TBC by scriptorium-orchestrator; the README states the choice. Refuse when `geldar-runner` is in `docker`, `sudo` or `wheel`. No docker variable, no proxy.

*Unit* (exact text in `geldar-runner.service`, a snapshot test compares it): `User=geldar-runner`, `WorkingDirectory=/opt/geldar-runner`, `ExecStart=/opt/geldar-runner/run.sh`, `Restart=always`, `KillMode=process`, `Environment=PATH=/usr/local/bin:/usr/bin:/bin`, `ProtectHome=yes`, `PrivateTmp=yes`, `ProtectSystem=strict`, `ReadWritePaths=` entries prefixed with `-` where the path may not exist yet: `/etc/geldar/placement`, `/var/log/geldar-hosts.log`, `/run/geldar-fleet`, `/opt/geldar-runner`, `/run/sudo`. **No `NoNewPrivileges=yes`**: the runner reaches the wrapper through setuid `sudo`, which that setting breaks; the snapshot test asserts the line is absent and the README says why. No `DOCKER_HOST` (the wrapper sets it). Whether `sudo` works under `ProtectSystem=strict` and `PrivateTmp` (timestamp and log writes) is verified on the real unit in F-08 step 1; if not, the orchestrator adjusts `ReadWritePaths` and the snapshot together.

**Tests** (fake `useradd`, `systemctl`, `curl`, `sha256sum`, `runuser`, `config.sh` that records argv and env): bad or `FILL_ME` checksum exits 5 and nothing is unpacked; unit text equals the snapshot and has no `NoNewPrivileges`; custom labels equal `geldar-hosts`; the token appears in the fake `config.sh` env, never argv; `sudo`, `wheel` or `docker` membership is refused. Each fails when reverted.

**Branch/commit.** `fleet/f-05a`; `feat(fleet): runner install and unit (F-05a)`.

## F-05b root wrapper, sudoers and confinement check

**Goal.** The wrapper of the Contract, its sudoers rule, and a script that proves the runner account is confined. Depends on F-05a and F-01b.

**Files (create).** `fleet/runner/geldar-fleet-run`, `fleet/runner/geldar-fleet-sudoers`, `fleet/runner/install-wrapper.sh` (root; installs both with the Contract owners and modes and runs `visudo -cf` before the sudoers file lands), `fleet/runner/verify-confinement.sh`, `fleet/test/{wrapper,confinement}.test.ts`; edit `fleet/runner/README.md` (section `## Confinement`).

**Wrapper.** As specified in the Contract. Its header holds `readonly WRAP_*` constants (launcher user, home, PATH, `DOCKER_HOST`, state dir, runuser path, allowed verb list) so the test can rewrite them. A flag, verb or id the wrapper does not recognise exits 2 before anything runs.

**`verify-confinement.sh`** (root; probes through `runuser -u geldar-runner --`) runs exactly these and prints `ok <probe>` or `FAIL <probe>`, exit 1 on any FAIL: `test -r /etc/shadow` (must fail); `ls /home/*` (must fail); `sudo -n true` (must fail); `sudo -n -l` lists exactly one command, the wrapper (must); `test -w /etc/geldar/keys` (must fail); `test -r <operator token directory>/<any file>` and `test -r <operator key directory>/<any file>` and `test -r` of the shared login (each must fail; the runner reads none of them); `/var/log/geldar-hosts.log` appendable; `id -nG` has no `docker`, `sudo` or `wheel`; `docker ps` as the runner fails; wrapper negatives: ids `AG-x`, `ag-a;b`, `ag-x$(id)`, `ag-x b`, `../x`, verbs `bash`, `exec` and `start;id`, an extra flag `--rm`, each exits 2 and starts nothing; wrapper positive control: `check-secrets ag-probe-00` with a good id exits 0 or 6, never 2 (a wrapper that rejects everything would pass every negative, so this keeps the negatives honest); a `systemctl show geldar-runner -p ProtectSystem,ReadWritePaths,NoNewPrivileges` probe (the unit's own confinement; `NoNewPrivileges` must read `no`). The probe list is in the snapshot test. F-08 step 1 runs the real script once on the VM.

**README policy text** (verbatim list): dispatch only; a separate unprivileged account with one sudo rule; the runner never reads tokens, keys or the login and never touches docker; tokens read from root-owned files by `geldar` at run time, never in inputs or logs; a workflow change needs the owner's PR approval; fork approval and the `fleet` environment's `main` restriction are required (M-3); write access to this repo can still run a branch workflow on the runner (D-FL-08), reaching only the wrapper's verbs, so the collaborator list is reviewed by the owner; the runner has no route to the owner's desktop.

**Tests.** Wrapper (copy in a temp dir, constants rewritten, fake `runuser` and fake `geldar-play`): the listed bad ids, shell metacharacters (`;`, `$(`, backtick, space, newline), unknown verbs and flags, `--token-file` or `--data-dir` of another id, and `..` all exit 2 with the fake launcher log empty; a good id reaches the fake `geldar-play` with `DOCKER_HOST`, `PATH` and the state dir set and nothing else from the caller's environment (run with a hostile environment; deleting the export in the wrapper fails the test); `check-secrets` exits 6 on an empty fixture and 0 on a good one; the sudoers text is exactly one rule; the wrapper's `deploy-key` chown line is present (and the test is marked for deletion with R-4). Confinement: a fake `runuser` that lets `/etc/shadow` or a token be read, or that lists a second sudo command, or a wrapper fake that accepts a metacharacter id, makes verify print FAIL and exit 1; the positive-control probe failing also exits 1; probe names match the snapshot. Each fails when reverted.

**Branch/commit.** `fleet/f-05b`; `feat(fleet): root wrapper, sudoers rule and confinement check (F-05b)`.

## F-06 registration contract doc

**Goal.** The interface geldar-registration builds against. Docs and one test.

**Files (create).** `docs/fleet-dispatch-contract.md` (at most 200 lines), `tools/repo-checks/src/fleet-docs.test.ts`. A decision record is added only if the orchestrator reserved a number; otherwise the doc says `D-FL-NN`.

**Content.**
- Who calls. Roster add and delete are operator verbs (`tools/admin` and `deploy/colo-admin.sh` of the geldar repo); the register web service must NOT hold a GitHub token.
- The call: `POST /repos/<org>/<this-repo>/actions/workflows/deploy-player.yml/dispatches` (this repository, the one named in the dispatch URL), body `{"ref":"main","inputs":{"id":"<id>","repo":"<org>/<name>","action":"add"}}`, expected `204`. Credential: a fine-grained token with Actions write on this repo only, held by the operator tool.
- Sequence on add: provision (repo, deploy key, world token), `host-add` (F-03), dispatch `add`. On delete: dispatch `remove` (leaves secrets, `secrets=left`), then `host-remove` deletes secrets and roster via ssh, then the operator removes the roster entry on the registration side.
- Failure table: dispatch 404, 403, 422; each Contract exit code 2 to 8 with the operator's action; a repeat dispatch is safe; a third dispatch for one id cancels the pending one (state-based, safe); a refusal at the cap is exit 5, not a retry loop.
- Results: the run summary line and `/var/log/geldar-hosts.log`. Bodies stay on the Colo node; the VM reaches the MCP server by its public name over TCP 443 (M-1).

**Test.** The doc's example JSON parses; its input keys equal the workflow's (read from F-04's file); each exit code 2 to 8 has a table row matching `^\| *<n> *\|`; no `ghp_`, `github_pat_` or dotted-quad pattern appears; a mutated workflow text with a renamed input makes it fail (included as a case). `lint:md` is part of the checks.

**Branch/commit.** `fleet/f-06`; `docs: fleet dispatch contract for registration (F-06)`.

## F-07a migration scripts

**Goal.** Move one running player from the owner's desktop to the VM with a recorded gap and a rollback until the last step. Depends on F-02b, F-02c (`-Rollback` runs `geldar-fleet-remove`), F-03a (`host-add --install-only`), F-05b. **BlockedDependency on F-11 R-1..R-5**: until then use existing verbs only; scripting a manual delete is the operator's knowing choice, not this card's.

**Files (create).** `fleet/migrate/migrate-player.ps1` (desktop), `fleet/migrate/import-player.sh` (VM), `fleet/test/migrate.test.ts` (scripts only).

**Behaviour.** `migrate-player.ps1 -Id <id> [-DryRun] [-Rollback]` (the `-Finish` mode is a follow-up), one id per run: record the start time; stop the desktop group with `geldar-play stop <id>` and confirm with `player-status` that nothing runs (the compose project is `geldar-player-<id>`, not `geldar-<id>`; two groups on one world token are not allowed); tar each of the five state volumes (names `geldar-<volume>-<id>` per the launcher's `player.yml`, `cli-home` is `geldar-cli-<id>-<harness>`) with `tar --numeric-owner` through a throw-away container named `geldar-migrate-tar-<id>`, which is the one raw `docker run` on the desktop (or a launcher export verb if the orchestrator adds one), each with a `.sha256`; `scp` to the VM; the operator runs `host-add <id> --install-only ...` (secrets and roster only, no group starts); `import-player.sh <id>` verifies checksums, runs `geldar-fleet-place <id> --reserve` (global lock and cap apply; exit 5 at the cap), then `adopt <id> --repo ... --token-file ... --data-dir <reserved dir> --no-start` (R-5 gives the host-side clone, branch and token the tarballs lack), unpacks the volumes with `tar --numeric-owner` through a throw-away container run by the ssh account (operator path, not the runner; the second raw `docker run`, named `geldar-migrate-untar-<id>`), then `geldar-fleet-add` reuses the placement and starts; wait up to 5 minutes for healthy through `player-status --kv`; print `recreate_seconds=<n>`. `-Rollback` starts the desktop group and runs `geldar-fleet-remove` on the VM.

**Tests** (fake wrapper, ssh, scp, docker): `-DryRun` prints the step list and calls nothing; two ids and an invalid id are refused; call order is stop, tar, scp, install-only, place, adopt, untar, add, wait; `host-add` in this flow carries `--install-only` and never starts a group; a checksum mismatch stops before `add` and leaves the desktop group stopped and restartable; `-Rollback` issues the documented commands; no token text in any log. Each fails when its guard is removed.

**Branch/commit.** `fleet/f-07a`; `feat(fleet): migration scripts (F-07a)`.

## F-07b migration runbook

**Files (create).** `fleet/migrate/RUNBOOK.md`; edit `fleet/test/migrate.test.ts` (runbook asserts).

**Content.** Pre-flight (F-05b verify green, M-1 present, `host-add --install-only` done, window agreed); stop the desktop group first and confirm nothing runs; per-player steps; reading `recreate_seconds`; **rollback only before the VM group has been healthy for one keeper interval**: afterwards the desktop volumes are stale, the keeper holds with `not_fast_forward` and the memory written on the VM is lost, so either sync back (stop the VM group, tar back) or accept the loss with the owner; stop conditions. Test: the file exists and states the rollback limit and the stop-first rule.

**Branch/commit.** `fleet/f-07b`; `docs: migration runbook (F-07b)`.

## F-10 shared login and environment check

**Goal.** Make sure a player created on the VM is complete: the shared login exists where the launcher (running as `geldar`) reads it, and the runner cannot read it. Depends on F-02b.

**Files (create).** `fleet/lib/login.sh` (calls `gf_run check-login`; the wrapper built-in does the check as `geldar`), `fleet/test/login.test.ts`; edit `fleet/lib/up.sh` (replace F-02b's stub: `up.sh` calls `login.sh` before `adopt` and `start`), edit `fleet/README.md` (section `## F-10`).

**Contract.** The shared Claude login is a file `claude-oauth-token` under the launcher's auth state dir (`~/.local/state/geldar/auth/` of `geldar`), placed by the owner, owned by `geldar`, mode 0600. The launcher runs as `geldar` (D-FL-NN), so `auth_mode_private` holds; a fleet workflow and the runner never hold or read it (the runner has no access to `geldar`'s home). Open questions, TBC by scriptorium-orchestrator: `GELDAR_HARNESS` and `GELDAR_WORLD_PORTS` values and who sets them (the wrapper's env block, if the launcher needs them); where the per-player allowlist is written (it is written by `start`, player.sh:291-292, not by `adopt`); whether `adopt` plus `start` leaves `/player` populated for a fresh player (F-08 step 4 depends on it).

**Tests.** Missing login: the fake `check-login` returns 6 and `login.sh` exits 6 with a message naming the path; `up.sh` aborts before `adopt` when it fails; a fixture login with mode bits wider than 0600 under `GEL_ROOT` is a FAIL (assert on mode bits, Linux only; no root needed). The real "runner cannot read it" probe is in F-05b's `verify-confinement.sh`. Each fails when reverted.

**Branch/commit.** `fleet/f-10`; `feat(fleet): shared login and environment check (F-10)`.

## F-11 launcher verb request (scriptorium-orchestrator, not a coder)

Addressed to scriptorium-orchestrator, who owns the launcher after HC-08b merges. This card text is the request; fleet edits no launcher file. Fleet calls nothing but the verbs below through the wrapper and never compose. Names are placeholders until the orchestrator answers; each answer is recorded as TBC by scriptorium-orchestrator until then. F-02b and F-07a are BlockedDependency on R-1..R-5: until then use existing verbs only; scripting a manual delete is the operator's knowing choice.

- **R-1** `remove <id> --yes`: non-interactive and idempotent. Stops compose project `geldar-player-<id>`, deletes its volumes, the state dir and the placement (the launcher's own placement file); a second call on a missing player exits 0 and says so.
- **R-2** a per-player data placement option, proposed `--data-dir <path>` (on `adopt`). Today placement is done outside the launcher: per-player dirs under `/srv/geldar/nvme-d`, `nvme-e`, `nvme-g` `/players/` are symlinked into `~/geldar-players`, with a placement file `~/.local/state/geldar/<id>.placement`. The option makes the launcher create the tree, symlink it and write that file.
- **R-3** `player-status <id> --kv`: stable `key=value` output including keeper freshness (fleet cannot parse the human table).
- **R-4** the launcher sets owner and mode of the deploy key so the keeper (uid 1002) can read it on native Linux. Today this is NOT fixed: compose secret uid/mode is ignored outside Swarm, so the interim `chown 1002:1002 <state>/<id>/deploy-key` stays in the wrapper (F-05b) until R-4 lands.
- **R-5** an adopt or install-only path for migrated players, proposed `adopt <id> --repo <org/name> --token-file <f> [--data-dir <path>] [--no-start]`. Reason: `geldar-play new` needs an authenticated `gh` (`gh repo view`, `gh api`, `gh repo clone`, `gh repo create`), pushes a commit to the player repo, and refuses a repo holding more than README.md, LICENSE and .gitignore (`adopt_verify`, `repo_not_empty`); it also lacks the host-side `clone`, `branch` and `token` that a migrated player needs (tarring the volumes does not carry them). `adopt` registers an existing player repo on this host from its URL with no gh (clone over https or the deploy key), writes `clone`, `branch` and `token` in the state dir, never pushes, and does not start unless asked.

## F-08 migration run (operator, not a coder)

The orchestrator runs this with the owner and geldar-93. Depends on F-07a, F-07b, F-10.
1. Pre-flight per the runbook; run `geldar-play upgrade` once as `geldar` (pulls the kit and squid images, not in the 20-minute job); run `verify-confinement.sh` once on the VM, which also proves `sudo` works under the real unit's `ProtectSystem` and `PrivateTmp`; the owner confirms M-3 and the collaborator list; geldar-93 confirms the window.
2. Migrate the 6 rangers from the owner's desktop one at a time. After each, geldar-93 confirms the recreate (reconnected to the world, keeper pushing, no held session) before the next. A failure is rolled back and the run stops.
3. Picard last (ag-picard-01). His Body stays on the Colo node; only the group moves, and only after the owner says "ready".
4. The seven new players are created by `host-add` and the dispatched `add` (adopt, deploy-key, start through the wrapper, and F-10's checks), never on the desktop (D-FL-01).
5. Record per player: start time, `recreate_seconds`, volume. Write `docs/analysis/fleet/worknotes/migration.md`, update RESUME, close the README rows. Desktop groups are removed a day later with the owner's go.

Stop conditions: an unexplained world disconnect for 10 minutes, any keeper key error, any `FAIL` from the confinement check.
