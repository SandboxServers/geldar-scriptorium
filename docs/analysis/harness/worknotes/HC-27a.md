# HC-27a worknote: social model rules, update arithmetic and store

- Base: `origin/scriptorium/hw0` at `673d756` (branch `scriptorium/hc-27a-social-store`). Step 0 passed: `packages/psyche/src/index.ts` exports `CharacterSheet`.
- Decisions: D-CS-05 (interpolation) and D-CS-06 (observer-scoped evidence) assumed; `PRIOR_STRENGTH = 2` and the observation values are unmeasured. No owner approval needed: nothing here is agent-visible text.
- Files (all new under `packages/instinct/src/social/`): `rules.ts`, `model.ts`, `store.ts`, `model.test.ts`, `store.test.ts`. No other file is edited.
- Shapes follow the packet. `common_sense` and `cleverness` have no rule: `estimateOf` always returns the prior with `supported: false`.

## Choices the packet left open

- An unsafe id (fails `SAFE_ID`) is refused by throwing from `load`, `save` and `list` skips it. A malformed model file reads as `null`. The store keys files by the other's id only.
- The archive target is `social.archive-<oldlife>`. If that name already exists, a `-2`, `-3`, ... suffix is added so a second life change does not fail on the rename. An old life that is not a safe id, or a missing or unreadable `meta.json`, archives as `unknown`.
- `meta.json` is `{observer, life}` inside `<stateDir>/social`. It is rewritten when either field differs.

## Revert-checks (each: revert, run, see the named test fail, restore byte-identical, rerun green)

| # | Revert | Failing test(s) |
|---|---|---|
| 1 | divisor `(n + strength)` changed to `(n + 1)` | `evidence 4.5 applied three times from prior 3 gives 3.75, 4.0, 4.125` |
| 2 | projection term `0.25 * (5 - sense) * (ownScore(own, f) - 3)` dropped (prior is 3) | `the prior projects from the own sheet: common sense 1 and curiosity 5 give 5`; `the prior projects from the own sheet: common sense 3 gives 4` |
| 3 | `fought_mob` set `active: true` | `inactive rules are marked off and the active ones are on` |
| 4 | constructor life check skipped (`if (false) archive(`) | `a different life archives the old directory and starts fresh` |

After each restore the two files gave `11 passed | 1 skipped`. The skipped test is the 0600/0700 mode test, skipped on win32 by the packet's rule.
