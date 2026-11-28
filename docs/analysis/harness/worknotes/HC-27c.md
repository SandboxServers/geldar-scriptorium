# HC-27c worknote: kit reader for `fight_seen` and `container_taken`

- Base: this branch (`scriptorium/sheet-kit-wave`), on top of HC-27b (the card's branch name `scriptorium/hc-27c-social-evidence-kinds` is not used; the brief names this branch).
- Inert: nothing registers an fx; `DEFAULT_FXS` is not touched. Nothing here is read by an agent and no id reaches any string an agent sees.
- Reads: `fight_seen` gives `fought_mob` (aggression 4.5), key `fight:<id>`. `container_taken` gives `took_mine` (law 1.5, good 2.0), key `take:<id>`. A break (`property_broken`, key `break:<id>`) and a take are distinct keys, so each counts once.
- `fled_mob`, `kept_promise` and `broke_promise` stay inactive. On the live path the two rows still need HC-30a's adapter to produce the kinds.
- Files: `observe.ts` (two rows added to the event tables, stale comment fixed), `rules.ts` (`fought_mob.active = true`, header comment fixed), `observe.test.ts`, `model.test.ts`, `apply.test.ts`.

## Deviations from the card (each has a reason)

- `apply.test.ts` is edited, though the card does not list it. Its HC-27b test `the observer own act is dropped as self; fight_seen is dropped as inactive` used `fought_mob` as the inactive case, which this packet makes active. The test now uses `fled_mob` as the inactive case. The redelivery tests (`fight_seen` updates aggression once; `container_taken` updates law and good once, a break of the same id is a second key) are also in `apply.test.ts`, because only `applyObservations` shows the dedup.
- `observe.test.ts` tests: the no-actor test now covers `hurt`, `fight_seen` and `container_taken`, so the nearest-person revert fails it.
- No change to `apply.ts`, `model.ts`, `store.ts` or the HC-27a/27b logic.

## Checks

- `tsc -p packages/instinct --noEmit`: exit 0.
- vitest (scratchpad config), `packages/instinct`: 23 files, 250 passed, 2 skipped.
- `biome check --write` then `biome ci` on the five touched files: clean.
- `node tools/repo-checks/src/cli.ts`: `repo checks: ok` (line-cap warnings only for files outside this packet).

## Revert checks (each: revert, run, see the named tests fail, restore byte-identical by hash)

| # | Revert | Failing test(s) |
|---|---|---|
| 1 | `fought_mob` left inactive (`active: false` in `rules.ts`) | `inactive rules are marked off and the active ones are on`; `a fight_seen rule is aggression 4.5 only, and fled_mob stays inactive`; `a fight_seen updates aggression once, also when redelivered` |
| 2 | absent actor resolved to the nearest person (`actorOf` returns `nearby[0]?.life` when `actorName` is absent) | `an event without an actor gives nothing, even with one nearby other` |
| 3 | `container_taken` key tag set to `break` (merges the take into the break key) | `maps each event kind to its observation kind and key tag`; `a container_taken with a life id gives took_mine under its take key, apart from a break` |

## Index line

`HC-27c: kit reader for fight_seen and container_taken; fought_mob and took_mine via container_taken; inert, no fx registered`
