# Scriptorium: resume card

Read this, then [README.md](README.md) (the ledger), before acting. Rewrite at every wave boundary, in 40 lines at most.

**State (2026-11-09):** waves 0 to 4 are on `main`. Wave 5 (launcher in bash and PowerShell, stub CLI over HTTP, end-to-end on the in-test world and the mock image) is Done on `scriptorium/wave5`, PR #12. Docs, [retro-wave-5.md](worknotes/retro-wave-5.md) and rules 19 to 23 are in the wave. Read the final Linux CI run on PR #12 before merging; the Linux-only cases (H-16 case 5, timing tests, e2e) run only there. The launcher is described in [launcher/README.md](../../../launcher/README.md).

**Next action:**

1. Merge PR #12 on a green CI. Remove worktrees. Ask the owner to `/compact`.
2. Write the Wave 6 and Wave 7 cards, opening with a fan-out plan (rule 22): small gate packets, then the parallel set, then the join.
3. SC-63a: template publish on a `kit-v*` tag (Azure OIDC, `geldar-bot` key from Key Vault). A publish needs a tag push; do not push a tag without the owner's go-ahead.
4. SC-60 hostile tests, including the case-fold start-tree collision check (decision 28) and security review items N3, N4, N6, N8 (see the retro).
5. Process follow-ups from the retro's "Proposed next": parity.ts merges, shared test-path helper, H-16 fixture on Windows git.

**Open owner items:**

- Codex calls C1 to C8 ([codex-parity.md](worknotes/codex-parity.md)); C1 and C3 gate SC-71 (D-SC-08).
- The real MCP host name (`mcp_base`) and the `private_only_shards` values in `launcher/config/world.conf` (SC-72).
- Spec section 7 amendment for the case-fold rule, per geldar decision 0042.
- Optional: swap Apache-2.0 (D-SC-05).
- The mock image GHCR package was first pushed private; the ledger says an org admin must make it public (D-SC-06).

**Standing process rules** (full text: dispatch rules 1 to 23 in [work-packets.md](work-packets.md)):

- Coders run their packet's tests once; timing tests run in CI only (19); no watcher loops (20); no broad process kills (18).
- Packets merge with `merge-packet --no-check`; one full check, then the wave review, then fix passes at wave end (21). Never two full checks at once.
- A behavior change needs a test that fails when reverted. Coders report run count and untested late edits (23).
- Docker packets use `KIT_IMAGE=geldar-kit:<packet>` (17). Own-org images may be pinned by digest without the age wait (decision 27).
- Dispatch agents as `general-purpose` (coders `haiku` or `sonnet`; reviewers, writers and docs `sonnet`), pasting the agent rules into each brief.

**Worktrees:** run `git worktree list`. Expect the main checkout plus live packet worktrees only; remove the rest with `git worktree remove` (including `.claude/worktrees/docs5` and the `fix-*` ones after their merge). Do not touch the geldar repo.
