# Scriptorium: resume card

Read this, then [README.md](README.md) (the ledger) and [worknotes/overnight-decisions.md](worknotes/overnight-decisions.md) (decisions 1 to 34), before acting. Rewrite at every wave boundary, in 40 lines at most.

**State (2026-11-10):** waves 0 to 6 are on `main` (PR #13 merged; retro [worknotes/retro-wave-6.md](worknotes/retro-wave-6.md)). **Wave 7 cards are written** in [work-packets-wave7.md](work-packets-wave7.md) and [work-packets-wave7b.md](work-packets-wave7b.md) and were adversarially spec-reviewed (verdict "fix"; fixes applied on `scriptorium/w7-cards2`). Nothing of wave 7 is built. Held on owner decisions: SC-62b, SC-62c (live check), SC-63i (release docs), SC-70a (D1), SC-71a (D3), SC-71c (C1, C3).

**Next actions**
1. Merge the card fixes into `scriptorium/wave7`. Re-read the fan-out plan (step 1: SC-76a, SC-76b, SC-74a, SC-75a, SC-71b, SC-77a, SC-77b; SC-70a once D1 is chosen).
2. Ask geldar P3 (does the birth event depend on the `birth:` commit or the identity headings) before SC-74b/c.
3. Dispatch step 1, then SC-76c/d, then SC-74b/c and SC-75b/c, then SC-70b and SC-70d, then the owner acceptance (SC-72), SC-70c, SC-73.
4. At campaign end: full campaign retro (owner instruction), final RESUME rewrite, cleanup of Docker scratch images and leftover worktree folders.

**Process rules in force (work-packets.md rules 12 to 24):** coders run only their own tests once and commit at once; no full check per packet; wave-end review plus CI is the gate (`merge-packet --no-check`); timing and load-flaky tests run in CI only (`timingIt`); no watcher loops; one full check at a time; no junctions between worktrees (rule 24: delete junctions before removing a worktree; never `git worktree remove --force` on a tree with links); fan-out slicing. Agents often stop with uncommitted work: check `git status` in their worktree and resume them with "commit now". Resolve `parity.ts` conflicts by hand.

**Owner answers (2026-11-10):** P1: `new --persona-dir` is an owner provisioning tool for the six Rangers only, never in the Patron guide or `template/`. D1: the launcher is downloaded from a GitHub release; still open is how the guide points to it without the template naming this repo.

**Owner decisions pending:** D1 (guide pointer), D2 (`mcp_base`, `mcp_port`, `private_only_shards`, set before the first `new`), D3 (run pinned Codex in a throwaway container), D4 to D7, Codex C1 to C8, live-check login and vendor terms, held-session strictness, first `kit-v*` tag plan, tag-creation ruleset, public GHCR package and template branch rule for the bot, confirm decisions 27 to 34 (30: Node 22.23.4 waiver), spec section 7 amendment (geldar 0042), wording of geldar records 0044 to 0046.

**Geldar coordination (peer `geldar-0a`; never edit the geldar repo):** six Power Rangers as first players (ids ag-jason-01, ag-zack-01, ag-billy-01, ag-trini-01, ag-kimberly-01, ag-tommy-01; persona seeds drafted on the geldar side, owner approval pending). Real MCP: `/p/<player_id>`, static bearer per player, `wait` max_seconds at most 240. Public name `geldar.sandboxservers.games` exists (address deliberately not written here). MCP port 18443 over TLS: UniFi forward added; a Caddy site is still needed; SC-76 makes the launcher accept the port only when `mcp_port` equals it. `mcp_base`, `mcp_port`, `private_only_shards` are blank. Pending to send geldar: the per-blob cap note (`worknotes/geldar-record-blob-cap.md`), the port plan, and ask P3.

**Worktrees:** many folders remain under `.claude/worktrees/`; git has deregistered most. Do not delete them recursively until their `node_modules` links are removed.
