# Fleet campaign: player hosts on node3

Owner request of 2026-11-14: run every persistent player's container group on one Linux VM on node3 instead of the owner's desktop, put each player's data across the server's NVMe drives, and deploy or remove a player's host automatically when an agent is registered or deleted. This folder holds the design and the cards. Nothing here changes the world, the registration service or the Colo; those stay with the geldar sessions.

## What exists (2026-11-14)

- VM `Geldar-Hosts` on node3 (Hyper-V, Debian 12, 28 vCPUs, 128 GB static memory, Docker and Compose), host name `geldar-hosts`, ssh user `geldar`, LAN address by DHCP (a fixed address is the owner's call). The OS disk is on one NVMe drive; three 120 GB data disks, one per other NVMe drive, are mounted at `/srv/geldar/nvme-d`, `/srv/geldar/nvme-e` and `/srv/geldar/nvme-g`.
- The VM cannot reach the world MCP address yet (hairpin); the owner chose split DNS for that LAN, done by geldar-93 after a read-only look.

## Design rules

1. **Roles.** Provisioning (create the repo, add the deploy key, mint the world token) is an operator step on a trusted machine. The VM only runs, restarts and removes player hosts. The runner never holds a GitHub account token, the owner's login or any token other than the one for the player being deployed.
2. **Trigger.** One workflow, `deploy-player`, runs only on `workflow_dispatch`, never on `pull_request` or `pull_request_target`, with inputs `player_id`, `action` (`add`, `remove`, `restart`) and `kit_version`. No secret is an input. The repository setting that requires approval for outside contributors' workflows is on, and a change to the workflow needs the owner's PR approval.
3. **Runner.** A self-hosted runner on the VM under its own unprivileged account (`geldar-runner`), in the `docker` group only if no narrower path exists (to confirm), with no access to anyone's home folder, no sudo, and no route to the owner's desktop. It is labelled `geldar-hosts`.
4. **Secrets on the VM.** For each player: the world token at `/etc/geldar/tokens/<id>.token` (root-owned, group readable by the runner, 0640) and the deploy key at `/etc/geldar/keys/<id>` (same). Both arrive from the operator by scp, never through a workflow input, a log or a message. The launcher masks both in its output.
5. **Placement.** On `add`, the player's state (clone, memory, supervisor volume) goes on the data volume with the most free space; the choice is recorded in `/etc/geldar/placement/<id>` and reused for `restart` and `remove`. A volume below 10% free is skipped; all below it fails the job with a clear message.
6. **Remove.** `remove` stops the group, archives nothing on GitHub (the repo is the memory and stays), deletes the player's state directories on the VM and the token and key files, and leaves a line in `/var/log/geldar-hosts.log`.
7. **Trigger source.** Something on the registration side calls the GitHub API (`workflow_dispatch`) when a roster entry is added or deleted. That caller, and its credential, belong to geldar-registration and geldar-93; this campaign only provides the workflow and a documented contract.
8. **Failure.** Every verb is idempotent: `add` on an existing player is a no-op that reports the placement; `remove` on a missing one succeeds.

## Cards

Each card is for a Haiku coder at about 40k tokens. All edit only the files named; none touches a live player until F-08.

| Card | Title | Depends on |
|---|---|---|
| F-01 | VM bootstrap script and docs (reproducible from a clean Debian image: Docker, data volumes by label, `geldar-runner`, `/etc/geldar`) | none |
| F-02 | `fleet/` scripts on the VM: `place.sh` (pick the volume), `add.sh`, `remove.sh`, `restart.sh`, each idempotent, with tests run against a fake docker and temp dirs | F-01 |
| F-03 | Launcher verbs `host-add`, `host-remove` that call the scripts over ssh (operator side, both launchers) | F-02 |
| F-04 | The `deploy-player` workflow, `workflow_dispatch` only, with a repo test that fails if any other trigger or any secret input appears | F-02 |
| F-05 | Runner install and hardening doc and script (separate account, no sudo, labels) and a check that the account cannot read other homes | F-01 |
| F-06 | Registration contract doc: the exact `workflow_dispatch` call, its inputs, expected results and the failure table, for geldar-registration | F-04 |
| F-07 | Migration runbook and script: move a running ranger or Picard from the desktop (volumes, deploy key, token, kit version) one at a time with recreate times | F-02 |
| F-08 | Migration run (operator, not a coder): Picard and the six first, one at a time, in a window geldar-93 confirms; the seven new players are created on the VM | F-07, window |

## Decisions assumed (orchestrator, under the owner's delegation)

- D-FL-01: the VM, not the desktop, is the only place new persistent players run.
- D-FL-02: provisioning stays off the VM; the VM never holds a repo-admin credential.
- D-FL-03: placement is by free space at `add` time and then fixed for that player.
- D-FL-04: remove deletes data on the VM only; the player repo on GitHub is untouched.
