# HC-17b worknote: kit sheet reader and check helper

Branch `scriptorium/hc-17b-sheet-parser`, cut from `3aea796` (HC-17a). Files: `packages/psyche/src/{index,sheet,check}.ts`, `sheet.test.ts`, `check.test.ts`, and the `exports` line of `packages/psyche/package.json` (now `./src/index.ts`).

## Deviations from the card

| # | Card says | Done | Why |
|---|-----------|------|-----|
| 1 | `Sheet` has optional `proficiency` | No proficiency key. A text that carries it is refused | The engine normalizer refuses unknown top-level keys and `types.ts` says a sheet never carries proficiency; the world's `CharacterSheet` refuses it too (work-packets-geldar-a.md). The orchestrator ruling requires exact agreement with the engine normalizer |
| 2 | 25 cells against brief 4.1 | 20 cells (5 scores by DC 8, 11, 14, 17) | The brief's table has 20 cells |
| 3 | `check()` record `bonus` not specified for rolls off | `bonus` is the score bonus plus proficiency | The record type has a `bonus` field; the value is deterministic |
| 4 | Appendix A Adam sheet fixture | A varied sheet built in the test | Appendix A is not in this worktree |
| 5 | `RollRecord` re-exported from the contract by HC-18 | Declared in `check.ts`; no assignability test | `@geldar/scriptorium-instinct/contract` does not exist yet |
| 6 | parseSheet agrees with the engine at all sizes | Equivalence is stated for texts up to 4096 bytes | The 4096-byte limit is kit-only; the engine has no size limit. A test pins the limit |

## Tests (vitest, 66 passing across the psyche package, including the HC-17a files)

- `parseSheet`: standard and varied sheets accepted; unknown keys, score 0, score 6, 3.5, missing group, 5 KB text rejected; proficiency refused; 4096 bytes read, 4097 refused; non-JSON and non-string input never throws.
- Conformance: 170+ texts (valid, every score path with 10 bad values, missing keys, unknown keys, version and shape faults, invalid JSON, `__proto__`, duplicate `version`); `parseSheet !== null` equals the engine's `normalizeSheet(JSON.parse(text)).ok`.
- `successChance`: 20 table cells within 1 point; equal to `exactChance` within 1e-9 for 5 scores, DC 1 to 30, proficiency 0 to 3.
- `check`: rolls off at the 0.5 line; rolls off never touches the rng (throwing rng); rolls on records the engine dice (scripted rng); rolls on equals a direct engine roll for every score and proficiency; the mode and dice count per score; a proficiency outside 0 to 3 throws before any draw; id format.
- Entry: the runtime export names equal the pinned list and exclude `TEMPERAMENT_BANK` and `temperamentFor`.

## Revert checks (run against the WIP commit, restored byte for byte)

| Mutation | Named failure |
|----------|---------------|
| `hasOnlyKeys` returns `true` (additionalProperties loosened) | `rejects unknown keys ...`, `refuses a sheet that carries proficiency`, the corpus test |
| `BONUS` score 5 from 2 to 1 | `matches the brief 4.1 table ...` and `equals the engine enumeration ...` |
| `successChance(...) >= 0.5` inverted to `< 0.5` | `rolls off is deterministic at the 0.5 line` |
| `export * from '../engine/index.ts'` added to the entry | `exports exactly the pinned names and not the temperament bank` |

## Checks

- `tsc -p packages/psyche --noEmit`: clean. Nothing emitted.
- Biome: `biome ci packages/psyche` clean.
- vitest through a scratch config outside the repo (no root globalSetup, no docker).
- `node tools/repo-checks/src/cli.ts`: ok (existing warnings on files this packet does not touch).
