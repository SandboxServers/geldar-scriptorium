# Scriptorium: resume card

Read this, then [README.md](README.md) (the ledger), before acting. Rewrite at every wave boundary, in 40 lines at most.

**State (2026-11-08):** waves 0 and 1 are merged to `main` (PRs #1, #2). Wave 2 (companion servers and the gate, SC-20 to SC-24b) is done and in PR #4 (`scriptorium/wave2` to `main`): every packet passed its own review, the wave review fixes are applied, the docs pass and retro are in, CI is green. The kit's decisions (geldar 0007-0016) are in geldar PR #3, owned by the planning session; don't touch it or geldar `docs/decisions/`.

**Next action:**

1. PR #4: confirm `ci gate` is green on the latest push, take it out of draft (`gh pr ready 4`) and merge (`gh pr merge 4 --merge --delete-branch`; the owner authorised merging once ready). Then remove the sc-20..sc-24b, wave2-fix and wave2-docs worktrees and branches.
2. Wave 3 (the mock world, repo G, SC-30 to SC-33) needs geldar P0-01 (`@geldar/contract`): check geldar `origin/main` first. Wave 4 (kit image, SC-40 to SC-42) needs only wave 2 and can start now. Write the chosen wave's scope cards out in full in `work-packets.md` first, and spec-review them before dispatch (this paid off in wave 2).
3. Every wave closes with docs, a retro and process changes (skill § 6, dispatch rule 15). Retro so far: `worknotes/retro-waves-0-2.md`; its "Proposed next" list (merge helper, ledger helper, spec lint incl. control characters, shared git runner, fixture helper) is the first process work for wave 3 or 4.

**Agents:** `.claude/agents/` exists. Dispatch with the Agent tool as `general-purpose` (coders `haiku`, reviewers `sonnet`, packet writers and docs `sonnet`), pasting the agent rules into each brief. Haiku coders often hit the context cap near 90k: tell them to write a stub report first and commit as soon as checks pass (rule 12).

**Follow-ups (not blocking):**

- Dedupe `tests/template/skills.test.ts` and `world-skills.test.ts`.
- Threat model: control row for "other players' data" once the MCP servers exist.
- Dependabot header comment names directories this repo doesn't have.
- `geldar-git` and `geldar-verify` run-git wrappers drifted (shared module); fixtures lack `--no-replace-objects`; `verify` args accept `--mode=a --mode=b`.
- Confirm no one commits the untracked `.agents/` and `.codex/` folders.

**Open owner decisions:** D-SC-01 (CI API key), D-SC-05 (license; `LICENSE` absent), D-SC-06 (GHCR visibility; repo is public so public images are the easy answer), D-SC-08 (Codex terms). Accepted since last card: D-SC-02 (`geldar-bot` via Key Vault OIDC), D-SC-07, D-SC-14.

**Worktrees:** sc-20..sc-24b, wave2-fix, wave2-docs (all merged, remove after PR #4 merges).
