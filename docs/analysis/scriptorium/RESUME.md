# Scriptorium: resume card

Read this, then [README.md](README.md) (the ledger), before acting. Rewrite at every wave boundary, in 40 lines at most.

**State (2026-11-08):** wave 0 is merged to `main` (PR #1). Wave 1 (the template, SC-10 to SC-16) is done and merged into `scriptorium/wave1`; every packet passed its own review, and the wave review fix (a docs note for SC-40/42) is applied. The wave 1 PR to `main` is the next step or already open: check `gh pr list`. The kit's decisions (geldar 0007-0016) are in geldar PR #3, owned by the planning session; don't touch it or geldar `docs/decisions/`.

**Next action:**

1. Wave 1 PR: wait for `ci gate`, merge with `gh pr merge --merge --delete-branch` (the owner authorised merging once ready), remove the sc-10..sc-16 worktrees and branches.
2. Wave 2 (companion servers and the gate, SC-20 to SC-24) is a scope card. Write it out in full in `work-packets.md` against what wave 1 merged, then dispatch (SC-20 first).

**Agents:** `.claude/agents/` exists. Dispatch with the Agent tool as `general-purpose` (coders `haiku`, reviewers `sonnet`), pasting the agent rules into each brief.

**Lessons:** parallel packets that edit `tests/template/allowed-files.ts` conflict on merge; resolve by hand, then run `./scriptorium.ps1 check` before committing. Hook tests need `jq` and skip locally without it; CI runs them (`CI=true` makes missing tools fail).

**Follow-ups (not blocking):**

- Dedupe `tests/template/skills.test.ts` and `world-skills.test.ts` (overlapping frontmatter checks).
- Threat model: add a control row for "other players' data" once the kit's MCP servers exist.
- Dependabot header comment names directories this repo doesn't have.
- Hook tests have never run locally (no jq); confirm they pass in CI on the wave 1 PR.
- CLI-home deny gap is recorded under SC-40 and SC-42.

**Open owner decisions:** D-SC-01 (CI API key), D-SC-02 (template publish credential), D-SC-05 (license; `LICENSE` is absent until then), D-SC-06 (GHCR visibility), D-SC-08 (Codex terms).

**Worktrees:** sc-10..sc-16 (all merged, remove after the PR merges).
