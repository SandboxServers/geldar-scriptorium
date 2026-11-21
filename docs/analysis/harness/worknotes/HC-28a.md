# HC-28a worknote: prediction by interpolation and exact branches

- Base: local `scriptorium/hc-27a-social-store` at `65c0d00` (HC-27a), branch `scriptorium/hc-28a-predict`. Step 0 passed: `packages/psyche/src/index.ts` exports `CharacterSheet`, `Score`, `Level`, `STANDARD_SHEET`, `successProbability`.
- Decisions: D-CS-05 (interpolate the two adjacent integer policies; execution stays on integer scores). Assumed; no owner approval needed (ledger only, no agent-visible text).
- Files (all new under `packages/instinct/src/social/`): `branch.ts`, `predict.ts`, `predict.test.ts`; this worknote. `model.ts`, `rules.ts`, `store.ts` and the kit baseline are untouched.

## What was built

- `branch.ts`: `Chance`, `Branch`, `Dist`, `Prob`, and `distribution`, which walks the tree weighted by the chance of success. Zero-weight arms are not walked. `Chance` lives here (the packet's "from psyche" comment is only the field types, which psyche does export).
- `predict.ts`: `Policy`, `estimatedScores`, `predict` and `recordPrediction`. Each fractional estimate splits into its floor and floor+1, weighted `1 - frac` and `frac`. Weight-0 picks are dropped, so a whole estimate calls the policy once. A field outside 1..5 throws a `RangeError` before any sheet is built. At most 2^6 = 64 sheets.
- The policy only ever receives integer sheets built from `STANDARD_SHEET` (op_modes copied, the other four keys set from the estimates).

## Choices the packet left open

- `recordPrediction` takes no clock, so `ts` is `new Date().toISOString()` at the call. Deviation: the packet's signature has no `ts` parameter, so the wall clock is read inside the function. The function stays otherwise pure (only the injected appender is written).
- `predict.test.ts` has one test beyond the packet's list: `rejects an estimate outside 1 to 5`, and one for `estimatedScores` with nothing learned. Both are additions, nothing weakened.

## Test results

- CK-1 `./scriptorium.ps1 pnpm test packages/instinct/src/social/predict.test.ts`: 10 passed.
- CK-2 `./scriptorium.ps1 pnpm --filter @geldar/scriptorium-instinct typecheck`: exit 0.
- CK-3 `./scriptorium.ps1 pnpm format`, `pnpm lint` (exit 0, no warnings in `social/`), `git diff --check` clean. Format also rewrote `tools/release/src/template-release.ts`; it was reverted with `git checkout --` and is not in the commit.

## Revert-checks (each: back up, revert, confirm the file changed, run, see the named test fail, restore, confirm byte-identical)

| # | Revert | Failing test(s) |
|---|---|---|
| 1 | round instead of interpolate (`Math.round(v)` as the only pick) in `picksFor` | `aggression 3.5 with a test-double policy gives P(fight) 0.625`; `one fractional field calls it exactly twice (spy)`; `the policy only sees integers`; `two fractional fields enumerate four sheets with product weights` |
| 2 | skip weight-0 pruning (`.filter((p) => p.weight > 0)` removed) | `an integer estimate calls the policy once`; `one fractional field calls it exactly twice (spy)`; `two fractional fields enumerate four sheets with product weights` |
| 3 | drop a branch weight (failure arm walked with `weight`, not `weight * (1 - q)`) | `aggression 3.5 with a test-double policy gives P(fight) 0.625`; `distribution sums to 1 on nested chances` |

After each restore the file matched its backup byte-for-byte and the test file was green (10 passed).

## Open items

None for the packet. HC-28b consumes `predict`, `estimatedScores` and `recordPrediction` with the production `Prob` (`successProbability`) as the packet specifies.

## Review pass 1

Changed: `branch.ts`, `predict.ts`, `predict.test.ts`, this note. `model.ts` and the rest are untouched.

- `branch.ts`: `walk` throws `RangeError` when a chance probability is not a number from 0 to 1 (NaN, below 0, above 1). A comment above `Dist` says outcomes are keyed by identity, so they must be primitives or shared constants.
- `predict.ts`: `recordPrediction` writes `est: { ...scores }`, a copy, so later mutation of the caller's object does not change the recorded line.
- `predict.test.ts` (now 18 tests in the file): all six fields fractional gives 64 policy calls and a distribution summing to 1; estimates 5, 1, 4.9999999 and 3.0000001 give 1, 1, 2 and 2 calls, and the policy only sees integers 1 to 5; `predict` throws on NaN and on 0.5; a probability of NaN throws; a probability of 1.5 throws; `Prob = () => 1` leaves the failure outcome out of the result; `Prob = () => 0` leaves the success outcome out; the recorded line is unaffected by mutating the scores afterwards.

Revert-checks (the file was confirmed changed before each run, then restored byte-identical):

| Revert | Failing tests |
|---|---|
| remove the probability guard in `walk` | `a probability of NaN throws`, `a probability of 1.5 throws` (2 failed, 16 passed) |
| `est: scores` instead of `est: { ...scores }` | `recordPrediction copies the scores, so a later mutation does not change the line` (1 failed) |

The `Prob = () => 1` / `() => 0` absence tests, the call-count and boundary tests, and the Dist comment change no behavior, so they pass on the code as it was; they are coverage for existing behavior, not revert-checked.
