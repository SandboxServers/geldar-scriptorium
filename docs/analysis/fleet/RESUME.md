# Fleet RESUME (session geldar-fleet)

Updated 2026-11-14.

## State
- Campaign taken over from scriptorium-orchestrator (handover scope: pending his reply).
- Plan PR #110 (branch scriptorium/fleet-campaign): README with cards F-01..F-08. Full packets not written.
- Working branch fleet/plan (worktree .claude/worktrees/fleet-plan) off that branch.

## Known issues to fold into cards
1. Compose `secrets: uid/mode` ignored outside Swarm: keeper (uid 1002) cannot read a 0600 deploy key; interim chown on VM -> card.
2. Debian 12 git 2.39, launcher needs >= 2.40; git 2.47.1 built on VM -> F-01 bootstrap.
3. VM fixed address: ask owner.
4. UniFi policy "Geldar hosts VM to Colo MCP (443)" (VM 192.168.1.10 -> Colo TCP 443); manual infra step via geldar-93; policy backup on gateway /data/firewall_policy-backup-20261114.json.

## Next
- Write packets F-01..F-08, review, dispatch coders (packet-coder) in worktrees, ops agent for PR/CI.
- Coordinate with geldar-registration (no GitHub token in register service), geldar-93 (F-08 timing).
