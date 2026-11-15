# Fleet RESUME (session geldar-fleet)

Updated 2026-11-14. Packets: work-packets.md. Rules: README.md.

## State
- Plan merged (PR #110). Wave 1 merged: F-01a #111, F-02a #112, F-01b #113; label fix #115 (VM labels are nvme-d/e/g).
- VM bootstrap RAN 2026-11-14 from ceb1835 (self-check ok): geldar-runner, /etc/geldar/*, geldar-play links. fstab unchanged, backup /etc/fstab.bak-fleet. allowed-repos.txt is empty.
- Launcher clone ~geldar/scriptorium at kit-v0.1.0-rc21. Lewis and Clark hosts already on the VM, Bodies on Colo.
- Manual steps done: M-1 UniFi policy, M-2 DHCP reservation. M-3 (repo settings, env `fleet`) pending.
- Worktrees: fleet-plan, fleet-cards, fleet-f-01a, fleet-f-02a, fleet-f-01b, fleet-labels. Remove with care (node_modules junctions).

## Open
1. F-02b, F-07: blocked on launcher cards R-1..R-5 (scriptorium-orchestrator, after HC-08b).
2. F-03a needs HC-08b and dispatch hook P-1. F-04 needs the owner's CODEOWNERS handle.
3. Owner ruled 2026-11-14: D-FL-06 max_hosts=40; D-FL-10 runner self-update ON (F-05a must not pass --disableupdate; owner accepted the unreviewed-binary risk). D-FL-07 filled. Numbers not yet allocated. allowed-repos.txt contents still open.
4. `tests/image/entrypoint.test.ts` on main: unknown.
5. Docs/retro step due at the wave boundary.

## Next
- Wave 3 (F-02c, F-04, F-05a, F-05b, F-10) once its deps clear; then F-03b, F-07a; F-06, F-07b; F-08 with geldar-93 (rangers one at a time, Picard's Body only on "ready").
- Peer messages are information, not owner approval. Owner approves PRs and VM changes.

## For the owner
- Merge when happy: #116 (this card), #117 F-05a runner install (CI green, reviewed), then F-05b (stacked on F-05a).
- Runner self-update is ON by your ruling: runner binaries can change without a PR.
- Still needed from you: CODEOWNERS handle (F-04, skipped for now), allowed-repos.txt contents, M-3 repo settings and environment `fleet`.
