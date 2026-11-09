# Scriptorium: resume card

Read this, then [README.md](README.md) (the ledger), before acting. Rewrite at every wave boundary, in 40 lines at most.

**State (2026-11-09):** waves 0, 1, 2 and 4 are merged to `main` (PRs #1, #2, #4, #5); CI on PR #5 ran the Linux-only image suites green. Wave 3 (mock world, geldar repo) has not started. The docs pass, [retro-wave-4.md](worknotes/retro-wave-4.md) and dispatch rules 16 and 17 are in the wave. The kit's decisions (geldar 0007-0016) are in geldar PR #3, owned by the planning session; don't touch it or geldar `docs/decisions/`.

**Next action:**

1. Finish wave 4: wave review (fresh `packet-reviewer`), fix passes, open the PR from `scriptorium/wave4` and read the Linux CI log (the Docker tests must have run, not skipped), merge on a green `check` on the wave branch (rule 16), remove worktrees.
2. Then rewrite this card and ask the owner to `/compact`.
3. Wave 3 (mock world, repo G, SC-30a to SC-33) is not started. Readiness: geldar PR #3 (decisions 0007-0016) is still open; `contract/` on geldar `main` has `@geldar/contract` but lacks the `mcp-*` schemas; the Wave 3 cards follow the spec's intent model. Ask the owner before writing in the geldar repo.
4. Process work from the retro's "Proposed next": merge-packet helper that gates on a green wave-branch check, ledger helper, spec lint, shared git runner, fixture helper, and why a check inside a worktree passes while the wave branch fails.
5. Wave 5 (launcher) cards are written in full once wave 4 closes.

**Agents:** dispatch with the Agent tool as `general-purpose` (coders `haiku` for small packets, `sonnet` for packets with a CLI-behavior test matrix; reviewers, packet writers and docs `sonnet`), pasting the agent rules into each brief. Haiku coders often hit the context cap near 90k: stub report first, commit as soon as checks pass (rule 12). Docker packets use `KIT_IMAGE=geldar-kit:<packet>` (rule 17).

**Follow-ups (not blocking):**

- Dedupe `tests/template/skills.test.ts` and `world-skills.test.ts`.
- Threat model: control row for "other players' data" once the MCP servers exist.
- Dependabot header comment names directories this repo doesn't have.
- `geldar-git` and `geldar-verify` run-git wrappers drifted; fixtures lack `--no-replace-objects`; `verify` args accept `--mode=a --mode=b`.
- H-20 live deny check is SC-62 (local only); until it runs, H-20 is structural only.
- Confirm no one commits the untracked `.agents/` and `.codex/` folders.

**Open owner decisions:** D-SC-08 (Codex: direction set, parity with Claude where possible; terms and MCP support under research). Settled: D-SC-05 (Apache-2.0), D-SC-06 (public GHCR), D-SC-01 (no CI API key; live checks local only), D-SC-02, D-SC-07, D-SC-14.

**Worktrees:** none expected; check `git worktree list`.
