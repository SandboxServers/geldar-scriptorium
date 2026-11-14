# Fleet RESUME (session geldar-fleet)

Updated 2026-11-14.

## State
- Campaign taken over from scriptorium-orchestrator (handover scope: pending his reply).
- Plan PR #110 (branch scriptorium/fleet-campaign): README and full packets F-01a..F-11 (work-packets.md), two review passes applied.
- Working branch fleet/plan (worktree .claude/worktrees/fleet-plan) off that branch.

## Known issues to fold into cards
1. Compose `secrets: uid/mode` ignored outside Swarm: keeper (uid 1002) cannot read a 0600 deploy key; interim chown in the wrapper (F-05b) until F-11 R-4.
2. Debian 12 git 2.39, launcher needs a newer git; git 2.47.1 built on VM -> F-01a bootstrap.
3. VM fixed address: ask owner.
4. UniFi policy "Geldar hosts VM to Colo MCP (443)" EXISTS (VM -> Colo TCP 443, applied 2026-11-14; ace.firewall_policy short_id 2; backup /data/firewall_policy-backup-20261114.json; undo: delete the doc, re-provision by restarting unifi and zeroing the udm cfgversion). Record as existing manual infra step with undo; request geldar-93 only for NEW rules.
5. Owner question: DHCP reservation for the VM (recommended option first).
6. Bodies stay on Colo; MCP address is the public name reached from the VM.

## Next
- Owner ruled D-FL-NN (runner sudoes one wrapper, launcher runs as geldar); orchestrator answers F-11 R-1..R-5; fill D-FL-06/07/10, launcher URL, allow-list line, CODEOWNERS handle. Then dispatch coders (packet-coder) in worktrees, ops agent for PR/CI.
- Coordinate with geldar-registration (no GitHub token in register service), geldar-93 (F-08 timing).
