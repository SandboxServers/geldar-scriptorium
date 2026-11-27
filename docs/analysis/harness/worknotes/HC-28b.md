# HC-28b worknote: stranger policy

- Base: branch `scriptorium/sheet-kit-wave`, which holds HC-27b and HC-28a. Branch for the card's worktree: `scriptorium/hc-28b-stranger` (not created here; this commit lands on the wave branch as the dispatch asked).
- Decisions: the instinct step never settles a first-time sighting and never talks (D-HC-09). Brief 5.7. Assumed; no owner approval needed (ledger only, no agent-visible text).
- Files (new, under `packages/instinct/src/social/`): `stranger.ts`, `stranger.test.ts`; this worknote. `branch.ts`, `predict.ts`, `step.ts`, `model.ts`, `rules.ts`, `store.ts` and `DEFAULT_FXS` in `run.ts` are untouched. No fx is registered; the policy ships inert.

## What was built

- `stranger.ts`: `StrangerChoice`, `StrangerInput`, `StrangerOutcome`, `strangerBranch` and `strangerStep` with the card's shapes.
- `approach = (curiosity - 3) + (good - 3) + 0.5 * socialProficiency`, read from our own sheet. `threat = other.estAggression - own aggression`.
- `strangerBranch`: threat at least 2 gives `avoid`; approach at least 1 gives `approach`; approach below -1 gives `ignore`; otherwise one chance node (score our curiosity, DC 11, proficiency 0) with `approach` on success and `ignore` on failure.
- `strangerStep` gates first: a people file or fewer than one sighting gives `pass`, no roll. Rolls off takes the most probable choice from `distribution` (ties: `ignore`, then `avoid`, then `approach`) and calls no roll. Rolls on walks the tree and calls `roll` once per chance node.
- Outcomes: `avoid` settles `travel_away`; `ignore` passes; `approach` within 4 blocks escalates; farther away it settles `follow` unless `followsSoFar >= 3`, which escalates.
- `why` strings are operator-ledger text only. They carry no name and no id.

## Choices the card left open (flagged)

- A `roll` that returns `null` at a chance node gives `pass` (the model decides). The card is silent on this; `pass` is the only outcome that invents no act and no speech.
- The tie order names `ignore` then `avoid`; `approach` is placed last, since the card does not rank it.
- `SPEECH_RANGE` (4) and `FOLLOW_LIMIT` (3) are exported constants so the tests name them.
- `StrangerInput.other.name` is carried in the type as the card lists it; the policy never reads it.
- The settle act's `target` is the stranger's life id, as the card's `target: string` shape requires. It is an act field for the Body, never agent-visible text. HC-30a must keep it out of any model-visible fact.
- The card's B1 and B5 blindness checks are read as: no outcome text reaches the character (B1), and no id reaches a model (B5). The text of those checks was not in the card section, so this is an interpretation.
- The card's CK-1 to CK-4 were run as: vitest on the file (CK-1), tsc on the package (CK-2), biome (CK-3), repo checks (CK-4).

## Test results

Each line is the final summary.

- vitest `packages/instinct/src/social/stranger.test.ts` (via the scratchpad config): `Tests 19 passed (19)`.
- vitest `packages/instinct` (full package): `Test Files 23 passed (23)`, `Tests 245 passed | 2 skipped (247)`.
- tsc `packages/instinct` (`tsc -p . --noEmit`): exit 0.
- `biome check --write` on both files: fixed 2 files (formatting only). `biome ci` on both: exit 0, no fixes.
- `node tools/repo-checks/src/cli.ts`: `repo checks: ok`, exit 0. Its warnings are existing line-cap notices in other packages (`launcher/`, `mind-loop/chat.test.ts`, `psyche/mirror.test.ts`, `supervisor/`), not in these files.
- Line counts: `stranger.ts` 133, `stranger.test.ts` 242 (under the 500 soft cap). Both LF.

## Revert-checks

Each: the file was backed up, one mutation applied, vitest run, the named test seen failing, then the file restored and confirmed byte-identical.

| # | Mutation in `stranger.ts` | Failing test(s) |
|---|---|---|
| 1 | sightings gate removed (`if (i.hasPeopleFile)`) | `first sighting passes` |
| 2 | people-file gate removed (`if (i.sightings < 1)`) | `a person with a people file passes` |
| 3 | threat line off by one (`> THREAT_LINE`) | `avoid when threat is 2 or more`, `avoid settles travel_away` |
| 4 | ignore branch removed | `ignore when approach is below -1` |
| 5 | chance DC changed to 10 | `chance node only between -1 and 1`, `a tie between approach and ignore picks ignore`, `rolls on records exactly one roll` |
| 6 | rolls-off reads the roll (`const choice = true`) | `rolls off picks the more probable choice and consumes no roll` |
| 7 | roll record dropped (`rolls.push(r)` removed) | `rolls on records exactly one roll`, `rolls on with a failed check takes ignore and still records one roll` |
| 8 | tie order flipped (`approach` first) | `a tie between approach and ignore picks ignore` |
| 9 | speech range off by one (`<` for `<=`) | `within 4 blocks escalates, never settles` |
| 10 | follow limit off by one (`> FOLLOW_LIMIT`) | `the third follow escalates` |
| 11 | a `text` field added to a settle outcome | `rolls off picks the more probable choice and consumes no roll`, `no text of the outcome reaches the character` |

All 11 reverts were seen failing. After the last restore the file matched its backup byte-for-byte.

## Index line for the orchestrator

HC-28b stranger policy: `packages/instinct/src/social/stranger.ts`, inert; `DEFAULT_FXS` unchanged. HC-30a wires `strangerStep` and must keep `act.target` out of model-visible text.
