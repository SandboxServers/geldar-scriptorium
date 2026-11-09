# Scriptorium: resume card

Read this, then [README.md](README.md) (the ledger), before acting. Rewrite at every wave boundary, in 40 lines at most.

**State (2026-11-08):** waves 0, 1 and 2 are merged to `main` (PRs #1, #2, #4); `main` passes the full check; wave 0-2 worktrees and branches are removed. Wave 4 (the kit image, SC-40 to SC-42) is starting: branch `scriptorium/wave4` is created from `main` and pushed, its packets are now written in full (work-packets-wave4.md) and the spec review is in progress (fixes from review 1 applied). The kit's decisions (geldar 0007-0016) are in geldar PR #3, owned by the planning session; don't touch it or geldar `docs/decisions/`.

**Next action:**

1. Write wave 4 in full: dispatch a Sonnet packet-writer agent (as for wave 2: brief it with the scope cards in `work-packets.md` § Wave 4, the carried-over requirements, and that Docker 29.1.3 is installed locally so digests and behavior can be verified for real). It must pin the Claude Code CLI (npm `@anthropic-ai/claude-code`, at least 2.1.257 and at least 2 weeks old) and image digests, and flag anything needing an owner call (for example whether `/permissions` can run without a login). Then spec-review the packets (fresh Sonnet reviewers, up to 3 passes) before dispatching any coder.
2. Wave 3 (the mock world, repo G, SC-30 to SC-33) builds in the geldar repo, where another session runs its own campaign: geldar `origin/main` now has `contract/` (`@geldar/contract`). Ask the owner before writing there; waves 3 and 4 are independent.
3. Every wave closes with docs, a retro and process changes (skill § 6, dispatch rule 15); retro so far `worknotes/retro-waves-0-2.md`, whose "Proposed next" list (merge helper, ledger helper, spec lint incl. control characters, shared git runner, fixture helper) is the first process work.
4. **Compact the conversation at each wave boundary and when the owner asks** (the orchestrator cannot run `/compact`: ask the owner to). Everything needed is in this folder.

**Agents:** `.claude/agents/` exists. Dispatch with the Agent tool as `general-purpose` (coders `haiku`, reviewers `sonnet`, packet writers and docs `sonnet`), pasting the agent rules into each brief. Haiku coders often hit the context cap near 90k: tell them to write a stub report first and commit as soon as checks pass (rule 12).

**Follow-ups (not blocking):**

- Dedupe `tests/template/skills.test.ts` and `world-skills.test.ts`.
- Threat model: control row for "other players' data" once the MCP servers exist.
- Dependabot header comment names directories this repo doesn't have.
- `geldar-git` and `geldar-verify` run-git wrappers drifted (shared module); fixtures lack `--no-replace-objects`; `verify` args accept `--mode=a --mode=b`.
- Confirm no one commits the untracked `.agents/` and `.codex/` folders.

**Open owner decisions:** D-SC-05 (license; `LICENSE` absent), D-SC-06 (GHCR visibility; repo is public so public images are the easy answer), D-SC-08 (Codex terms). Accepted since last card: D-SC-01 (no CI API key; live checks are local only), D-SC-02 (`geldar-bot` via Key Vault OIDC), D-SC-07, D-SC-14.

**Worktrees:** none.
