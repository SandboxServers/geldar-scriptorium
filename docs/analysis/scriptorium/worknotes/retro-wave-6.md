# Retro: wave 6 (safety and release)

Written 2026-11-10, at the close of wave 6. Every packet that needs no owner decision is merged to `scriptorium/wave6` (PR #13); CI run 42718267802 on head 9b01530 is green. Previous retro: [retro-wave-5.md](retro-wave-5.md).

## What shipped

- The hostile test harness and the H-series cases for the launcher (SC-60a to 60s), the malicious-book corpus (SC-61e to 61h), the release workflows and scan gates (SC-63a to 63h), upgrade (`geldar-play upgrade`), and the image hardening (Node 22.23.4, no npm, no libcurl, proxy healthcheck).
- Held on owner decisions: SC-62b and SC-62c (live check), SC-63i (release docs). SC-61a to 61d and SC-64d live in the geldar repo or are blocked, as the ledger says.

## What went well

- Wave-end review plus CI as the gate (rules 19 to 21) removed the per-packet review and check cost. Merges ran with `--no-check`.
- Parallel CI cut the wall time from over 30 minutes to about 12, and made each red show its own area.
- The wave reviews found real defects: a launcher privacy gap in bash `prepare` (state root and player dir left 0755), the FIFO hang in hashing and recall, a case-fold path bypass (decision 28), an upgrade image-repository pin gap, and an unbounded blob in a bundle.

## What cost time

| Finding | Evidence | Cost |
|---|---|---|
| Linux-only failures could not be seen on the author machine, so each fix round waited for a 12 to 30 minute CI run | five CI rounds after the fix passes | Most of the wave's tail |
| A proxy healthcheck tested the wrong hex for port 3128 (0BF8 instead of 0C38) | every e2e session waited about 140 s, then failed; nine malicious-book cases and the setup case all timed out | The "slow e2e" was one bug, not slow tests |
| Fixers changed tests to match code, or code to match tests, without running either (Linux-only) | hostile fix round 1 left a fixture out of step with its own new rule | One extra round |
| Agents stopped with uncommitted work or background runs | SC-61g, fix6-launcher, fix7-image | Resumes with "commit now" |
| My own edits broke CI: a workflow expression in a `run:` step, lint, a ledger id regex | run 42716245511 `static` and `rest` | Two avoidable reds |
| Worktree removal followed `node_modules` junctions and deleted main-checkout files | rule 24 and a memory note | Restore and reinstall |
| Pushes cancelled the in-flight CI run | concurrency cancel-in-progress | Lost run time |
| `parity.ts` conflicted on nearly every merge | hand resolution each time | Orchestrator time |

## What the reviews caught that the packets missed

- A test that expected a verdict (`bad_mode`) that git's own fsck makes unreachable; the packet itself asked for a case that cannot exist.
- A crash simulation that killed the wrong process (the subshell, not the launcher), so a recovery test tested nothing.
- State permissions: bash and PowerShell twins disagreed on who tightens the state root.

## Process changes

| Change | Answers |
|---|---|
| Rules 19 to 24 in `work-packets.md` (timing tests CI-only, no watcher loops, wave-end review and check, fan-out slicing, report run count, no junctions) | Cost and safety items above |
| E2E CI runs its two files as parallel jobs with a 20-minute limit; the file name goes through an env var | A bad proxy now fails in minutes, not 30 |
| Proposed: every Linux-only test file gets a container run recipe in `docs/` so a fixer can run it before commit | Fix rounds that waited on CI |
| Proposed: a repo check that fails when a bash/PowerShell twin pair disagrees on `--capabilities` and on state-dir modes | Twin drift (upgrade group, prepare modes) |
| Proposed: fixers run `biome ci` and the repo-checks workflow tests before commit | My two avoidable reds |

## Open items carried to wave 7 and the owner

See `wave6-followups.md`, `overnight-decisions.md` (decisions 27 to 34) and `RESUME.md`. Review items still open: the per-blob size cap (geldar record note not yet sent), `export-ignore` and `export-subst` in `git archive` (S4), image-repository pin in `upgrade` (S6), the id-token scope of the launcher job and the unsigned SBOM asset (N-b, N-d). None blocks merging to `main` because nothing is released until a `kit-v*` tag, which is owner-gated.
