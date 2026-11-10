# Retro: wave 7 (players, port 18443, dev override)

Written 2026-11-10. PR #14 merged to `main` (head 8329fbc, CI green on all nine jobs plus the image scan). Previous retro: [retro-wave-6.md](retro-wave-6.md).

## What shipped

- SC-76: the launcher accepts a non-default MCP port only when it equals `mcp_port`; Squid has a `world_port` rule (CONNECT to port 80 refused).
- SC-75: `GELDAR_DEV_MCP_URL` dev override, owner environment only, never reaches the container.
- SC-74: `new --persona-dir`, owner-only, seeds identity.md and goals.md (caps 8192 and 4096 bytes, chosen), commit subject `player: <id>`.
- SC-78: knowledge-boundary, sleep-at-night and choose-an-intent lines in the player prompt, with a test.
- SC-71b skills generator, SC-77a twin-drift check, SC-77b Linux container recipe.
- Held: SC-70a to 70d (D1 now chosen, decision 44), SC-71a/c, SC-72a to c (owner acceptance), SC-73.

## What went well

- Gate packets first let the wave fan out early. Wave-end review plus CI found real defects: bad dev URL refused only after docker work, an empty `--persona-dir` creating an unseeded public player, a PowerShell empty-port allowlist, an unbounded read before the size cap, and twin order drift.
- Both reviewers ran real things (a Squid container, 33 hostile URLs through both twins) instead of only reading.
- The merged wave went green in one push after the fix pass.

## What cost time

| Finding | Evidence | Cost |
|---|---|---|
| Fixers hit their context cap before committing (launcher fixer twice, the tests coder once) | no commit, edits left in a worktree, resumed with "commit now" | Two extra dispatches |
| Briefs gave one fixer too many items across code, twins and tests | the launcher fixer finished code but no tests | Split into three agents |
| Two coders fixed the same suite defects (SC-75b and 75c) | merge conflict in `devworld-suite.ts`, resolved by hand | Orchestrator time |
| Coders wrote files into the main checkout (SC-74c, SC-78) and committed a report file | verified with `git status`, `git rm --cached` | Cleanup |
| Twin disagreement (`birth:` vs `player:`) and validation order | caught only by the wave review | Fix pass |
| Spec reviewer hit its 60-turn limit with no output | needed a nudge to report | One wait |
| SC-77b used four test runs, over the cap | rule 21 | Time |
| Subagents named their own model in trailers, giving mixed attribution | history has Sonnet and Haiku lines | Cosmetic |
| Linux-only cases (bash persona, devworld, mcpport, Squid) still decided only by CI | no local run | Waited on CI |

## Process changes

| Change | Answers |
|---|---|
| Slice fixer briefs to one area and at most five items; tests in a separate dispatch from code | Context-cap stops |
| Brief says "commit after each numbered step" from the start | Uncommitted work |
| Every twin behaviour change lists the expected first error for both twins in its card | Order drift |
| A shared-suite fix goes to one packet only, noted in the fan-out table | Duplicate fixes |
| Give the reviewer a turn budget in the brief and ask for an early interim report | Silent turn-limit stops |
| Put the exact trailer text in every brief so agents do not substitute their own model name | Mixed attribution |

## Open items

See `overnight-decisions.md` (43: template wording against decision 40, hard links in `--persona-dir`; 42: host binding for SC-73), `RESUME.md`, and the owner list in the ledger. Worktree folders under `.claude/worktrees/` still hold `node_modules` links: remove the links before deleting (rule 24).
