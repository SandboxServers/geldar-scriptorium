# Fleet campaign: player hosts on node3

Owner request of 2026-11-14: run every persistent player's container group on one Linux VM on node3 instead of the owner's desktop, put each player's data across the server's NVMe drives, and deploy or remove a player's host automatically when an agent is registered or deleted. This folder holds the design and the cards. Nothing here changes the world, the registration service or the Colo; those stay with the geldar sessions.

## What exists (2026-11-14)

- VM `Geldar-Hosts` on node3 (Hyper-V, Debian 12, 28 vCPUs, 128 GB static memory, Docker and Compose), host name `geldar-hosts`, ssh user `geldar`, address by DHCP reservation. The OS disk is on one NVMe drive; three 120 GB data disks, one per other NVMe drive, are mounted at `/srv/geldar/nvme-d`, `/srv/geldar/nvme-e` and `/srv/geldar/nvme-g`.
- The VM cannot reach the world MCP address yet (hairpin); the owner chose split DNS for that LAN, done by geldar-93 after a read-only look.

## Design rules

1. **Roles.** Provisioning (create the repo, add the deploy key, mint the world token) is an operator step on a trusted machine. The VM only runs, restarts and removes player hosts. The runner never holds a GitHub account token, the owner's login or any token other than the one for the player being deployed.
2. **Trigger.** One workflow, `deploy-player`, runs only on `workflow_dispatch`, never on `pull_request` or `pull_request_target`, with inputs `id`, `repo` and `action` (`add`, `remove`) only (owner's spec; see the decision note in [work-packets.md](work-packets.md)). No secret is an input. The job uses the GitHub environment `fleet` (branch `main` only), the fork-approval setting is on, and a change to the workflow needs the owner's PR approval.
3. **Runner.** A self-hosted runner on the VM under its own unprivileged account (`geldar-runner`), reaching docker only through a socket proxy limited to `geldar-player-*` (not in the docker group), with no access to anyone's home folder, no sudo, and no route to the owner's desktop. It is labelled `geldar-hosts`.
4. **Secrets on the VM.** For each player: the world token at `/etc/geldar/tokens/<id>.token` (root-owned, group readable by the runner, 0640) and the deploy key at `/etc/geldar/keys/<id>` (same). Both arrive from the operator by scp, never through a workflow input, a log or a message. The launcher masks both in its output.
5. **Placement.** On `add`, the player's state (clone, memory, supervisor volume) goes on the data volume with the most free space; the choice is recorded in `/etc/geldar/placement/<id>` and reused for `restart` and `remove`. A volume below 10% free is skipped; all below it fails the job with a clear message.
6. **Remove.** `remove` stops the group, archives nothing on GitHub (the repo is the memory and stays), deletes the player's state directories on the VM and leaves tokens, keys and roster (the runner cannot write them; `host-remove` deletes them over ssh after the dispatch), and writes a line in `/var/log/geldar-hosts.log`.
7. **Trigger source.** Something on the registration side calls the GitHub API (`workflow_dispatch`) when a roster entry is added or deleted. That caller, and its credential, belong to geldar-registration and geldar-93; this campaign only provides the workflow and a documented contract.
8. **Failure.** Every verb is idempotent: `add` on an existing player is a no-op that reports the placement; `remove` on a missing one succeeds.

## Cards

Each card is for a Haiku coder at about 40k tokens. All edit only the files named; none touches a live player until F-08. Fleet scripts call the launcher's verbs (`new`, `deploy-key`, `start`, `restart`, `upgrade`, `player-status`), never `docker compose`.

Full packets: [work-packets.md](work-packets.md). Waves: 1 = F-01a, F-01b, F-02a, F-11; 2 = F-02b, F-02c, F-03, F-04, F-05, F-10; 3 = F-06, F-07a, F-07b; 4 = F-08.

| Card | Title | Depends on | Status |
|---|---|---|---|
| F-01a | Bootstrap packages and git >= 2.47.1 pinned and checksummed | none | BlockedDecision (D-FL-07 checksum) |
| F-01b | Bootstrap volumes by label, `geldar-runner` (no docker group), `/etc/geldar`, fleet.conf, launcher clone | F-01a | BlockedDecision (D-FL-07, launcher commit) |
| F-02a | `common.sh`, `place.sh`, allow-list, fake launcher, lint test | none | Ready |
| F-02b | `add.sh`, `up.sh`, `restart.sh`, `status.sh` as launcher-verb calls; global cap lock | F-02a | BlockedDependency (F-02a) |
| F-02c | `remove.sh` (leaves secrets, prints `secrets=left`) | F-02b, F-11 | BlockedDependency (F-02b, F-11 R-1) |
| F-03 | Launcher verbs `host-add`, `host-remove` over ssh (operator side, both launchers; host-remove deletes secrets after the dispatch) | F-02b | BlockedDependency (F-02b; hook waits for the other session) |
| F-04 | `deploy-player` workflow (`workflow_dispatch` only, `environment: fleet`), `dispatch.sh`, repo test | F-02b | BlockedDependency (F-02b) |
| F-05 | Runner install, project-limited docker socket proxy, confinement check | F-01b | BlockedDecision (D-FL-07, D-FL-10) |
| F-06 | Registration contract doc for geldar-registration | F-03, F-04 | BlockedDependency (F-03, F-04) |
| F-07a | Migration scripts (desktop to VM, one at a time) | F-02b, F-03, F-05 | BlockedDependency |
| F-07b | Migration runbook | F-07a | BlockedDependency (F-07a) |
| F-08 | Migration run (operator, not a coder): Picard and the six first; the seven new players created on the VM | F-07b, F-10, window | BlockedDependency |
| F-10 | Shared login and environment check; workspace seeding is the launcher's `new` | F-02b | BlockedDependency (F-02b); open questions TBC by scriptorium-orchestrator |
| F-11 | Launcher verb request: non-interactive remove, state placement, status (orchestrator) | none | Open request |

## Decisions assumed (orchestrator, under the owner's delegation)

- D-FL-01: the VM, not the desktop, is the only place new persistent players run.
- D-FL-02: provisioning stays off the VM; the VM never holds a repo-admin credential.
- D-FL-03: placement is by free space at `add` time and then fixed for that player.
- D-FL-04: remove deletes data on the VM only; the player repo on GitHub is untouched.
- D-FL-05: the runner reaches docker through a socket proxy limited to projects `geldar-player-*`, no docker group (owner ruled).
- D-FL-06 (global cap value), D-FL-07 (pinned git, runner and proxy versions and checksums), D-FL-10 (runner self-update): open.
- D-FL-08 (accepted risk): write access to this public repo can run a branch workflow on the runner without `environment: fleet`; the owner reviews the collaborator list.
- D-FL-09: `remove` leaves tokens, keys and roster; `host-remove` deletes them over ssh after the dispatch.

## Manual infra (not cards)

- UniFi policy "Geldar hosts VM to Colo MCP (443)" exists; backup and undo in work-packets.md (M-1). New rules come from geldar-93.
- The VM address is a DHCP reservation, chosen by the owner (M-2).
- Repo settings: fork-approval and owner-approved workflow changes (M-3).
