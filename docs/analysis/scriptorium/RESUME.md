# Scriptorium: resume card

Read this, then [README.md](README.md) (the ledger) and [worknotes/overnight-decisions.md](worknotes/overnight-decisions.md) (decisions 1 to 43), before acting. Rewrite at every wave boundary, in 40 lines at most.

**State (2026-11-10):** waves 0 to 6 are on `main` (PR #13 merged; retro [worknotes/retro-wave-6.md](worknotes/retro-wave-6.md)). Wave 7 PR #14 is merged to `main` (retro [worknotes/retro-wave-7.md](worknotes/retro-wave-7.md)); the rest of wave 7 continues on new branches. Cards are in [work-packets-wave7.md](work-packets-wave7.md) and [work-packets-wave7b.md](work-packets-wave7b.md).

**Built on wave 7:** SC-70a, SC-70b, SC-70d (PRs #16, #17, #19), SC-71b, SC-74a to c, SC-75a to c, SC-76a to d, SC-77a to b, SC-78. The wave review and the fix pass are done. CI is scoped by what changed and the slow test groups are sharded (docs/ci.md).

**Remaining on wave 7:** SC-71a and SC-71c (ON HOLD by the owner, decision 46), SC-72a to c (acceptance runs; need a published `kit-v*` release candidate, `mcp_base`, `mcp_port`, `private_only_shards`, the Caddy site), SC-70c (numbers from SC-72a/b), SC-73 (campaign review; also takes the wave 6 carry-overs: action pins, key-vault step outputs, `jq` skips, coverage join).

**Next actions**
1. Nothing is buildable without the owner. The clean-machine requirement is dropped (decision 49): SC-72a/b run on a dev machine and testers give feedback. When the owner provides the inputs above, run SC-72a and SC-72b (clean machines, only the README), then SC-72c, SC-70c, SC-73.
2. Small CI follow-up: rebalance shard `launcher-a` (about 9 min) using per-file timings from the next green run.
3. At campaign end: full campaign retro (owner instruction), final RESUME rewrite, cleanup of Docker scratch images and leftover worktree folders (remove `node_modules` links first).

**Process rules in force (work-packets.md rules 12 to 24):** coders run only their own tests once and commit at once; no full check per packet; wave-end review plus CI is the gate; timing and load-flaky tests run in CI only (`timingIt`); no watcher loops; one full check at a time; no junctions between worktrees (rule 24: delete junctions before removing a worktree; never `git worktree remove --force` on a tree with links). Agents often stop with uncommitted work: check `git status` in their worktree and resume them with "commit now". Resolve `parity.ts` conflicts by hand.

**Owner answers:** P1 (2026-11-10): `new --persona-dir` is an owner provisioning tool for the six Rangers only, never in the Patron guide or `template/`. P3 is answered: the world does not detect birth from the player repo (decision 37); the seeded commit subject is `player: <id>`. D1 (2026-11-10): the launcher is downloaded from a GitHub release; still open is how the guide points to it without the template naming this repo. D1 (2026-11-10): the launcher archive is attached to a release of `geldar-player-template`; the guide points to that release, never naming this repo (decision 44).

**Owner decisions pending:** D2 (`mcp_base`, `mcp_port`, `private_only_shards`, set before the first `new`), D3 (run pinned Codex in a throwaway container), D4 to D7, Codex C1 to C8, live-check login and vendor terms, held-session strictness, first `kit-v*` tag plan, tag-creation ruleset, public GHCR package and template branch rule for the bot, confirm decisions 27 to 34 (30: Node 22.23.4 waiver), spec section 7 amendment (geldar 0042), wording of geldar records 0044 to 0046. Decision 42 (host in `player.json`, SC-73) and decision 43 (open calls) are open too.

**Geldar coordination (peer `geldar-0a`; never edit the geldar repo):** six Power Rangers as first players (ids ag-jason-01, ag-zack-01, ag-billy-01, ag-trini-01, ag-kimberly-01, ag-tommy-01; persona seeds drafted on the geldar side, owner approval pending). Real MCP: `/p/<player_id>`, static bearer per player, `wait` max_seconds at most 240. Public name `geldar.sandboxservers.games` exists (address deliberately not written here). MCP port 18443 over TLS: UniFi forward added; a Caddy site is still needed; SC-76 makes the launcher accept the port only when `mcp_port` equals it. `mcp_base`, `mcp_port`, `private_only_shards` are blank. Persona byte caps (decision 43): the launcher keeps 8192 and 4096 bytes; geldar matches the launcher. Pending to send geldar: the per-blob cap note (`worknotes/geldar-record-blob-cap.md`) and the port plan.

**Worktrees:** many folders remain under `.claude/worktrees/`; git has deregistered most. Do not delete them recursively until their `node_modules` links are removed.
