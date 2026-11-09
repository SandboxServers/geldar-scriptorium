# Retro: wave 5 (the launcher)

Written 2026-11-09, at the close of wave 5. All 18 packets are merged to `scriptorium/wave5` (draft PR #12); the wave review ran and its fixes are in. Previous retro: [retro-wave-4.md](retro-wave-4.md). Sources: the reports in `.claude/reports/scriptorium/` (coder, review and fix reports), `gh run list --branch scriptorium/wave5`, and [overnight-decisions.md](overnight-decisions.md). Per-session token figures were not kept in the repo, so none are given here.

## Packets and passes

| Item | Count | Source |
|---|---|---|
| Packets | 18: SC-50a to d, SC-51a/b, SC-52a/b, SC-53a to e, SC-54a/b, SC-55a to c | ledger |
| Per-packet reviews (before rule 21) | 6 (SC-50a, 50b, 50c, 50d, 53b, 55a) plus 1 process review (proc1) | `SC-*-review-1.md`, `proc1-review-1.md` |
| Wave reviews | 2 (security; spec, parity and test quality) | `wave5-review-*.md` |
| Fix passes | 8 reports (SC-50a, 50b, 50c, proc1, fix-ci1, fix-h10, fix-sec, fix-tests), plus fix rounds inside the SC-53c and SC-55c coder reports | `*-fix-*.md`, `fix-*.md` |
| CI runs on PR #12 | 11: 5 success, 4 failure, 1 cancelled, 1 in progress when counted | `gh run list --branch scriptorium/wave5` |

## What went well

- **The wave review caught the case-fold identity bypass (S1).** On a case-insensitive filesystem a commit adding `memory/Identity.md/x.md` was fast-forwarded and removed the locked `memory/identity.md` from the human's tree; the reviewer exploited it on Windows. Fixed in the path rule and both re-checks with revert-proven tests (`fix-sec`); geldar filed decision 0042 (decision 28).
- **Linux CI caught real failures that Windows hid.** The H-10 bundle-cut case hung on Linux because the pipe read end stayed open after `head` and a single `docker kill` landed before the container was blocked (`fix-ci1`, `fix-h10`); the `finish` capability group was never reported by either launcher (`fix-ci1`).
- **Twin parity through shared tests.** One test file drives both launchers (`parity.ts`), so the PowerShell packets were held to the bash packets' cases. SC-53a found that shared tests called bash directly for some cases; the harness was fixed (decision 18).
- **The revert check found a real gap.** `fix-tests` reverted five controls; four were caught, and the token-echo revert passed, so the test now scans both streams for the token.
- **The wave review found weak tests:** negative-only `ok` cases, a CI guard that ignored `CI=1`, and attack tests that asserted no push but not the rejection reason (all fixed in `fix-tests`).

## What cost time or tokens

| Finding | Evidence | Cost |
|---|---|---|
| Two parallel full checks of about 18 minutes each | SC-53b review: 454 tests, 1116 s | Load made a timing test fail (decision 23) |
| Load-flaky timing tests | SC-50b review (core case 10), SC-53b review run 2 (pre case 13) | Rule 19 and `launcher/test/timing.ts` |
| Watcher-loop shells piled up | Owner observation; the SC-54b coder admits one busy-wait loop | Rule 20 |
| Coders exceeded the one-run cap | SC-54b ran `-t pwsh` twice; SC-52a, SC-52b, SC-54a and SC-54b report late edits not re-run | Unverified edits reached wave end |
| Windows git differs from Linux git | H-16 case 5 never lands its hostile commit on Windows git (SC-51a, SC-53d, `fix-tests`) | The case runs only on Linux CI |
| `parity.ts` is one list every packet edits | Each coder report adds a line to it | Conflict on every merge |
| Late fixes landed untested | `fix-sec` N1 test never seen to run (timeout); `fix-h10` checked with `bash -n` only | CI had to confirm |
| A check inside a worktree is not reliable | Decision 12; the SC-50d review found a third drift test the coder missed | Rule 16, then rule 21 |
| Stale card text | `work-packets-wave5.md` still said SC-33 "not started" after it was Done (fixed in this docs pass) | Misleading cards |
| Private-network literals in tests | Spec review item 3 (`10.0.0.1`); same class as the wave 4 finding | Fixed in `fix-tests` |

## What the reviews caught that the packets missed

S1 (case-fold bypass), the weakened `core` cases, the CI guard bug, the IP literals, and the SC-50d retarget that missed `tests/template/check.test.ts`. Security notes N1 (bash `yaml_q` accepted a backslash), N2 (fsck on `held_count`) and N5 (PowerShell kill-loop bound) were fixed in `fix-sec`.

## Process changes shipped this wave

| Change | Answers |
|---|---|
| Rule 19: timing-bounded and load-sensitive tests run in CI only (`CI` or `GELDAR_TIMING_TESTS=1`); `launcher/test/timing.ts` | Load-flaky timing tests |
| Rule 20: no watcher loops | Stray polling shells |
| Rule 21: review and full checks at wave end; `merge-packet --no-check` | 18-minute checks per packet (decision 24) |
| Rule 22: slice for fan-out, with a fan-out plan at the top of each wave's cards | Wall time set by the critical path (decision 25) |
| Rule 23: a coder reports its run count and untested late edits | Unverified edits (this retro) |
| Decision 27: an image built by this org is exempt from the two-week age rule; third-party images are not | Waiting 14 days for our own mock image |

## Owner rulings this wave

Decisions 23 (CI-only timing tests), 24 (review and tests at wave end), 25 (fan-out slicing), 26 (template publish reads the `geldar-bot` key through OIDC; SC-63a split out), 27 (own-org image exempt from the age rule) and 28 (case-fold fix and geldar decision 0042). Full text in [overnight-decisions.md](overnight-decisions.md).

## Proposed next

None is built.

| Item | Owner | Status |
|---|---|---|
| Make `parity.ts` merge without conflicts (auto-merge, or one file per packet) | follow-up packet | proposed |
| A shared test-path helper (bash path versus native path in tests) | follow-up packet | proposed |
| A Windows-git test fixture fix so H-16 case 5 runs on Windows | follow-up packet | proposed |
| Start-tree case-collision check in the host re-check and gate (decision 28) | SC-60 | proposed |
| Security review items for SC-60: N3 (refuse local-class names in `mcp_url`), N4 (session dir 0700, separate allowlist dir), N6 (`.cmd` seam quoting), N8 (test seams stay human-environment only) | SC-60 | proposed |
| Write the Wave 6 and Wave 7 cards with a fan-out plan first (rule 22) | orchestrator | proposed |

## State for the next wave

Wave 5 is on the wave branch with PR #12 open; the Linux CI result on the final head decides whether it merges to `main`. Open owner items are in [RESUME.md](RESUME.md).
