# Scriptorium: resume card

Read this, then [README.md](README.md) (the ledger) and [worknotes/overnight-decisions.md](worknotes/overnight-decisions.md) (decisions 1 to 34), before acting. Rewrite at every wave boundary, in 40 lines at most.

**State (2026-11-10):** waves 0 to 5 are on `main`. **Wave 6 is on `scriptorium/wave6`, PR #13; CI is green on head 9b01530 and the retro is [worknotes/retro-wave-6.md](worknotes/retro-wave-6.md).** Every packet that needs no owner decision is merged. Held on owner decisions: SC-62b, SC-62c (live check), SC-63i (release docs). Linux CI is parallel (`static`, a `tests` matrix of 5 groups, two `e2e` jobs, `ci gate`; about 12 min).

**Next actions**
1. Wave 6 close: merge PR #13 on green CI, then remove worktrees safely (rule 24: delete junctions first; never `git worktree remove --force` on a tree with links). SC-62b/62c/63i wait for owner decisions (below).
3. Wave 7 (cards are scope only): SC-70 Patron guide, SC-71 Codex (gated D-SC-08, owner calls C1 and C3), SC-72 acceptance (six players), SC-73 campaign review, SC-74 `new --persona-dir`, SC-75 local-world dev override, SC-76 world port 18443. Write full cards with a fan-out plan (rule 22), spec-review them, then build.
4. At campaign end: full campaign retro (owner instruction), final RESUME rewrite, cleanup of Docker scratch images and leftover worktree folders.

**Process rules in force (work-packets.md rules 12 to 24):** coders run only their own tests once and commit at once; no full check per packet; wave-end review plus CI is the gate (`merge-packet --no-check`); timing and load-flaky tests run in CI only (`timingIt`); no watcher loops; one full check at a time; no junctions between worktrees; fan-out slicing. Agents often stop with uncommitted work: check `git status` in their worktree and resume them with "commit now". Chain merge, ledger and push with `&&` and resolve `parity.ts` conflicts by hand.

**Owner decisions pending:** live-check login and vendor terms (SC-62), held-session strictness, first `kit-v*` tag plan (rehearsal or real), tag-creation ruleset, public GHCR package and template branch rule for the bot, confirm decision 30 (Node 22.23.4 waiver of the 14-day pin for a KEV-listed CVE; libcurl removed), confirm decisions 27 and 29 to 34, Codex C1 to C8, spec section 7 amendment (geldar 0042), wording of geldar records 0044 to 0046.

**Geldar coordination (peer `geldar-0a`; never edit the geldar repo):** six Power Rangers as first players (ids ag-jason-01, ag-zack-01, ag-billy-01, ag-trini-01, ag-kimberly-01, ag-tommy-01; persona seeds drafted on the geldar side, owner approval pending). Real MCP: `/p/<player_id>`, static bearer per player (geldar mints tokens), `wait` max_seconds at most 240. Public name `geldar.sandboxservers.games` exists (A record to the Colo node5 address, TTL 300; the address is deliberately not written here). MCP port 18443 over TLS: the owner added the UniFi forward (it was created for all WAN addresses and TCP plus UDP; owner may narrow it); a Caddy site on the Colo host is still needed; SC-76 makes the launcher accept the port only when `mcp_port` in `launcher/config/world.conf` equals it. Owner-set `mcp_base` and `private_only_shards` are still blank. Pending to send geldar: the per-blob cap note (`worknotes/geldar-record-blob-cap.md`) and the port plan once the owner confirms.

**Worktrees:** many folders remain under `.claude/worktrees/`; git has deregistered most. Do not delete them recursively until their `node_modules` links are removed.
