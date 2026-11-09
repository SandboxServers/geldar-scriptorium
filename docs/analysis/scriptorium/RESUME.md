# Scriptorium: resume card

Read this, then [README.md](README.md) (the ledger), before acting. Rewrite at every wave boundary, in 40 lines at most.

**State (2026-11-08):** campaign planned. The ledger and packets are on branch `docs/scriptorium-campaign` and haven't been dispatched yet. This repo has only a README on `main`. The kit's decisions (geldar 0007–0016) are in geldar PR #3, which the planning session owns and is still finishing; don't touch it.

**Current wave:** 0, the repo itself (SC-01 to SC-05).

**Agents until SC-03 lands:** this repo has no `.claude/agents/` yet. Dispatch packets with the Agent tool as `general-purpose`, `model: haiku`. Paste the rules from geldar `origin/main:.claude/agents/packet-coder.md` (or `packet-reviewer.md`) into each brief, with `geldar.ps1` read as `scriptorium.ps1`. SC-05 runs on Sonnet.

**Next action:**

1. Create `scriptorium/wave0` from `docs/scriptorium-campaign`, so the campaign docs ship with wave 0, and push it.
2. Dispatch SC-01 (worktree `.claude/worktrees/sc-01`, branched from `scriptorium/wave0`).
3. When SC-01 has review verdict `ship`, merge it into `scriptorium/wave0`, then dispatch SC-02, SC-03, SC-04 and SC-05 in parallel.
4. Wave review, then one PR from `scriptorium/wave0` to `main`. Merge only when the owner says so.
5. Write out wave 1 in full only if `work-packets.md` needs changes after wave 0. It's already written; SC-12, SC-15 and SC-16 wait on D-SC-07 being marked Accepted.

**Open owner decisions:** D-SC-01 (CI API key), D-SC-02 (template publish credential), D-SC-05 (license), D-SC-06 (GHCR visibility), D-SC-08 (Codex terms). None block wave 0 except the `LICENSE` file.

**Worktrees:** none.
