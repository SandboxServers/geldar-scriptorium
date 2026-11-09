# Retro: waves 0 to 2

Written 2026-11-08, at the close of wave 2. Waves 0 and 1 are merged to `main` (PRs #1 and #2); wave 2 is in draft PR #4. From wave 3 on, each wave gets its own retro (campaign-packet skill § 6).

## What went well

- **Review caught real defects before merge.** Adversarial reviewers that ran their own attacks found, among others: a `git` replace-ref bypass of the commit allowlist (SC-22a, severe); a filter-driver code execution path in the spec itself (spec review 1); hostile filenames that would block every save (spec review 2); an unguarded `--no-replace-objects` flag (SC-23b). The SC-20 packet review also tried its own hostile inputs against the merged path rule and shipped it on pass 1 (report: `SC-20-review-1.md`); spec review 3 separately evaluated all 73 table rows of the SC-20 spec against a scratch implementation.
- **Spec review before dispatch paid for itself.** Three review passes on the wave 2 packets caught the filter-driver redesign, corrupted newlines in the spec text, a broken ledger table, and size problems, all before a coder spent a session.
- **Fan-out worked.** SC-21, SC-22a and SC-23a ran in parallel after SC-20; merges were mostly clean once shared files were handled.
- **Draft PR for Linux CI.** The Linux-only SC-22a tests ran in CI on the wave PR (CI run 42554138928 on draft PR #4: `packages/git/src/commit.test.ts` 15 tests passed, 29 test files passed, none skipped), closing the gap that the author machine cannot run them.

## What cost time or tokens

| Finding | Evidence | Cost |
|---|---|---|
| Haiku coders ran out of context before committing or writing the report | SC-22a (first session and continuation), SC-23a, SC-23b (first session and continuation), SC-24a all returned at 86k-102k tokens against a 75k budget (agent usage counts). The SC-22a first session and the SC-23b first session left uncommitted work; the orchestrator committed SC-22a and SC-23a after re-running the check | Extra continuation sessions; lost reports |
| The 75k budget is unrealistic for packets with a fixture, a matrix of tests and revert checks | SC-22a, SC-23a/b, SC-24a | Most wave 2 packets needed a continuation or a fix pass |
| Parallel packets conflict on shared files | `tests/template/allowed-files.ts` (waves 1, 2), `pnpm-lock.yaml` (wave 2), `skills.test.ts` (SC-13/SC-14 both created it) | Manual conflict resolution on four merges (SC-13, SC-15, SC-16 into wave 1; SC-22a into wave 2) |
| Orchestrator mistakes (from the session record; the lint push is visible in git history as the commit `style: format the pending-files list` on `scriptorium/wave1`) | A merge-and-push chain that did not stop on a failing check pushed a lint error to `wave1`; a scripted ledger edit matched the wrong table rows twice (the Needed-by column also contains `SC-NN`); SC-24a's dependency was misstated and the packet started late | Rework; one bad push |
| Stale background notifications | A finished agent kept re-notifying with an out-of-date status | Noise |
| Spec text corrupted by tooling | Literal line breaks inside code spans where `\n` was meant (SC-21 drift test, SC-22a hash input) | One extra spec review pass |
| Environment gaps | No `jq` and no Linux on the author machine: hook tests and several git tests skip locally | Needed CI to verify |

## What the reviews caught that the packets missed

- Replace refs, filter drivers, `.git/info/attributes` and hooks as ways for repo-controlled state to run code or redirect git's object view. The packets listed config options to neutralise but not the object-view attack surface.
- Windows-specific gaps: reserved device names, NTFS streams, `core.protectNTFS`, null-device paths.
- Tests that could not fail (theatre): e.g. a hooks test passing with the guard removed, an identity test with two overlapping layers.

## What we would slice differently

- Packets with a test matrix of more than about 10 hostile cases get split in the spec, not left to a retry budget.
- Put shared lists (allowed-files, root `package.json`) in a single prior packet, or have packets add their entries in separate files that a generator merges.
- Write fixtures in their own tiny packet so the packets that use them stay small.

## Process and scaffolding changes (shipped with this retro)

| Change | Answers |
|---|---|
| Dispatch rule 12 in `work-packets.md`: stub report first, commit the moment checks pass, stop at about 60k tokens | Coders dying before commit |
| Dispatch rule 13: shared files have one owner; the orchestrator resolves them; never merge or push on a failing check | Merge conflicts and the bad push |
| Dispatch rule 14: platform gaps; open a draft PR early for Linux CI and read the log | Skipped Linux tests |
| Dispatch rule 15 and campaign-packet skill § 6: every wave closes with docs, retro and process changes | This request |
| SC-42, SC-60 and H-20 now carry the `GELDAR_MODE` check and the commit-path TOCTOU note | Wave 2 review findings 2 and 3 |

## Proposed next (not yet done; for wave 3)

1. **A merge helper in `scriptorium.ps1`** (`merge-packet <branch>`): merge `--no-ff`, auto-resolve the known shared files, run `check`, and refuse to continue or push on failure. Turns rule 13 into a guard instead of a habit.
2. **A ledger helper** (`ledger set SC-NN <status>`) that edits only the row whose first cell matches, replacing ad hoc `sed`.
3. **A spec lint** (`check:specs`): fail on control characters, literal line breaks inside a code span, and on dangling `SC-NN` references in `work-packets.md` and the ledger.
4. **A shared git runner** package for `geldar-git` and `geldar-verify` (they drifted: the verifier lacks `--attr-source`, `GIT_ATTR_NOSYSTEM`, `core.fsmonitor=false`). Wave 2 review follow-up 5.
5. **Model choice:** try Sonnet for coders on packets with more than about 8 files, or split earlier. Measure tokens per packet in the next wave's retro.
6. A test-fixture helper that puts `--no-replace-objects` and `core.hooksPath` first on every fixture git call (wave 2 review follow-up 6).
