# HC-17b worknote: kit sheet reader and check helper

Branch `scriptorium/hc-17b-sheet-parser`, cut from `3aea796` (HC-17a). Files: `packages/psyche/src/{index,sheet,check}.ts`, `sheet.test.ts`, `check.test.ts`, and the `exports` line of `packages/psyche/package.json` (now `./src/index.ts`).

## Deviations from the card

| # | Card says | Done | Why |
|---|-----------|------|-----|
| 1 | `Sheet` has optional `proficiency` | No proficiency key. A text that carries it is refused | The engine normalizer refuses unknown top-level keys and `types.ts` says a sheet never carries proficiency; the world's `CharacterSheet` refuses it too (work-packets-geldar-a.md). The orchestrator ruling requires exact agreement with the engine normalizer |
| 2 | 25 cells against brief 4.1 | 20 cells (5 scores by DC 8, 11, 14, 17) | The brief's table has 20 cells |
| 3 | `check()` record `bonus` not specified for rolls off | `bonus` is the score bonus plus proficiency | The record type has a `bonus` field; the value is deterministic. A test pins a non-zero case (score 5 prof 2, score 1 prof 1) |
| 4 | Appendix A Adam sheet fixture | A varied sheet built in the test | Appendix A is not in this worktree |
| 5 | `RollRecord` re-exported from the contract by HC-18 | Declared in `check.ts`; no assignability test | `@geldar/scriptorium-instinct/contract` does not exist yet |
| 6 | parseSheet agrees with the engine at all sizes | Equivalence is stated for texts up to 4096 bytes | The 4096-byte limit is kit-only; the engine has no size limit. A test pins the literal 4096 and 4097 |
| 7 | Entry re-exports the engine | Entry names every engine name one by one (never `export *`). Omits only `TEMPERAMENT_BANK` and `temperamentFor` | Ruling: temperament is inactive (README.md). Every other engine name is exported; see the list below |
| 8 | `check()` takes its inputs as given | Throws a RangeError before any draw for a bad score, a non-integer dc, an n or tick that is not a safe non-negative integer, or an fx or lifeKey that is empty or has `:` | Ruling. A non-integer DC gave a rolls-off answer that disagreed with the engine's roll at the same DC. Messages are constant and carry no sheet value |
| 9 | `successProbability(score, dc, proficiency?)` (kit-c B-1) | `successProbability` is the same function as `successChance(score, dc, prof)` | Ruling. Kit-c and later cards use that name; the test checks identity |

## Package entry: the full export list

Runtime names (22): `check`, `parseSheet`, `successChance`, `successProbability` (this package) and from the engine `alignmentLabel`, `canonicalSheetJson`, `d20`, `DEFAULT_DCS`, `DEFAULT_THRESHOLDS`, `decisionId`, `ENGINE_VERSION`, `exactChance`, `factor`, `levelForXp`, `modeFor`, `normalizeSheet`, `rngFor`, `roll`, `seedFor`, `sheetOrStandard`, `STANDARD_SHEET`, `step`.

Type names (12): `CharacterSheet`, `Domain`, `DrawKey`, `Level`, `Mode`, `Rng`, `Roll`, `Score`, `SheetResult` from the engine; `CheckOptions`, `RollRecord`, `Sheet` from this package.

Omitted: `TEMPERAMENT_BANK` and `temperamentFor`. Only these two. Reason: temperament is inactive and the bank is not part of the kit surface. `d20` is exported as a public engine helper; a raw draw from it is not recorded, so audited draws go through `check()` or `roll()`. The pinned-names test in `check.test.ts` lists these names and the test asserts that the two temperament names are absent.

## Card corrections needed

These cards disagree with this packet. Their authors must correct them; this packet does not edit them.

1. HC-20 reads `sheet.proficiency`. `Sheet` has no such field. Proficiency levels come from the world state cache, never from the sheet.
2. HC-23a calls `check` with 5 arguments. The real signature takes 8: `check(fx, score, dc, rng, n, lifeKey, tick, opts)`.
3. The cards say `rngFor(lifeKey, tick, fx, n)`. The engine takes one `DrawKey` object: `{ lifeId, producer, generation, tick, fx, decisionSeq }`.

## Tests (vitest, 71 passing across the psyche package, including the HC-17a files)

- `parseSheet`: standard and varied sheets accepted; unknown keys, score 0, score 6, 3.5, missing group, 5 KB text rejected; proficiency refused; 4096 bytes read, 4097 refused (literal values; the constant is asserted to be 4096); non-JSON and non-string input never throws.
- Conformance: 170+ texts (valid, every score path with 10 bad values, missing keys, unknown keys, version and shape faults, invalid JSON, `__proto__`, duplicate `version`); `parseSheet !== null` equals the engine's `normalizeSheet(JSON.parse(text)).ok`.
- `successChance` and `successProbability`: 20 table cells within 1 point; equal to `exactChance` within 1e-9 for 5 scores, DC 1 to 30, proficiency 0 to 3; `successProbability` is the same function.
- `check`: rolls off at the 0.5 line; rolls off never touches the rng (throwing rng); rolls off record `bonus` is score bonus plus proficiency (score 5 prof 2 gives 4, score 1 prof 1 gives -1); rolls on records the engine dice; rolls on equals a direct engine roll for every score and proficiency; the mode and dice count per score; a proficiency outside 0 to 3 throws before any draw; id format.
- Input validation: each bad score, dc, n, tick, fx and lifeKey throws a RangeError with its constant message, with rolls on and off, and the rng is not drawn; the edges (dc -10 and 45, n and tick 0 and MAX_SAFE_INTEGER) are accepted.
- Entry: the runtime export names equal the pinned list; `TEMPERAMENT_BANK` and `temperamentFor` are absent; each re-exported engine name is the engine's own value.

## Revert checks (run against the WIP commit, restored byte for byte)

| Mutation | Named failure |
|----------|---------------|
| `hasOnlyKeys` returns `true` (additionalProperties loosened) | `rejects unknown keys ...`, `refuses a sheet that carries proficiency`, the corpus test |
| `BONUS` score 5 from 2 to 1 | `matches the brief 4.1 table ...` and `equals the engine enumeration ...` |
| `successChance(...) >= 0.5` inverted to `< 0.5` | `rolls off is deterministic at the 0.5 line` |
| `export * from '../engine/index.ts'` added to the entry | `exports exactly the pinned names and not the temperament bank` |
| `MAX_SHEET_BYTES = 4096` changed to 4097 | `reads texts of 4096 bytes and refuses 4097 (literal limit, not the constant)` |
| `bonus: BONUS[score] + prof` changed to `bonus: BONUS[score]` | `rolls off records the score bonus plus proficiency` |
| `assertScore(score);` removed | `check input validation > refuses each bad input ... before any draw` |
| `export const successProbability = successChance;` removed | `package entry > exports successProbability as the same function as successChance` |

## Checks

- `tsc -p packages/psyche --noEmit`: clean. Nothing emitted.
- Biome: `biome ci packages/psyche` clean.
- vitest through a scratch config outside the repo (no root globalSetup, no docker).
- `node tools/repo-checks/src/cli.ts`: ok (existing warnings on files this packet does not touch).
