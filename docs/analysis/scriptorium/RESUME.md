# Scriptorium: resume card

Read this, then [README.md](README.md) (the ledger), before acting. Rewrite at every wave boundary, in 40 lines at most.

**State (2026-11-08):** wave 0 (SC-01 to SC-05) is done and merged into `scriptorium/wave0`; every packet passed its own review. The wave review (pass 1) returned `fix`; the fixes are on branch `scriptorium/wave0-fix` (worktree `.claude/worktrees/wave0-fix`) and need a re-review before they merge into `scriptorium/wave0`. The kit's decisions (geldar 0007–0016) are in geldar PR #3, owned by the planning session; don't touch it or geldar `docs/decisions/`.

**Current wave:** 0 closing. Wave 1 (the template, SC-10 to SC-16) starts after wave 0 merges to `main`.

**Next action:**

1. Re-review `scriptorium/wave0-fix` (wave review pass 2, fresh Sonnet reviewer). On `ship`, merge it `--no-ff` into `scriptorium/wave0` and push.
2. Open one PR from `scriptorium/wave0` to `main` (ship-pr skill, body ends with the attribution footer). Then stop and wait: merge only when the owner says so.
3. After the merge: remove the sc-01..sc-05 and wave0-fix worktrees and branches, rewrite this card for wave 1.
4. Wave 1 is already written in `work-packets.md`. SC-12, SC-15 and SC-16 wait on D-SC-07 being marked Accepted.

**Agents:** `.claude/agents/` now exists (SC-03). Until a session has them loaded, dispatch with the Agent tool as `general-purpose` (coders `haiku`, reviewers `sonnet`), pasting the rules from the agent files into each brief.

**Rulings so far:** `worknotes/SC-04.md` (decisions index lists 0007–0015; add 0016 when it lands in geldar).

**Follow-ups (not blocking wave 0):**

- The packet that adds `tests/template/check.ts` must also add the `check:template` script.
- Threat model: add a control row for "other players' data" once the kit's MCP servers exist.
- Dependabot header comment names directories this repo doesn't have.
- Add the 0016 line to `docs/decisions.md` when geldar PR #3 lands.

**Open owner decisions:** D-SC-01 (CI API key), D-SC-02 (template publish credential), D-SC-05 (license; `LICENSE` is absent until then), D-SC-06 (GHCR visibility), D-SC-08 (Codex terms).

**Worktrees:** sc-01..sc-05 (all merged, remove after the PR merges), wave0-fix.
