# HC-27b worknote: observations: scope, dedup, sampling and apply (pure input)

- Base: this branch (`scriptorium/sheet-kit-wave`), on top of HC-27a and HC-28a. Corrected card: `kit-card-fixes-2026-11-27.md` section 5.
- Inert: nothing registers an fx; `DEFAULT_FXS` is not touched. Nothing here is read by an agent and no id reaches any string an agent sees.
- Files (all new under `packages/instinct/src/social/`): `observe.ts`, `sample.ts`, `dedup.ts`, `apply.ts`, `observe.fixtures.ts`, `observe.test.ts`, `apply.test.ts`. HC-27a and HC-28a files are not edited.
- Index line to add: `HC-27b: social observations (scope, dedup, sampling, apply), inert; no fx registered`.

## Deviations from the card (each has a reason)

- `positionObservations` takes a fifth argument, `observer`. Its observations carry `observer`, and the card's four-argument shape gives no source for it.
- `noteSighting` only counts an other that already has a model. The observer name is private to `SocialStore`, so it cannot make a model. A first model comes from an applied observation or from `noteSample`.
- Added `noteSample(store, observer, other, name, run, sample)`. The card returns a sample from `positionObservations` but gives no function to store it; without this the sampling has no effect.
- `container_taken` is not mapped: `eventObservations` gives nothing for it (HC-27c). `fight_seen` is mapped to `fought_mob` and then dropped as inactive by `applyObservations`, so it is counted in `dropped.inactive`.
- `applyObservations` calls `seen.flush()` itself when it adds a key, so a restart keeps the dedup. The card did not say who flushes.
- `ApplyReport.applied` and `deduped` count observations, not fields: `applied` when at least one field moved, `deduped` when every field was already seen.
- `spoke` is set to true when a `spoke_first` observation is applied. The card does not say what `spoke` means; this is the obvious reading.
- Own movement and sample distance use Euclidean blocks in three dimensions. The card gives no metric.
- Sorting for the batch is by tick, then key, then actor.

## Checks

- `tsc -p packages/instinct --noEmit`: exit 0.
- vitest (scratchpad config): `social/observe.test.ts` and `social/apply.test.ts`: 30 passed. The whole `packages/instinct/src` run: 213 passed, 2 skipped (22 files).
- `biome check --write` then `biome ci` on the seven files: clean.
- `node tools/repo-checks/src/cli.ts`: `repo checks: ok` (warnings only for files outside this packet).

## Revert checks (each: revert, run, see the named test fail, restore byte-identical)

| # | Revert | Failing test(s) |
|---|---|---|
| 1 | dedup check removed (`if (false && seen.has(key))`) | `the same hurt delivered twice counts once, also across a restart`; `took_mine updates law and good once each` |
| 2 | scope check removed (`if (false)`) | `an observation whose observer differs is dropped as foreign` |
| 3 | own movement ignored (`if (false && blocksBetween(me, prev.me) > ...)`) | `own movement above SELF_STILL_BLOCKS gives nothing (the observer moved)` |
| 4 | first hit taken for an ambiguous name | `an ambiguous name is dropped` |
| 5 | name used as id when no life is found | `a name with no life and no actorLife is dropped and never stored as an id` |
