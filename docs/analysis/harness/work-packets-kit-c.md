# Harness campaign work packets, kit C: social model, programs, promises, lineage, drift, export, cohorts

Part of [README.md](README.md) (ledger, decisions D-HC-01 to D-HC-11, waves) and [retarget-map.md](retarget-map.md). Written 2026-11-14 by reading the kit at `ea1e0ed` (worktree `harness-campaign`). Kit A (HC-00 to HC-16) and kit B (HC-17 to HC-26) are written in parallel by another author: this file names their ids and only the names listed in the three `Assumed from` sections. Behaviour numbers (thresholds, windows, caps) are the brief's first guesses and are **unmeasured**. Every behavioural rule that came from a `D-CS-nn` question is **assumed (recommended default)** until the owner rules, as the README says.

Cards here: HC-27 to HC-39, split where one Haiku coder (about 40k working tokens, no CLAUDE.md) would overrun. Nothing is `Ready` until this file is committed, the wave branch exists and the dependency names in `Assumed from` are confirmed by the cross-check.

| Card | Title | Wave | Depends on | Status when written |
|---|---|---|---|---|
| HC-27a | Social model rules, update arithmetic, store | HW4 | HC-18 (package), HC-17 | BlockedDependency |
| HC-27b | Observations: scope, dedup, sampling, apply | HW4 | HC-27a, AN-28 | BlockedDependency |
| HC-28a | Prediction by interpolation and exact branches | HW4 | HC-27a, HC-17 | BlockedDependency |
| HC-28b | Stranger policy | HW4 | HC-27b, HC-28a | BlockedDependency |
| HC-29 | Bounded social prose as prompt facts | HW4 | HC-27a | BlockedDependency |
| HC-30a | HW4 integration (observe, stranger, facts) | HW4 | HC-27b, HC-28b, HC-29, HC-24 | BlockedDependency |
| HC-30b | HW4 wave close: docs, retro, process | HW4 | HC-30a | Writing |
| HC-31 | Idle binding for explore, farm, patrol | W7 | HC-21, AN-44, AN-45 | BlockedDependency |
| HC-32 | Day facts for the reflect skill | W9 | HC-29 | BlockedDependency |
| HC-33 | Promises in the kit (question card) | W8 | D-HC-06 | **BlockedDecision** |
| HC-34a | `geldar-seed` package: lineage record check | W10 | AN-54, AN-55 | BlockedDependency |
| HC-34b | `new --parents`: parse and check (both launchers) | W10 | HC-34a, HC-26 | BlockedDependency |
| HC-34c | `new --parents`: create exactly once (both launchers) | W10 | HC-34b | BlockedDependency |
| HC-35a | Seed synthesis: inputs, prompt, validation | W10 | HC-34a | Writing |
| HC-35b | Seed synthesis: the supervisor runs it on the parent's harness | W10 | HC-35a, HC-04, HC-08 | BlockedDependency |
| HC-35c | `geldar-play seed` verb (both launchers) | W10 | HC-35b, HC-34b | BlockedDependency |
| HC-36a | Drift trigger at sleep and the refresh artifact | W11 | AN-58, AN-59, AN-43, AN-60, HC-25, HC-26 | BlockedDependency (D-CS-13) |
| HC-36b | `persona-refresh` export verb (both launchers) | W11 | HC-36a | BlockedDependency |
| HC-37a | Ledger exporter (library and binary) | HW5 | HC-19, HC-03 | BlockedDependency |
| HC-37b | `export-ledgers` verb (both launchers) | HW5 | HC-37a | BlockedDependency |
| HC-38 | Cohort arms by harness | HW5 | HC-16, HC-26, HC-37b | BlockedDependency |
| HC-39 | Campaign close: docs sweep, retro, process | HW5 | all | Writing |

## Dispatch rules (every card; the coder skips CLAUDE.md, so these travel with it)

- **R1 Budget.** One Haiku `packet-coder`, about 40k working tokens. Write a stub report first (R10), commit the moment the card's checks pass, and stop at about 35k: commit nothing half-done and record what is left (On-cap).
- **R2 Where.** Work only in the worktree named in the brief. Run pnpm as `./scriptorium.ps1 pnpm <args>` from the worktree root; run `./scriptorium.ps1 setup` first in a new worktree. Windows with PowerShell 7 and Git bash, no `jq`; tests that need Linux skip locally and run in CI. Never share `node_modules` by junction or symlink between worktrees.
- **R3 Files.** Edit only the files the card lists under May edit. `(new)` files are created by the card; `(to confirm)` means the coder checks the path or name in the worktree first and, if it is not there, stops with `blocked` and says what it found. Never invent a function or an environment variable name: use the ones this file or the code defines.
- **R4 TypeScript.** ESM, `.ts` import specifiers, `erasableSyntaxOnly` (no enums, namespaces or constructor parameter properties: declare fields and assign them), each package `tsconfig.json` extends `../../tsconfig.base.json`. Tests are `*.test.ts` next to the code and run by the root `vitest run`. No new dependency in any card here (so no lockfile change); if one seems needed, stop.
- **R5 Files and secrets.** Soft cap 500 lines, hard cap 700 (`check:repo` fails above 700). `packages/supervisor/src/supervisor.ts` is already 635 lines: a card may add at most 15 lines there and puts everything else in a new file. `launcher/lib/new.sh` is 529 and `new.ps1` 500: at most 15 lines added to either. No `utils.ts`. LF line endings. No secrets, account names or non-`127.0.0.1` addresses.
- **R6 Template voice.** Anything under `template/` and any text shipped to the character (prompt constants, facts) is player-facing: second person, plain, in the world's terms, no word naming how the kit works. See B8.
- **R7 Tests.** Every behaviour has a test that fails when the behaviour is reverted: revert locally, run, restore, and say so in the report. List the edits made after the last green run as "unverified".
- **R8 Commit.** One commit with the card's subject, then the attribution lines the dispatch brief gives verbatim. Never `git stash`, `git push`, `gh pr` or `git worktree prune`. No broad process kills (never by image name). No polling loops; run a check in the foreground with a timeout.
- **R9 Shared files have one owner.** These are edited by several cards, so the orchestrator merges them serially and each card adds only its own lines: `launcher/geldar-play`, `launcher/geldar-play.ps1`, `launcher/messages.d/00-core.tsv` (the `usage` line), `launcher/README.md`, `docs/troubleshooting.md`, `image/Dockerfile`, `packages/supervisor/src/supervisor.ts`, `packages/supervisor/src/deps.ts`, `launcher/test/player-support.ts`, `launcher/test/fake-docker.sh`, `tests/template/allowed-files.ts`. On conflict take the wave branch's version and re-apply your lines.
- **R10 Report.** Write `<worktree>/.claude/reports/harness/<card>-coder.md` first and update it as you go. Return one line: `<card> <done|blocked|failed> <commit-sha|-> <report-path>`.
- **R11 Inactive code.** This campaign merges inactive code only (D-HC-11). Every new behaviour is off unless the per-world switch of kit B (`InstinctConfig`) or the explicit verb is used. A card never edits a live player, a shard or a node.
- **R12 Packages.** New TypeScript for the social model goes under `packages/instinct/src/social/` (kit B creates the package in HC-18). New package `packages/seed` is created by HC-34a. The mirror `packages/psyche` is read-only for this file (its tree hash is pinned by HC-17).

## Checks (named once; each card says which apply, in this order)

- **CK-1** `./scriptorium.ps1 pnpm vitest run <the card's test files>`. The global setup builds the kit image once when Docker is up; that is slow, not an error. Docker cards set `KIT_IMAGE=geldar-kit:<card>`.
- **CK-2** `./scriptorium.ps1 pnpm lint` (biome ci).
- **CK-3** `./scriptorium.ps1 pnpm typecheck` (every package, then `tsc -p tests`).
- **CK-4** `./scriptorium.ps1 pnpm check:repo` (line caps, CRLF, launcher twin drift).
- **CK-T** `./scriptorium.ps1 pnpm check:template` (template cards and any card that adds text a character reads).
- **CK-M** `./scriptorium.ps1 pnpm lint:md` (cards that touch docs).
- The full `./scriptorium.ps1 check` and the wave review run once on the wave branch (dispatch rule 21 of `docs/analysis/scriptorium/work-packets.md`); a worktree check is not the gate.

## The character stays blind (B1 to B9; each card names the ones it can break)

- **B1** No number, score, label (alignment letters, words such as lawful or chaotic), stat word or the word estimate ever enters a prompt, fact, tool output, log or file the character can read.
- **B2** No code reads another player's true sheet. World events are read through an allowlist of fields; unknown fields are dropped, never stored or printed.
- **B3** The own sheet and the social store live only in the supervisor's volume (`/state/supervisor`, unreadable by the player user). Nothing from them goes into the child environment (`childEnv` in `packages/supervisor/src/supervisor.ts`), the workspace, a commit or a tool result.
- **B4** Operator metadata (arm, harness label, cohort, run ids, treatment flags, birth ids) never enters a prompt or a workspace file.
- **B5** Facts read as the player's own observation, with the other person's name quoted. Nothing says or implies the player is watched, measured or modelled. No terrain, resource or coordinate coaching.
- **B6** Facts and updates come only from what this player saw (observer-scoped, causal evidence). An unseen act never updates anything.
- **B7** Kit code never writes under the player's `memory/` or `skills/`. Trust stays the character's own writing (the existing `reflect` skill).
- **B8** Every text constant shipped to the character passes the player-text scans in `tests/template` (`markedWords` and `forbiddenMention` from `tests/template/tool-skill-scan.ts`, plain ASCII, no digit in social lines). The test that shows how is `tests/template/tidy-prompt.test.ts`.
- **B9** The container security model is unchanged: no new mount in the `player` service, no new capability, no new route. Anything that reads the supervisor volume from the host runs in a throwaway helper (`pl_helper` or `helper_run` in `launcher/lib/player.sh` and `prepare.sh`) with the volume read-only and `--network none`.

## Both launchers (confirmed by reading `tools/repo-checks/src/twin-drift.ts`, `troubleshooting.test.ts`, `launcher/test/parity.ts`, `launcher/geldar-play`, `geldar-play.ps1`)

A launcher change is not done until all of these hold (called BL below):

1. Bash and PowerShell twins with the same behaviour: `launcher/lib/<topic>.sh` and `<topic>.ps1` (both loaders source every file in `lib/`, so a new file needs no registration) with `verb_<name>` and `Verb-<name>`. A verb with a hyphen is mapped to an underscore name in both entry scripts.
2. A new verb is added to: `verb_needs` and the two `case $verb in` lists in `launcher/geldar-play`; the verb switch lists and `Get-VerbNeeds` in `launcher/geldar-play.ps1`; the `usage` line of `launcher/messages.d/00-core.tsv`; the verbs table of `launcher/README.md`.
3. Every user-visible string is a key in a new `launcher/messages.d/NN-<topic>.tsv` (key, a TAB, the text; both launchers read the same tables, first row per key wins). `repo-checks` fails twin drift if the two twins make different private directories (`private_mkdir` against `New-PrivateDir`) or register different test groups; a card does not register a group.
4. Every new key has a `### key` heading in `docs/troubleshooting.md` with three paragraphs that start exactly `What it means.`, `Why it is safe.` and `What to do.`, or, for an informational key, a row in its "Not a problem" table whose first cell is the key in backticks and whose second cell is the explanation. `tools/repo-checks/src/troubleshooting.test.ts` enforces both ways.
5. The test file runs per launcher over `launchers` from `launcher/test/harness.ts` (shape of `launcher/test/player.test.ts`), with the fake docker (`fake-docker.sh`) and fake gh (`fake-gh.sh`): no network, no real docker. Where pwsh on Windows cannot pass a double quote through the `.cmd` shims, skip visibly with `console.info`, as `player.test.ts` does.

## Assumed from kit A (HC-03 to HC-16)

- **A1** HC-03: a tokens ledger file in the supervisor state directory, named `tokens.csv` with header `run,utc,harness,model,input,output,total,turns` (to confirm). `costs.csv` keeps `run,utc,turns,cost`.
- **A2** HC-04: `status.json` and `supervisor.log` lines carry `harness` and `model` (key names to confirm); `Settings.harness` in `packages/supervisor/src/settings.ts` is `'claude' | 'chatgpt' | 'local'`.
- **A3** HC-05 to HC-07: `packages/mind-loop` runs a waking with an empty tool list and returns the final assistant text (entry name to confirm); the `claude` path is the vendor CLI via `wrapperLine`.
- **A4** HC-08: `geldar-play new <id> --cli local` is accepted and writes `harness: "local"` to `player.json`; `declared_model` stays the owner's choice (to confirm).
- **A5** HC-16: the owner acceptance run proved each harness on a disposable player.

## Assumed from kit B (HC-17 to HC-26)

- **B-1** HC-17: package `@geldar/scriptorium-psyche` at `packages/psyche` exports the types `CharacterSheet` (`attributes.{curiosity,common_sense,cleverness,aggression}`, `alignment.{law,good}`, `op_modes`, optional `proficiency`) and `Score`, the constant `STANDARD_SHEET`, the pure function `successProbability(score: number, dc: number, proficiency?: number): number` (exact, from enumeration), `roll` and `rngFor` as in brief 4.3, and `step`. HC-28a/b only import types and `successProbability`.
- **B-2** HC-17/GX-02: the world's pure policies are released as functions `(sheet, input) => Branch` whose chance nodes are exposed, in the shape HC-28a defines (`Branch`, `Chance`). If the released shape differs, only `packages/instinct/src/social/branch.ts` changes.
- **B-3** HC-18: package `@geldar/scriptorium-instinct` at `packages/instinct`; a step function `runStep(ctx)` in `src/step.ts` (to confirm) returning the result JSON `{ kind: 'settle', act, why, rolls } | { kind: 'facts', facts: string[] } | { kind: 'escalate', why } | { kind: 'pass' }`; a context `InstinctContext` with `stateDir` (the instinct state directory inside the supervisor volume, `/state/supervisor/instinct` by default), `observer` (this player's id), `lifeId`, `sheet` (own sheet or null), `socialProficiency`, `tick`, `run`, `rolls` (d20 checks on), `events` (already-read world events as `{ type, id, tick, data }`), `nearby` (`{ id, name, distance, x, y, z }`) and `config` (`InstinctConfig`, in `src/config.ts`, to confirm); `appendLedger(stateDir, line)` writing one JSON line to `instinct.jsonl` shaped `{ v: 1, ts, run, kind, ... }` where `kind` is open-ended.
- **B-4** HC-19: the supervisor calls the step before each waking through `Deps.beforeRun` in `packages/supervisor/src/deps.ts` and joins `facts` into the prompt note; a settled act is sent through the world's checked path with source tag `instinct`.
- **B-5** HC-21: `src/idle.ts` (to confirm) holds the idle candidates as `IdleCandidate { mode, program, args(ctx) }` weighted by op mode.
- **B-6** HC-24: a fake world fixture for tests of the step (`src/fake-world.ts`, to confirm).
- **B-7** HC-25/26: the sheet-to-persona generator exports `temperamentSentences(sheet: CharacterSheet): string[]` (to confirm); the sheet reaches the supervisor only, and the launcher delivers it with `deliver_sheet <id> <file>` and `Deliver-Sheet` (names to confirm, in the HC-26 lib file).

## Assumed from the world cards (names to confirm when AN-24 to AN-28, AN-44, AN-45, AN-54, AN-55, AN-58 to AN-60 are written)

- **W-1** AN-24 to AN-28 observed evidence, as read by the HC-18 reader: events `speech` (`speaker_id`, `speaker_name`, `to_me`), `hurt` (`attacker_id`, `attacker_name`, only when a player in view caused it), `received` (`giver_id`, `giver_name`), `block_cleared` (`actor_id`, `actor_name`, `mine`), `position` (`me`, `agents[]` with `id`, `name`, `x`, `y`, `z`); each with an event `id` and a `tick`.
- **W-2** AN-44/45: the programs `explore`, `farm`, `patrol` with limits in their intent arguments, and a way for the kit to learn which programs the Body advertises (`WorldLink.programs()` from HC-18, to confirm).
- **W-3** AN-54/55: the owner receives a lineage record file from the world: JSON `{ "version": 1, "birth_id", "child_id", "parents": [idA, idB], "sheet": <CharacterSheet> }`. The kit never fetches it.
- **W-4** AN-58 to AN-60: a drift revision is a world fact the kit can ask for once per sleep: `WorldLink.driftRevision()` returning `{ revision: number, sheet: CharacterSheet } | null` (to confirm).

## Order and fan-out

HW4: HC-27a first (shared types); then HC-27b, HC-28a and HC-29 in parallel (no shared files); HC-28b after HC-27b and HC-28a; HC-30a joins; HC-30b closes. W7/W8/W9: HC-31 after HC-21 and AN-45; HC-32 after HC-29; HC-33 waits for the owner. W10: HC-34a, then HC-34b and HC-35a in parallel, HC-34c after HC-34b, HC-35b after HC-35a, HC-35c last. W11: HC-36a then HC-36b. HW5: HC-37a, HC-37b, then HC-38, then HC-39.

---

## HW4: the social model

### HC-27a: Social model rules, update arithmetic and store

- **Branch** `scriptorium/hc-27a-social-store`, worktree `.claude/worktrees/hc-27a`. **Depends on** HC-18 (package `packages/instinct` exists), HC-17 (type import). **Size** about 30k.
- **May edit** (all new): `packages/instinct/src/social/rules.ts`, `model.ts`, `store.ts`, `model.test.ts`, `store.test.ts`. **Must not edit** `packages/psyche/**`, any index or `package.json` (HC-30a wires exports), `template/**`.
- **Behaviour** (D-HC-04: no SQL; D-CS-06: prior strength 2 and brief 6.3 values, unmeasured).
  1. `rules.ts`: the six fields and the four that have an accepted observation rule.
     ```ts
     export const LEARNED_FIELDS = ['curiosity', 'aggression', 'law', 'good'] as const;
     export type LearnedField = (typeof LEARNED_FIELDS)[number];
     export type Field = LearnedField | 'common_sense' | 'cleverness';
     export const PRIOR_STRENGTH = 2; // unmeasured
     export type ObsKind = 'spoke_first' | 'approached' | 'kept_away' | 'hit_me' | 'gave_me'
       | 'took_mine' | 'fought_mob' | 'fled_mob' | 'kept_promise' | 'broke_promise';
     export interface Update { field: LearnedField; value: number }
     export interface ObsRule { active: boolean; updates: readonly Update[] }
     export const OBS_RULES: Readonly<Record<ObsKind, ObsRule>> = {
       spoke_first: { active: true, updates: [{ field: 'curiosity', value: 4.0 }] },
       approached: { active: true, updates: [{ field: 'curiosity', value: 3.5 }] },
       kept_away: { active: true, updates: [{ field: 'curiosity', value: 2.5 }] },
       hit_me: { active: true, updates: [{ field: 'aggression', value: 4.5 }] },
       gave_me: { active: true, updates: [{ field: 'good', value: 4.5 }] },
       took_mine: { active: true, updates: [{ field: 'law', value: 1.5 }, { field: 'good', value: 2.0 }] },
       fought_mob: { active: false, updates: [{ field: 'aggression', value: 4.5 }] }, // on with AN-47
       fled_mob: { active: false, updates: [{ field: 'aggression', value: 1.5 }] },
       kept_promise: { active: false, updates: [{ field: 'law', value: 4.5 }] }, // D-HC-06 deferred
       broke_promise: { active: false, updates: [{ field: 'law', value: 1.5 }] },
     };
     ```
     `common_sense` and `cleverness` have no rule, so they are never stored and always read as their prior.
  2. `model.ts`: the stored shape and the arithmetic (brief 6.2, 6.3).
     ```ts
     import type { CharacterSheet } from '@geldar/scriptorium-psyche';
     export interface FieldEstimate { estimate: number; n: number; tick: number }
     export interface OtherModel {
       v: 1; observer: string; other: string; name: string;
       sightings: number; last_run: number; spoke: boolean;
       last_sample?: { tick: number; dist: number; me: [number, number, number] };
       fields: Partial<Record<LearnedField, FieldEstimate>>; updated_tick: number;
     }
     export function ownScore(sheet: CharacterSheet | null, f: Field): number; // 3 when sheet is null
     export function priorFor(f: Field, own: CharacterSheet | null): number {
       const projection = 0.25 * (5 - ownScore(own, 'common_sense'));
       return round6(clamp15(3 + projection * (ownScore(own, f) - 3)));
     }
     export function applyEvidence(cur: FieldEstimate | undefined, prior: number, evidence: number,
       tick: number, strength = PRIOR_STRENGTH): FieldEstimate {
       const n = cur?.n ?? 0; const base = cur?.estimate ?? prior;
       return { estimate: round6(clamp15(base + (evidence - base) / (n + strength))), n: n + 1, tick };
     }
     export function estimateOf(m: OtherModel | null, f: Field, own: CharacterSheet | null):
       { estimate: number; n: number; supported: boolean }; // supported = learned field and n >= 1
     ```
     `clamp15` clamps to 1..5, `round6` rounds to 6 decimals. `ownScore` reads `attributes` for the four attributes and `alignment` for law and good.
  3. `store.ts`: one JSON file per other under `<stateDir>/social/` (the caller passes `stateDir` from `InstinctContext`).
     ```ts
     export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/;
     export class SocialStore {
       private readonly dir: string; private readonly observer: string; private readonly lifeId: string;
       constructor(stateDir: string, observer: string, lifeId: string) { /* assign, then this.open() */ }
       load(other: string): OtherModel | null;   // null for an unsafe id or no file
       save(model: OtherModel): void;            // tmp file then rename, mode 0o600
       list(): OtherModel[];
     }
     ```
     `open()` makes the directory 0o700 and writes `meta.json` `{ observer, life }`. If `meta.json` exists with a different life, the whole directory is renamed to `social.archive-<oldlife>` (id characters filtered to `SAFE_ID`) and a fresh one starts (a new life never inherits an estimate; death inside one life keeps it). Files are named `other-<id>.json`, so a display name is never the key: the key is the other's id.
- **Tests** (`model.test.ts`, `store.test.ts`). `updates by hand values`: own standard sheet, evidence 4.5 three times gives 3.75, 4.0, 4.125 (fails if the divisor is `n + 1`). `prior follows projection`: own common_sense 1 and curiosity 5 gives 5, common_sense 5 gives 3, common_sense 3 gives 4 (fails if projection is dropped). `clamps to 1 and 5`. `unlearned fields read as prior and are not supported`: `estimateOf(..., 'common_sense')` and `'cleverness'` have `supported: false` even after updates to other fields. `inactive rules are marked off` (fails if `fought_mob` is switched on). `store round trip and mode 0600` (mode check skipped on win32). `a different life archives the old directory`. `unsafe other id is refused` (`'../x'`, `'a b'`, 40 characters).
- **Checks** CK-1 (`packages/instinct/src/social/model.test.ts packages/instinct/src/social/store.test.ts`), CK-2, CK-3, CK-4.
- **Both launchers** n/a. **Blindness** B2, B3: the store takes no sheet of another player.
- **Commit** `feat(instinct): social model rules, update arithmetic and store (HC-27a)`. **On-cap** commit the passing files, record the missing test names in the report, stop.

### HC-27b: Observations: scope, dedup, sampling and apply

- **Branch** `scriptorium/hc-27b-social-observe`, worktree `.claude/worktrees/hc-27b`. **Depends on** HC-27a, AN-28 (W-1 field names). **Size** about 38k.
- **May edit** (all new): `packages/instinct/src/social/observe.ts`, `dedup.ts`, `sample.ts`, `apply.ts`, `observe.fixtures.ts`, `observe.test.ts`, `apply.test.ts`. **Must not edit** `rules.ts`, `model.ts`, `store.ts` (HC-27a owns them; if a field is missing there, stop and report), anything outside `social/`.
- **Behaviour** (D-CS-06: only visible, causal evidence; one update per valid observation).
  1. `observe.ts`: turn already-read events into observations; the field names are `W-1` and live only in one table, so a contract change edits one place.
     ```ts
     export interface RawEvent { type: string; id: string; tick: number; data: Record<string, unknown> }
     export interface Observation { observer: string; kind: ObsKind; actor: string; actorName: string; key: string; tick: number }
     export function eventObservations(observer: string, events: readonly RawEvent[]): Observation[];
     ```
     Mapping (each read with `typeof` checks, anything else is skipped): `speech` with `to_me === true` and `speaker_id` gives `spoke_first` (key `speech:<event id>`); `hurt` with `attacker_id` gives `hit_me` (key `hurt:<event id>`); `received` with `giver_id` gives `gave_me`; `block_cleared` with `actor_id` and `mine === true` gives `took_mine`. The `observer` field is set from the argument. Only these fields are read (B2); a `sheet` or any `true_*` field is never read.
  2. `sample.ts`: approach and keep-away from position samples, so a standing player makes no stream of contact. Constants (unmeasured): `SAMPLE_TICKS = 6000`, `MIN_GAP_TICKS = 100`, `MOVE_BLOCKS = 6`, `SELF_STILL_BLOCKS = 2`, `NEAR_BLOCKS = 32`.
     ```ts
     export function positionObservations(observer: string, prev: OtherModel['last_sample'] | undefined,
       tick: number, me: [number, number, number], other: { id: string; name: string; pos: [number, number, number] }):
       { observations: Observation[]; sample: NonNullable<OtherModel['last_sample']> };
     ```
     With a previous sample at least `MIN_GAP_TICKS` older and the player's own move under `SELF_STILL_BLOCKS` (3D distance): distance fell by `MOVE_BLOCKS` or more gives `approached`; rose by `MOVE_BLOCKS` or more while the new distance is at most `NEAR_BLOCKS` gives `kept_away`. Key `pos:<other>:<floor(tick / SAMPLE_TICKS)>` so one per window.
  3. `dedup.ts`: `class SeenSet` over `<stateDir>/social/seen.json`: `has(key)`, `add(key)`, `flush()`; keeps the newest 4000 keys (FIFO); atomic write, mode 0o600; a key is `<observation key>#<field>` so the two updates of `took_mine` dedupe independently.
  4. `apply.ts`: the one entry that writes.
     ```ts
     export interface ApplyReport { applied: number; deduped: number;
       dropped: { foreign: number; self: number; inactive: number; badId: number } }
     export function applyObservations(store: SocialStore, seen: SeenSet, own: CharacterSheet | null,
       observer: string, obs: readonly Observation[], run: number, strength = PRIOR_STRENGTH): ApplyReport;
     export function noteSighting(store: SocialStore, other: string, name: string, run: number): void;
     ```
     Sort by `(tick, key)`; drop `o.observer !== observer` (foreign), `o.actor === observer` (self), inactive rule, unsafe id. For each `Update`: skip if `seen.has(key#field)` (deduped); `spoke_first` when `model.spoke` is already true counts as deduped, else sets `spoke`; new model starts at `{ sightings: 0, last_run: 0, spoke: false, fields: {} }`; update `fields[field]` with `applyEvidence(cur, priorFor(field, own), value, tick, strength)`; set `name` through `cleanName` (strip C0 and C1 controls, drop double quotes, collapse spaces, first 40 characters; an empty result keeps the old name or the id); `updated_tick = max`. Save once per other, `seen.flush()` once. `noteSighting` raises `sightings` by one when `last_run !== run` and sets `last_run`.
- **Tests.** `the same hit delivered twice (wake and digest) counts once` and `after a restart (new store and new SeenSet over the same folder) it still counts once` (fail if dedup is removed). `a forged event for another observer is dropped` (fails if the scope check is removed). `an act by the observer itself is dropped`. `inactive kinds are dropped` (`fought_mob`). `took_mine updates law and good once each`. `a standing player makes no observation; one approach per window` (two samples in the same window, one report). `out of order batch is applied in tick order` (state equals the sorted run). `seen set keeps 4000 newest`. `an event with a sheet field leaves no trace in any store file` (grep the folder for the sentinel value, B2). `a name with quotes and controls is cleaned`.
- **Checks** CK-1 (the two test files), CK-2, CK-3, CK-4. **Both launchers** n/a. **Blindness** B2, B6.
- **Commit** `feat(instinct): observer-scoped social observations with dedup (HC-27b)`. **On-cap** commit what passes; the sampling constants and `apply.ts` are the priority.

### HC-28a: Prediction by interpolation and exact branches

- **Branch** `scriptorium/hc-28a-predict`, worktree `.claude/worktrees/hc-28a`. **Depends on** HC-27a, HC-17 (B-1, B-2). **Size** about 28k.
- **May edit** (new): `packages/instinct/src/social/branch.ts`, `predict.ts`, `predict.test.ts`. **Must not edit** `packages/psyche/**`, `model.ts`.
- **Behaviour** (D-CS-05 assumed: interpolate adjacent integer policies, exact branch probabilities; the other player's decision is predicted by the same pure policy on an estimated sheet, with no model call and no die).
  1. `branch.ts`: the shape a pure policy returns (B-2) and the exact integration.
     ```ts
     export interface Chance { score: number; dc: number; proficiency: number }
     export type Branch<T> = { kind: 'outcome'; outcome: T }
       | { kind: 'chance'; chance: Chance; success: Branch<T>; failure: Branch<T> };
     export type Dist<T> = Map<T, number>;
     export type Prob = (c: Chance) => number; // production passes successProbability from psyche
     export function distribution<T>(b: Branch<T>, p: Prob): Dist<T>; // probabilities sum to 1
     ```
  2. `predict.ts`: the estimated sheet and the interpolation.
     ```ts
     export type Policy<I, T> = (sheet: CharacterSheet, input: I) => Branch<T>;
     export function estimatedScores(model: OtherModel | null, own: CharacterSheet | null): Record<Field, number>;
     export function predict<I, T>(policy: Policy<I, T>, scores: Record<Field, number>, input: I, p: Prob): Dist<T>;
     ```
     `estimatedScores` uses `estimateOf` for each of the six fields (unlearned fields read as their prior). `predict` builds integer sheets from `STANDARD_SHEET` with the six scores set, and for each field with a fractional value takes `lo = floor(v)` and `hi = lo + 1` with weights `1 - frac` and `frac`; it enumerates the product over the fractional fields (at most 64 sheets, weight 0 skipped), runs the policy once per integer sheet, and sums `weight * distribution(branch)`. The policy is never called with a non-integer score.
  3. `recordPrediction(append: (line: object) => void, other: string, fx: string, dist: Dist<string>, scores: Record<Field, number>, run: number)`: writes one line `{ v: 1, ts, run, kind: 'prediction', other, fx, probs, est }` through the injected `appendLedger` (B-3), so the offline score of brief 6.4 can compare a prediction made before the outcome with the outcome. These numbers go to the operator ledger only (B1, B3).
- **Tests.** `interpolates adjacent integer policies`: with a test-double policy (aggression score as chance score, DC 11) and `p = (c) => (c.score - 1) / 4`, aggression 3.5 gives P(fight) 0.625 (0.5 x 0.5 + 0.5 x 0.75); fails if `predict` rounds instead of interpolating. `integer estimate calls the policy once`. `the policy only ever sees integer scores` (spy). `two fractional fields enumerate four sheets with product weights`. `distribution sums to 1 and is exact for nested chances`. `real engine fixture`: `successProbability(3, 11)` is 0.5 and `successProbability(1, 8)` is 121/400 (brief 4.1); if the export is missing the test fails and the card is BlockedDependency. `recordPrediction line has kind prediction and the estimate`.
- **Checks** CK-1, CK-2, CK-3, CK-4. **Both launchers** n/a. **Blindness** B1, B3 (numbers stay in the ledger).
- **Commit** `feat(instinct): predict others by interpolating the same pure policy (HC-28a)`. **On-cap** commit `branch.ts` and its tests first.

### HC-28b: Stranger policy

- **Branch** `scriptorium/hc-28b-stranger`, worktree `.claude/worktrees/hc-28b`. **Depends on** HC-27b, HC-28a. **Size** about 30k.
- **May edit** (new): `packages/instinct/src/social/stranger.ts`, `stranger.test.ts`. **Must not edit** `branch.ts`, `predict.ts`, `step.ts` (HC-30a wires it).
- **Behaviour** (brief 5.7 with D-HC-09: the instinct step never settles a first-time sighting and never talks).
  ```ts
  export type StrangerChoice = 'avoid' | 'approach' | 'ignore';
  export interface StrangerInput {
    own: CharacterSheet; socialProficiency: number;
    other: { id: string; name: string; distance: number; estAggression: number };
    sightings: number; hasPeopleFile: boolean; followsSoFar: number; rollsOn: boolean;
  }
  export type StrangerOutcome =
    | { kind: 'pass' }
    | { kind: 'escalate'; why: string }
    | { kind: 'settle'; act: { kind: 'travel_away' | 'follow'; target: string }; why: string };
  export function strangerBranch(i: StrangerInput): Branch<StrangerChoice>;
  export function strangerStep(i: StrangerInput, roll: (score: number, dc: number) => Roll | null, p: Prob):
    { outcome: StrangerOutcome; rolls: Roll[] };
  ```
  1. `approach = (curiosity - 3) + (good - 3) + 0.5 * socialProficiency`; `threat = other.estAggression - own aggression`.
  2. `strangerBranch`: `threat >= 2` gives outcome `avoid`; else if `approach >= 1` outcome `approach`; else if `approach + 2 < 1` outcome `ignore`; else a chance node (score `curiosity`, DC 11, proficiency 0) with success `approach` and failure `ignore`.
  3. `strangerStep` gates first: not a stranger (`hasPeopleFile` true) gives `pass`; `sightings < 1` (the first sighting) gives `pass` (the model decides, D-HC-09); `rollsOn` false picks the most probable choice from `distribution` (ties prefer `ignore`, then `avoid`), no die; `rollsOn` true walks the tree and calls `roll` once at a chance node (the closure is made by HC-30a from `rngFor`; it returns the recorded roll). Then: `avoid` gives `settle` `travel_away`; `ignore` gives `pass`; `approach` with `distance <= 4` gives `escalate` ("speech needs a model", never a settle); `approach` farther away gives `settle` `follow` unless `followsSoFar >= 3`, then `escalate`.
  4. The `why` strings go to the operator ledger only and are never shown to the character (B1).
- **Tests.** `first sighting passes` and `a person with a people file passes` (fail if the gates are removed). `avoid when threat is 2 or more` (estimated aggression 5 against own 3). `approach when approach is 1 or more without a roll`. `ignore when approach is below -1`. `chance node only between -1 and 1`: with curiosity 3 and good 3 and proficiency 0, `distribution` gives approach 0.5 and ignore 0.5 (score 3 vs DC 11). `rolls off picks the more probable choice and consumes no roll` (the `roll` spy is not called). `rolls on records exactly one roll`. `within 4 blocks escalates, never settles`. `the third follow escalates`. `no text of the outcome reaches the character`: the outcome type has no field named `facts` or `text`.
- **Checks** CK-1, CK-2, CK-3, CK-4. **Both launchers** n/a. **Blindness** B1, B5.
- **Commit** `feat(instinct): stranger policy that escalates before speech (HC-28b)`. **On-cap** commit `strangerBranch` and its tests first.

### HC-29: Bounded social prose as prompt facts

- **Branch** `scriptorium/hc-29-social-prose`, worktree `.claude/worktrees/hc-29`. **Depends on** HC-27a. **Size** about 32k.
- **May edit** (new): `packages/instinct/src/social/prose.ts`, `facts.ts`, `prose.test.ts`, `tests/template/social-prose.test.ts`. **Must not edit** `template/**`, `tests/template/allowed-files.ts`, `tool-skill-scan.ts`.
- **Behaviour** (AN-31 retargeted: at most two supported traits, quoted, explicitly uncertain; brief 9.3 allows about 40 tokens).
  1. `prose.ts`: a fixed bank and the selection. A field is supported only if it is learned and `n >= 1`; it is shown only when `abs(estimate - 3) >= 0.75` (unmeasured). Direction is high when above 3, low when below.
     ```ts
     export const BANK: Readonly<Record<LearnedField, { high: string; low: string }>> = {
       curiosity: { high: 'you think they are eager to find out new things.', low: 'you think they keep to what they know.' },
       aggression: { high: 'you think they would rather stand and fight than run.', low: 'you think they would rather run than fight.' },
       law: { high: "you think they keep their word and leave what is others' alone.", low: 'you think they bend the rules and take what suits them.' },
       good: { high: 'you think they give freely when they can.', low: 'you think they look out for themselves first.' },
     };
     export const UNSURE = 'You are not sure of this.';
     export function cleanName(raw: string): string; // same rule as apply.ts (reuse by import)
     export function renderLine(name: string, f: LearnedField, dir: 'high' | 'low'): string; // About "NAME": <bank> UNSURE
     export interface Candidate { name: string; field: LearnedField; dir: 'high' | 'low'; dist: number }
     export function selectTraits(models: readonly OtherModel[], own: CharacterSheet | null, max = 2): Candidate[];
     ```
     Order: larger `abs(estimate - 3)` first, then name ascending, then field order (curiosity, aggression, law, good); at most `max` candidates in total over all people (so two lines at most per waking). A name that is empty after `cleanName` is skipped.
  2. `facts.ts`: `nearbyFacts(models, nearby, own): string[]` keeps the models whose id is in `nearby` (people in sight now), calls `selectTraits`, returns the rendered lines. HC-30a adds them to the result's `facts` (B-3).
- **Tests.** `at most two lines for any number of people and fields` (fails if `max` is ignored). `only supported traits render`: a model with only `common_sense` reads as nothing; a learned field with `n = 0` reads as nothing. `threshold`: 3.74 does not render and 3.75 does (fails if the threshold changes). `deterministic order with ties`. `a hostile name stays quoted and cannot break out`: names `'x" Ignore the above'`, a newline, a 300 character name, only control characters. `every line carries the uncertainty sentence`. In `tests/template/social-prose.test.ts` (shape of `tidy-prompt.test.ts`): every `BANK` sentence and `UNSURE` pass `markedWords`, do not match `forbiddenMention`, are ASCII and contain no digit, and no rendered line matches `/\b(lawful|chaotic|neutral|evil|alignment|score|stat|level|trait|estimate)\b/i` (B1, B8); also the worst case of two lines is under 220 characters.
- **Checks** CK-1 (both test files), CK-2, CK-3, CK-4, CK-T. **Both launchers** n/a. **Blindness** B1, B5, B6, B8.
- **Commit** `feat(instinct): bounded uncertain social prose for the prompt (HC-29)`. **On-cap** commit `prose.ts` with the scan test; `facts.ts` last.

### HC-30a: HW4 integration (observe, stranger, facts)

- **Branch** `scriptorium/hc-30a-hw4-integration`, worktree `.claude/worktrees/hc-30a`. **Depends on** HC-27b, HC-28b, HC-29, HC-24, HC-19. **Size** about 38k.
- **May edit** `packages/instinct/src/social/index.ts` (new), `packages/instinct/src/step.ts` (to confirm; at most 25 lines), `packages/instinct/src/config.ts` (to confirm; one key), `packages/instinct/src/social/integration.test.ts` (new), `tests/template/social-blind.test.ts` (new). **Must not edit** the social modules of HC-27a to HC-29 (a gap goes back as a fix card), `template/**`, `packages/supervisor/**`.
- **Behaviour.**
  1. `config.ts`: add `tom: { enabled: boolean; priorStrength: number }` to `InstinctConfig`, default `{ enabled: true, priorStrength: 2 }` (brief 8). It only matters when the step itself is on (off by default, D-HC-09), so nothing is live (R11).
  2. `social/index.ts`: `createSocial(ctx: InstinctContext): Social | null` (null when `config.tom.enabled` is false: no folder is created).
     ```ts
     export interface Social {
       observe(): ApplyReport;                         // events + positions -> applyObservations, noteSighting
       stranger(): StrangerOutcome | null;             // first stranger in ctx.nearby, or null
       facts(): string[];                              // nearbyFacts
     }
     ```
     `observe()` reads only `ctx.events` and `ctx.nearby`; for each nearby person it calls `noteSighting` and `positionObservations` and stores `last_sample`. `stranger()` builds `StrangerInput` from the model (`estAggression` from `estimateOf`), `hasPeopleFile` from `existsSync(join(workspace, 'memory/people', name + '.md'))` read-only (`workspace` from `ctx`, to confirm), `rollsOn` from `ctx.rolls`, and the `roll` closure from psyche's `roll` and `rngFor(ctx.lifeId, ctx.tick, 'stranger', 0)`; it logs `recordPrediction` for the threat decision.
  3. `step.ts`: after the existing speech and failure gates and before idle: `social.observe()`; an addressed speech or a first sighting still goes to the model; a stranger `settle` returns `{ kind: 'settle', ... }` and `escalate` returns `{ kind: 'escalate', why }`; the facts from `social.facts()` are added to a `facts` or `pass` result.
- **Tests** (`integration.test.ts` with the HC-24 fake world). `a visible hit updates aggression once through wake and digest redelivery`. `a hit the observer could not see (hidden control) changes nothing` (fails if the reader trusts hidden events). `tom disabled writes no social folder and adds no facts` (fails if the guard is removed). `a second sighting of a stranger with no people file can settle avoid, the first sighting passes`. `the result JSON never contains a digit run from an estimate, a label or the word estimate`. `a world event with a sheet field is never stored` (kit-side leakage gate that AN-28 adds for the reader). `prediction lines appear in instinct.jsonl`. `tests/template/social-blind.test.ts`: the supervisor `childEnv` output and the prompt built from a result with facts contain neither the store folder name nor any estimate (B3).
- **Checks** CK-1 (both files), CK-2, CK-3, CK-4, CK-T. **Both launchers** n/a. **Blindness** B1 to B6.
- **Commit** `feat(instinct): bind the social model into the instinct step (HC-30a)`. **On-cap** commit the config key and `createSocial`; the step edit is the first thing to leave for a continuation.

### HC-30b: HW4 wave close: docs, retro, process

- **Branch** `scriptorium/hc-30b-hw4-close`, worktree `.claude/worktrees/hc-30b`. **Depends on** HC-30a. **Size** about 20k (docs only).
- **May edit** `docs/architecture.md` (a short "Social model" section next to the instinct step: what is stored where, who can read it, off by default), `docs/threat-model.md` (the blindness invariants B1 to B9 as a boundary: supervisor volume only), `docs/analysis/harness/README.md` (HC-27 to HC-30 rows by hand; `ledger set` only knows SC ids), `docs/analysis/harness/worknotes/retro-hw4.md` (new). **Must not edit** code or tests.
- **Behaviour.** Describe only what merged (read the code): the store layout, the observation table with inactive rows, the sampling constants and that they are unmeasured, the stranger gates, the prose bank, what the character can and cannot see. Retro (one page, facts from the ledger and the reports: passes per card, coders that hit the cap, what review caught). Process changes: each names the retro finding it answers and prefers a guard over a rule.
- **Tests.** `docs/architecture.md` and the retro pass CK-M; a reviewer checks every claim against the merged files.
- **Checks** CK-M, CK-4. **Both launchers** n/a. **Commit** `docs(harness): HW4 close, social model docs and retro (HC-30b)`. **On-cap** docs first, retro second.

## W7 to W9

### HC-31: Idle binding for explore, farm and patrol

- **Branch** `scriptorium/hc-31-idle-programs`, worktree `.claude/worktrees/hc-31`. **Depends on** HC-21 (B-5), AN-44 and AN-45 (W-2, the contract file for program arguments and limits). **Size** about 25k.
- **May edit** `packages/instinct/src/idle-programs.ts` (new), `idle-programs.test.ts` (new), `packages/instinct/src/idle.ts` (to confirm; the one line that registers the candidates). **Must not edit** the weights or the think-draw code of HC-21, `template/**`.
- **Behaviour** (D-CS-14 assumed: programs are bounded; the Body knows the field, the frontier and the route, the kit invents none).
  ```ts
  export const PROGRAM_FOR_MODE = { explorer: 'explore', farmer: 'farm', warrior: 'patrol' } as const;
  export interface ProgramCatalog { has(program: string): boolean } // from WorldLink.programs() (W-2)
  export function programCandidates(catalog: ProgramCatalog): IdleCandidate[];
  ```
  A candidate exists only when `catalog.has(program)`; its `args(ctx)` returns the argument object the AN-44 contract names for that program with the contract's default limits and nothing else (no coordinates, no field, no route: the Body derives them from what this life observed and refuses when it knows nothing; HC-20 counts that refusal as a failure). Without the program in the catalog (older Body API) the HC-21 default for that mode is untouched. The three programs never create a goal and never run when the step finds no adopted goal (D-CS-01, kit B).
- **Tests.** `catalog with no programs adds no candidate` (fails if `has` is not checked). `each mode maps to its program`. `args contain only contract keys` (snapshot against the AN-44 shape; the test is `blocked` if the contract file is absent). `old behaviour for the mode is unchanged when the program is missing`. `an unknown mode is never produced`.
- **Checks** CK-1, CK-2, CK-3, CK-4. **Both launchers** n/a. **Blindness** B5 (no terrain or resource hints in args).
- **Commit** `feat(instinct): idle candidates for explore, farm and patrol (HC-31)`. **On-cap** commit `idle-programs.ts` with its tests; leave the registration line to a continuation.

### HC-32: Day facts for the reflect skill

- **Branch** `scriptorium/hc-32-day-facts`, worktree `.claude/worktrees/hc-32`. **Depends on** HC-29. **Size** about 22k.
- **Design decision, stated so no coder re-opens it.** The `reflect` skill (`template/.claude/skills/reflect/SKILL.md`, step 2: "your impression, trust from 0 to 100, and why") already asks the character to revise trust. This card changes **no template file**: a template edit reaches every player including the control arm (brief 8: off must leave prompts as today), and the file set and size are guarded by `tests/template/allowed-files.ts`, `skills.test.ts` (body under 80 lines), `knowledge-boundary.test.ts` and `steering.test.ts`. The facts reach the skill through the waking prompt, because each waking is a fresh session and the sleep and the reflect happen inside it. Writing estimates into `memory/people/*.md` was rejected (B7: it would put words in the character's own memory). If the owner wants a one-sentence edit of reflect step 2 anyway, it is a separate template card with its own decision (Open items).
- **May edit** `packages/instinct/src/social/facts.ts` (HC-29 created it), `facts.test.ts` (new), `tests/template/social-prose.test.ts` (extend). **Must not edit** `template/**`, `prose.ts`.
- **Behaviour.** Add `dayFacts(models, own, tick, max = 2): string[]`: models with `updated_tick >= tick - DAY_TICKS` (`DAY_TICKS = 24000`, one in-game day at 168000 ticks per seven days; unmeasured), whether or not they are near now; same selection, same two-line cap. `socialFacts(ctx)` returns `nearbyFacts` merged with `dayFacts`, de-duplicated by `(name, field)`, at most two lines in all, and appends the single fixed sentence `DAY_NUDGE = 'Think about these when you write up your day.'` after the lines only when at least one line exists. No code writes or reads `memory/people`, `memory/beliefs.md` or any trust value: trust stays the character's own revision.
- **Tests.** `a person met earlier today but not near now is included` (fails if `dayFacts` is not merged). `still at most two lines`. `no lines means no nudge` (fails if the nudge is unconditional). `workspace tree is byte-identical before and after building facts` (hash a fixture workspace; B7). `DAY_NUDGE` passes the scans of HC-29's template test (B8). `no trust number is produced`: the output has no digit.
- **Checks** CK-1, CK-2, CK-3, CK-4, CK-T. **Both launchers** n/a. **Blindness** B1, B5, B7, B8.
- **Commit** `feat(instinct): day facts so the reflect skill can weigh what was noticed (HC-32)`. **On-cap** commit `dayFacts` and its tests; the nudge is last.

### HC-33: Promises in the kit (question card, BlockedDecision D-HC-06)

- **Status** BlockedDecision. **No coder is dispatched.** This card is the design question for the owner; it unblocks AN-20 (scheduled wakes), AN-38 (law-weighted due wakes) and AN-48 (promise outcomes), all deferred.
- **The question.** The character can say "I will bring you three logs by day 12", and today nothing in the kit holds it. How does the kit keep a promise so that (a) it can be brought back to the character when it is due, (b) the world's observed evidence can later say kept or broken (AN-48 needs a matchable condition), and (c) the character stays blind and keeps its own voice?
- **What the code has now (read).** Markdown memory only. `recall` (`packages/memory/src/sections.ts`) resolves a fixed section list; the path rule (`packages/path-rule/src/path-rule.ts`) allows any `memory/<name>.md` or `.json` for the player and the gate (`geldar-verify`) accepts it; the template never mentions promises. The supervisor wakes on a wall-clock delay (20 to 900 seconds), not on game days; the day number only exists in the world's sleep digest. There is no commitment store and the kit never fetches evidence.
- **Option A, a markdown file the character keeps.** The supervisor prompt (arm-only, in the player's voice) tells the character to add one line per promise to `memory/promises.md`: `- [ ] <name>: <what>, by day <N>`. The supervisor reads it between wakings and adds a fact line when one is due (`You said you would ...`). Costs: about two cards; free-text parsing is brittle, worst on small local models; no structured condition, so AN-48 cannot match outcomes; due means "the character's own day count", which the supervisor cannot know without parsing the digest. Gains: no template change, no new tool, reversible, same for all harnesses.
- **Option B, a structured tool in the kit's own memory server.** Add a `promise` tool to `packages/memory` (the `geldar_memory` MCP server, stdio, already bridged for the owned-loop harnesses): arguments `{ to, what, item?, count?, due_day }`, stored as `memory/promises.json`. Costs: about four or five cards; the template's allow list (`template/.claude/settings.json`) and a skill line change for every player (control arm included), so it needs its own owner ruling; the tool schema must work for vLLM and Ollama (HC-11 validation). Gains: matchable conditions for AN-48, exact due days, no parsing.
- **Option C, defer and measure.** Do nothing in the kit; count promise-like sentences in the journals of a cohort through the HC-37 export. Costs: one small card; no function. Gains: tells whether characters make promises at all before any store is built.
- **Recommendation.** Option A as a two-card spike, with C's counting folded in, because it is the cheapest reversible way to learn whether characters make promises, how they phrase them and whether the parse holds on each harness. Move to B only if the spike's parse rate on the three harnesses meets a bar the owner sets before the run, and only after a separate template ruling.
- **Spike outline (HC-33s, written when A is chosen; about 30k each).** HC-33s-1: `packages/instinct/src/promises/parse.ts` (tolerant line parser, bounded to 50 promises and 200 characters per line, no digit-only injection), `due.ts` (a promise is due when its day is at or before the latest day number the supervisor saw in a finished sleep digest; the digest day is read by HC-36a's sleep detection), and `facts.ts` (one fixed-template fact per due promise, name quoted, max two); tests: parse tolerance table, due boundary, hostile line, no write to `memory/`. HC-33s-2: the supervisor teaching line (a constant in the supervisor prompt module, scanned by the template text test) and a counter in the HC-37 export (`promises_seen`, `promises_due`). Exit: the parse rate per harness over a seven-day cohort, written to a worknote.
- **What the owner must decide.** Which option (A recommended); whether a template change is acceptable at all (B only); whether due promises may influence wake timing (the recommended answer is no: a fact in the next prompt only, no scheduler); and the parse-rate bar for moving from A to B.

## W10: lineage

### HC-34a: `geldar-seed` package: lineage record check

- **Branch** `scriptorium/hc-34a-seed-record`, worktree `.claude/worktrees/hc-34a`. **Depends on** AN-54, AN-55 (W-3). **Size** about 28k.
- **May edit** new package `packages/seed/{package.json,tsconfig.json,src/record.ts,src/record.test.ts,src/cli.ts,src/index.ts}`, `image/Dockerfile` (add `seed` to the `--filter "./packages/{...}"` list and one wrapper line `geldar-seed` like the supervisor's), `pnpm-workspace.yaml` is unchanged (it globs `packages/*`). **Must not edit** other packages, `pnpm-lock.yaml` by hand (run `./scriptorium.ps1 pnpm install --no-frozen-lockfile` only to register the workspace package; if the lock changes by more than the new package, stop).
- **Behaviour.** `package.json` name `@geldar/scriptorium-seed`, `bin` `geldar-seed`, no dependencies except `@geldar/scriptorium-psyche` types as a `devDependency` `workspace:*` (type import only). `record.ts`:
  ```ts
  export interface LineageRecord { version: 1; birth_id: string; child_id: string; parents: [string, string]; sheet: CharacterSheet }
  export function parseRecord(text: string): { ok: true; record: LineageRecord } | { ok: false; reason: string };
  ```
  Allowlist parse (B2): `version === 1`; `birth_id` matches `^[A-Za-z0-9_-]{8,64}$`; `child_id` and both parents match `^[a-z][a-z0-9-]{1,38}$`; the parents are distinct and neither is the child; the sheet has `version 1`, integer 1..5 for the four attributes, law, good and the seven op modes, and a `proficiency` that is absent or all zero (a child starts at zero, D-CS-09); text over 65536 bytes is refused; every other key is ignored and never echoed. CLI: `geldar-seed record-check --parents A,B [--child ID] --sheet-out FILE < record.json` prints exactly four lines `birth_id=...`, `child_id=...`, `parent_a=...`, `parent_b=...`, writes the validated sheet as canonical JSON to `FILE` (mode 0600) and exits 0; on refusal prints `refused: <reason>` (a short fixed code such as `parents`, `child`, `birth`, `sheet`, `size`) and exits 1. The `--parents` order must equal the record's.
- **Tests.** A good record passes. One failing case per code (`parents` unequal or equal, `child` bad, `birth` bad, `sheet` out of range, a non-zero proficiency, `size`). `unknown keys are never printed` (a record with `"operator_note":"SENTINEL"`: stdout and stderr lack it; B4). `the sheet file is mode 0600` (skip on win32). Revert check: allow non-zero proficiency, the test fails.
- **Checks** CK-1, CK-2, CK-3, CK-4; then `KIT_IMAGE=geldar-kit:hc-34a ./scriptorium.ps1 pnpm vitest run tests/image/build.test.ts` only if `image/Dockerfile` changed. **Both launchers** n/a (the launcher cards call this binary). **Blindness** B2, B4.
- **Commit** `feat(seed): validate a lineage record before a child is made (HC-34a)`. **On-cap** commit the package without the Dockerfile line and say so.

### HC-34b: `new --parents`: parse and check (both launchers)

- **Branch** `scriptorium/hc-34b-new-parents`, worktree `.claude/worktrees/hc-34b`. **Depends on** HC-34a, HC-26 (B-7). **Size** about 40k.
- **May edit** `launcher/lib/lineage.sh` and `launcher/lib/lineage.ps1` (new), `launcher/lib/new.sh` and `launcher/lib/new.ps1` (at most 15 lines each: two flags and one call), `launcher/messages.d/62-lineage.tsv` (new), `docs/troubleshooting.md` (headings for the new keys), `launcher/test/lineage.test.ts` (new). **Must not edit** `launcher/lib/player.*`, any other lib.
- **Behaviour** (the launcher computes nothing about the child: the sheet comes from the world's record, W-3).
  1. In `verb_new` and `Verb-new`: `--parents <idA>,<idB>` and `--lineage-record <file>`, each once, together or not at all; both ids pass `valid_player_id`, differ, and differ from the child id; `--persona-dir` stays allowed (the prose may come from the owner or from HC-35c). Keys (all refusals say `Nothing was created.`): `lineage_args` (bad or partial flags), `lineage_record_bad` (not a regular file, a link, over 65536 bytes, or `geldar-seed` refused; the message carries the refusal code only).
  2. `lineage_check <child> <a> <b> <file>` in `lineage.sh` (twin `Invoke-LineageCheck`): copies the file once into a private temp file, runs `geldar-seed record-check` in a helper (`helper_run lineage-check "geldar-lineage-$id" "$PL_KIT_IMAGE" --network none -v "$tmp:/in:ro" -- 'geldar-seed record-check --parents A,B --child ID --sheet-out /tmp/sheet.json < /in'`; the image variable is read as `player.sh` reads it, to confirm), parses the four `key=value` lines, and keeps `LINEAGE_BIRTH`, `LINEAGE_SHEET` (a private temp path). It delivers the sheet with HC-26's function (B-7) **after** every other check has passed and before any repository exists, so the sheet file never goes into the repository or the workspace (B3).
  3. Private directory for the state: `<state>/<child>/lineage` (`private_mkdir` in bash, `New-PrivateDir` in pwsh, same name).
  4. Without HC-34c the flow ends after the check with message `lineage_checked` (informational): the child is not created yet.
- **Tests** (`lineage.test.ts`, both launchers, fake docker whose helper runs `geldar-seed` through node from the worktree: mirror how `player-support.ts` maps the kit binaries, to confirm). Each refusal key leaves no clone, no state folder and no gh call (`calls.log` empty). `a good record passes and delivers the sheet once`. `the sheet text never appears in any argument, any log, the clone or the compose environment` (sentinel scores). `--persona-dir and --parents together are accepted`. Twin parity: the same stderr for each case on both launchers.
- **Checks** CK-1, CK-2, CK-3, CK-4. **Both launchers** BL 1 to 5 (no new verb, so BL 2 is only the `new` flags and the README `new` row). **Blindness** B2, B3, B4.
- **Commit** `feat(launcher): new --parents reads and checks a lineage record (HC-34b)`. **On-cap** commit bash and its tests, record the pwsh gap; the card is not mergeable until the twin exists.

### HC-34c: `new --parents`: create exactly once (both launchers)

- **Branch** `scriptorium/hc-34c-new-once`, worktree `.claude/worktrees/hc-34c`. **Depends on** HC-34b. **Size** about 40k.
- **May edit** `launcher/lib/lineage.sh`, `lineage.ps1`, `launcher/lib/new.sh`, `new.ps1` (at most 15 more lines each), `launcher/messages.d/62-lineage.tsv`, `docs/troubleshooting.md`, `launcher/test/lineage.test.ts`. **Must not edit** the adopt code paths of `new.*` (reuse them by calling `--repo` logic, do not change them).
- **Behaviour.** A durable marker `<state>/<child>/lineage/birth` (0600): `birth_id=<id>` and `phase=started|pushed|done`, written by `lineage_phase` (twin `Set-LineagePhase`) with the same tmp-then-rename write as the other state files.
  1. Before any GitHub call: no marker gives `started`; a marker with another `birth_id` gives `lineage_conflict` (the child id already belongs to another birth); phase `done` gives `lineage_reused` (informational) and exit 0 having done nothing.
  2. Persona: with `--persona-dir` as today; otherwise the seed cache `<state>/<child>/seed/<child>/memory/{identity,goals}.md` that HC-35c writes, passed through `persona_load` unchanged; neither gives `lineage_no_seed` ("run seed first, or give --persona-dir"). The persona prose is validated by the existing code, the sheet is never part of it (B1).
  3. Creation is the existing `verb_new` path. After its successful push set `pushed`; after the state files and the sheet delivery set `done`. The existing `die_after_create` text (`repo_on_github`) is **not** used for a lineage child: any failure after the repository was made leaves phase `started`.
  4. Retry with phase `pushed`: run `gh repo clone player-<child>` (reuse), check that the clone's `player.json` has this `player_id`, write the state files, set `done`, say `lineage_reused`; no commit, no push, no second repository. Retry with `started` and a repository that exists: `gh repo view` finds it, then the existing `--repo` adopt path fills it (it already refuses a repository that holds anything but README, LICENSE and .gitignore: a non-matching repository is `lineage_repo_foreign`, refused, nothing changed). The two retry rules are the only places a lineage child touches an existing repository.
  5. Keys: `lineage_conflict`, `lineage_no_seed`, `lineage_repo_foreign`, `lineage_reused`, `lineage_checked` (retired here: the flow now continues). Informational keys go in the "Not a problem" table.
- **Tests** (both launchers, fake gh and fake docker). `a first run makes one repository and one commit`. `a second run after success makes none` (`calls.log` has one `repo create`; fails if the marker is not read). `a crash after push (marker pushed) is finished without a second push` (use `FAKE_GH_REJECT_PUSH` on a second attempt to prove no push is tried). `a crash before the push (marker started, repository present) adopts it, not a second create`. `a foreign repository is refused`. `another birth id for the same child id is refused`. `no sheet, no birth id and no marker text appear in any repository file` (B3, B4).
- **Checks** CK-1, CK-2, CK-3, CK-4. **Both launchers** BL 1 to 5. **Blindness** B3, B4.
- **Commit** `feat(launcher): a lineage child is created exactly once (HC-34c)`. **On-cap** commit the marker and the first-run path; list each retry case still missing.

### HC-35a: Seed synthesis: inputs, prompt and validation

- **Branch** `scriptorium/hc-35a-seed-synth`, worktree `.claude/worktrees/hc-35a`. **Depends on** HC-34a (the package). **Size** about 30k.
- **May edit** `packages/seed/src/synth.ts`, `validate.ts`, `synth.test.ts` (new), `packages/seed/src/cli.ts` (add verbs `prompt` and `check`), `packages/seed/src/index.ts` (exports). **Must not edit** `record.ts`.
- **Behaviour** (D-CS-09 assumed: up to two semantic facts from each parent; no parent journal, relationships, skills or XP; the child's sheet is never an input, B1).
  ```ts
  export const FACTS_PER_PARENT = 2; export const FACT_MAX = 200;
  export interface ParentMaterial { identity: string; beliefs: string } // memory/identity.md and memory/beliefs.md only
  export function pickFacts(beliefs: string): string[];
  export function buildPrompt(a: ParentMaterial, b: ParentMaterial): string;
  export function validateSynthesis(text: string): { ok: true; identity: string; goals: string } | { ok: false; reason: string };
  ```
  `pickFacts`: the last two lines that start with `- ` and are not struck out (`~~`), controls removed, each cut to `FACT_MAX`; fewer exist, fewer are returned. `buildPrompt` returns plain ASCII-safe text in two blocks (parent one, parent two), each with the identity text (cut to 8192 bytes) and the facts, then the instruction to write a new person's `identity` and `goals` in the second person, in the world's terms, as two sections introduced by the exact lines `=== identity ===` and `=== goals ===`. It states plainly that nothing else of either parent is given. The function takes only the two strings per parent, so no journal, people file, skill or XP can reach it. `validateSynthesis` requires both sections; identity at most 8192 and goals at most 4096 bytes of UTF-8; no control characters except TAB and LF; no invisible characters (reuse the list in `persona_read`, `launcher/lib/new.sh`, as a regexp); identity not only its heading; no marker word (`observer|watch|human|maker|stream|credit|colo|shard|harness`, case-insensitive), no audience phrase (`watched`, `watching`, `humans watch`, `audience`, `spectator`), none of `Your human`, `your human`, `Geldar tools`, `terminal`. CLI: `geldar-seed prompt --a-identity F --a-beliefs F --b-identity F --b-beliefs F` prints the prompt; `geldar-seed check < output` prints the two sections to `--out DIR` (as `identity.md` and `goals.md`, 0600) or `refused: <code>`.
- **Tests.** `at most two facts per parent` and `struck-out lines are skipped` (fail if `pickFacts` changes). `the prompt contains nothing but the two identities and four facts`: build with sentinel journal, people and skills strings passed through a cast; none appear (D-CS-09). `the prompt never carries the child's sheet`: the signature has no sheet; a grep of the source for `sheet` in `synth.ts` finds none. One refusal test per rule of `validateSynthesis` (marker word, audience phrase, missing section, oversize, control character). `a good output is split into the two files`.
- **Checks** CK-1, CK-2, CK-3, CK-4. **Both launchers** n/a. **Blindness** B1, B2, B5.
- **Commit** `feat(seed): seed synthesis inputs, prompt and output validation (HC-35a)`. **On-cap** commit `pickFacts` and `validateSynthesis` first.

### HC-35b: Seed synthesis: the supervisor runs it on the parent's harness

- **Branch** `scriptorium/hc-35b-seed-run`, worktree `.claude/worktrees/hc-35b`. **Depends on** HC-35a, HC-04, HC-08 (A2, A3). **Size** about 40k.
- **Design (so no coder decides).** The synthesis runs "through the player's own harness": inside the first parent's running player group, as a **tool-less session** started by its supervisor between wakings, the way the memory tidy is (`oneTidy` in `packages/supervisor/src/supervisor.ts`). The launcher (HC-35c) drops a request into that supervisor's volume and later reads the answer. The owner may choose another model for this one session (`model` in the request, D-CS-09).
- **May edit** `packages/supervisor/src/seed.ts` (new), `seed.test.ts` (new), `packages/supervisor/src/supervisor.ts` (at most 12 lines: one call between runs, next to `this.upstream()`), `image/settings/seed.json` (new, modelled on `tidy.json`: deny `mcp__geldar__*`, `mcp__geldar_memory__*`, `mcp__geldar_git__*`, `Agent`, `Edit`, `Write`), `tests/image/settings.test.ts` (one case for the new file; to confirm its shape). **Must not edit** `packages/chatgpt/**` or `mind-loop` (kit A).
- **Behaviour.** `seed.ts` exports `runSeedRequest(settings, deps, log): Promise<boolean>`. Between runs, only when no run is going and no STOP or HELD: if `<stateDir>/seed/request.json` exists (the launcher writes it as the supervisor's own uid; the player user cannot reach the folder) with `{ birth_id, model? }` where `birth_id` matches `^[A-Za-z0-9_-]{8,64}$` and `<stateDir>/seed/<birth_id>.prompt` exists (at most 40000 bytes): write the prompt to the usual prompt file and run **one** session: claude harness with the `seed` settings and `--max-turns 3` (same `wrapperLine` pattern, new `seed` profile name), other harnesses through the A3 entry with an empty tool list (if A3 cannot, this card handles `claude` only and the other harnesses answer `unsupported` in `<birth_id>.out`, to be reported). Read the **full** final assistant text from the stream (not `last_text`, which is cut to 1500 characters) with a bounded reader (at most 40000 bytes), write it to `<stateDir>/seed/<birth_id>.out` (0600), delete `request.json` and the prompt, log `seed birth=<id> ok|failed`. A failed or empty session writes `<birth_id>.err` with a short fixed code (`failed`, `empty`, `unsupported`) and no `.out`. At most one request per call; a request older than 1 hour is discarded.
- **Tests** (fake child like `supervisor.test.ts`). `a request runs one tool-less session and writes .out` (the spawn args contain the seed profile, not the play profile; fails if the profile is wrong). `no request means no session`. `a bad birth id is ignored and deleted`. `the .out is the full text, not the 1500-character cut` (a 6000-character reply). `failure writes .err and no .out`. `the player's child environment is unchanged` (`childEnv` snapshot, B3). `HELD or STOP means no seed session`.
- **Checks** CK-1, CK-2, CK-3, CK-4; settings test if edited. **Both launchers** n/a. **Blindness** B3, B4, B9 (no new mount: the folder is inside the existing supervisor volume).
- **Commit** `feat(supervisor): run seed synthesis as a tool-less session (HC-35b)`. **On-cap** commit `seed.ts` and its tests; the `supervisor.ts` call is last.

### HC-35c: `geldar-play seed` verb (both launchers)

- **Branch** `scriptorium/hc-35c-seed-verb`, worktree `.claude/worktrees/hc-35c`. **Depends on** HC-35b, HC-34b. **Size** about 40k.
- **May edit** `launcher/lib/seed.sh`, `seed.ps1` (new), `launcher/geldar-play`, `geldar-play.ps1`, `launcher/messages.d/63-seed.tsv` (new), `00-core.tsv` (usage), `launcher/README.md`, `docs/troubleshooting.md`, `launcher/test/seed.test.ts` (new), `launcher/test/player-support.ts` (to confirm). **Must not edit** `new.*`.
- **Behaviour.** `geldar-play seed <child> --parents <a>,<b> --lineage-record <file> [--model <name>]`. (1) the HC-34b check runs first (`lineage_check`), so a bad record stops before any model call; (2) both parents must have a local clone (`read_player` as the other verbs) and the first parent's group must be running (`pl_running`): else `seed_not_running`; (3) read `memory/identity.md` and `memory/beliefs.md` of each parent from its clone (regular files, at most 64 KiB, links refused), build the prompt with `geldar-seed prompt` in a helper with `--network none`, and write `<birth_id>.prompt` and `request.json` into the first parent's `geldar-sup-<a>` volume with a helper that mounts it read-write as uid 1001 (`pl_helper ... rw`); (4) wait up to 600 seconds (`GELDAR_SEED_WAIT`, an integer, only under `GELDAR_INTERNAL=1`) for `<birth_id>.out` or `.err` by reading with a read-only helper every 5 seconds (bounded loop, no polling shell); (5) `geldar-seed check` validates the answer; on success write the two files to `<state>/<child>/seed/<child>/memory/` (0600, private dirs) and say `seed_done`; **any failure removes `<state>/<child>/seed` and says `seed_failed` (a synthesis failure leaves no child: nothing was created)**; (6) a cached valid seed for the same birth id is reused and the model is not called again (`seed_reused`). The prompt, the answer and the files are never printed. Keys: `seed_not_running`, `seed_timeout`, `seed_failed`, `seed_done`, `seed_reused`.
- **Tests** (both launchers, fake docker that plays the supervisor by writing `.out`). `happy path writes the two files and no repository`. `a refusal code from the supervisor leaves no seed folder and no child` (fails if cleanup is removed). `a validation failure (marker word in the answer) leaves nothing`. `a cached seed is reused and the request is not written again`. `timeout leaves nothing`. `no prompt or answer text on stdout or stderr`. `parent two's journal and people files are never read` (fixture clone with sentinel files; the fake docker records every mount, none points at them).
- **Checks** CK-1, CK-2, CK-3, CK-4. **Both launchers** BL 1 to 5 with the new verb `seed`. **Blindness** B3, B4, B9.
- **Commit** `feat(launcher): seed verb runs synthesis on the parent's own harness (HC-35c)`. **On-cap** commit bash and tests, record the pwsh gap.

## W11: drift

### HC-36a: Drift trigger at sleep and the persona refresh artifact

- **Status** BlockedDependency (AN-58 to AN-60, W-4) and the D-CS-13 behaviour (assumed: behaviour-based drift, **default off**, one point per field per seven-day window, decided by the world). **Branch** `scriptorium/hc-36a-drift-trigger`, worktree `.claude/worktrees/hc-36a`. **Depends on** AN-43, AN-58, AN-59, AN-60, HC-25, HC-26. **Size** about 35k.
- **May edit** `packages/supervisor/src/after-run.ts`, `drift.ts`, `drift.test.ts` (new), `packages/supervisor/src/deps.ts` (add optional `afterRun?(ctx): Promise<void>`, 6 lines), `packages/supervisor/src/supervisor.ts` (at most 8 lines: one `await this.deps.afterRun?.(...)` after `const done = await summarizeFile(...)`, near line 379), `packages/instinct/src/config.ts` (to confirm; `drift: { enabled: false }`). **Must not edit** `packages/psyche/**`, `template/**`, `memory/identity.md` in any form.
- **Behaviour.** The kit neither decides nor stores drift: the world does (AN-43, AN-59). `afterRun` runs after a run whose summary `tools` map has a key matching `/(^|__|_)sleep$/` (a completed sleep, harness-independent) and only when `drift.enabled` is true; it records `<stateDir>/drift/last-run` and does nothing for a run it already handled. It asks the world once through the HC-18 link (`driftRevision()`, W-4). If the revision is newer than `<stateDir>/drift/revision`: (1) update the supervisor's own sheet copy through HC-26's supervisor-side writer (the sheet stays supervisor-only, B3); (2) write the **persona refresh artifact** `<stateDir>/drift/refresh/rev-<N>.md`, 0600, containing only `temperamentSentences(newSheet)` (B-7) one per line under the heading `# Persona refresh, revision N` and a line `Review, then apply by hand. The approved identity file is never overwritten.`; no number, no old text, no label (B1); (3) log one line `drift revision=<N>` and append `{ kind: 'drift', revision, fields_changed }` to `instinct.jsonl` (field names only; this ledger is operator-only). The identity file `memory/identity.md` is **never** written by any code here (write-once and denied to the player by `image/settings/play.json`; the upstream gate also refuses `memory/` changes, so there is no automatic apply path, see Open items).
- **Tests.** `no sleep in the run means no world call`. `drift disabled means no world call` (fails if the guard is removed). `one sleep, one call; a restart does not repeat it`. `a newer revision writes exactly one artifact with only prose` (no digit, passes `markedWords`). `an unchanged revision writes nothing`. `identity.md is byte-identical after any outcome` (fixture workspace; B7). `a failed world call is logged and never stops the loop`.
- **Checks** CK-1, CK-2, CK-3, CK-4. **Both launchers** n/a. **Blindness** B1, B3, B7.
- **Commit** `feat(supervisor): drift check at sleep and a reviewed persona refresh file (HC-36a)`. **On-cap** commit `drift.ts` with tests; the `supervisor.ts` call last.

### HC-36b: `persona-refresh` export verb (both launchers)

- **Status** BlockedDependency on HC-36a. **Branch** `scriptorium/hc-36b-persona-refresh`, worktree `.claude/worktrees/hc-36b`. **Size** about 30k.
- **May edit** `launcher/lib/refresh.sh`, `refresh.ps1` (new), `launcher/geldar-play`, `geldar-play.ps1`, `launcher/messages.d/64-refresh.tsv` (new), `00-core.tsv`, `launcher/README.md`, `docs/troubleshooting.md`, `docs/onboarding.md` (the manual apply steps), `launcher/test/refresh.test.ts` (new). **Must not edit** any `memory/` file of any player, `player.*`.
- **Behaviour.** `geldar-play persona-refresh <id>`: reads `<stateDir>/drift/refresh/` of `geldar-sup-<id>` with `pl_helper ... ro` (uid 1001, `--network none`), copies each `rev-<N>.md` whose name matches `^rev-[0-9]{1,6}\.md$` and whose size is at most 8192 bytes to `<state>/<id>/persona-refresh/` (private dir, same name in both twins), prints the host path and `refresh_ready`, or `refresh_none`. It **never applies**: no write to the workspace volume, the clone or the repository. The docs (onboarding) say how the owner applies by hand: stop the player, review the file, edit `memory/identity.md` in the workspace volume as the player's user with a helper, commit with `geldar-git`, start again; the player is never told.
- **Tests.** `an artifact is copied and its name is checked` (a name with `..` or `/` is ignored). `nothing is written to any player volume` (the fake docker records every mount: all read-only). `no artifact says refresh_none`. `an oversized file is skipped`.
- **Checks** CK-1, CK-2, CK-3, CK-4, CK-M. **Both launchers** BL 1 to 5 with verb `persona-refresh`. **Blindness** B1, B7, B9.
- **Commit** `feat(launcher): persona-refresh exports the reviewed drift file (HC-36b)`. **On-cap** commit bash and tests; record the pwsh gap.

## HW5: measurement, cohorts, close

### HC-37a: Ledger exporter (library and binary)

- **Branch** `scriptorium/hc-37a-ledger-export`, worktree `.claude/worktrees/hc-37a`. **Depends on** HC-19, HC-03 (A1). **Size** about 36k.
- **May edit** `packages/supervisor/src/export.ts`, `export-cli.ts`, `export.test.ts` (new), `packages/supervisor/package.json` (add `bin` `geldar-ledger-export`), `image/Dockerfile` (one wrapper line). **Must not edit** `supervisor.ts`, `state.ts`.
- **Behaviour** (AN-33's kit half: bounded, versioned files for the world's `tools/progress-metrics`, which reads files and never the database).
  ```ts
  export const EXPORT_VERSION = 1;
  export const MAX_ROWS = 100_000; export const MAX_BYTES = 32 * 1024 * 1024;
  export interface ExportFile { name: string; rows: number; bytes: number; sha256: string; truncated: boolean; skipped_bad: number }
  export function exportLedgers(stateDir: string, outDir: string, player: string, nowIso: string): { files: ExportFile[] };
  ```
  Reads **only** these four names in `stateDir` and nothing else (never `session-*.jsonl`, `prompt.txt`, the sheet, `social/`, `seed/`, `drift/`: those are private): `instinct.jsonl`, `costs.csv`, `tokens.csv` (A1), `supervisor.log`. Writes to `outDir` (files 0600): `instinct-v1.jsonl` (each line parsed; lines that are not a JSON object with `v` are dropped and counted in `skipped_bad`; the newest `MAX_ROWS` or `MAX_BYTES` kept, `truncated` set), `costs-v1.csv` and `tokens-v1.csv` (header line, then rows in order, same bounds), `counters-v1.json` (counts from `supervisor.log` by a fixed pattern table: `result=ok`, `result=failed`, `save failed`, `tidy run=`, `limited:`, `cap reached`, `stopped:`, `held by the keeper`, `STOP removed`; plus the first and last timestamp), and `manifest.json` `{ format: 'geldar-ledger-export', version: 1, player, exported_utc, files: [...] }` written last. A missing input file is recorded with `rows: 0` and is not an error. The export is read-only on `stateDir`. CLI: `geldar-ledger-export --state DIR --out DIR --player ID` and `--tar` to write the finished folder as a tar stream on stdout (the launcher uses it, HC-37b).
- **Tests.** `bounds keep the newest rows and set truncated` (fails if the cut keeps the oldest). `a bad line is dropped and counted`. `only the four named files are read`: a stateDir with `session-1.jsonl`, `prompt.txt` and `sheet.json` sentinels; no sentinel appears in the output (B3). `the manifest checksums match the files`. `counters from a log fixture`. `a missing tokens.csv is rows 0`. `the state folder is not modified` (mtime and hash).
- **Checks** CK-1, CK-2, CK-3, CK-4. **Both launchers** n/a. **Blindness** B3, B9.
- **Commit** `feat(supervisor): bounded versioned export of the volume ledgers (HC-37a)`. **On-cap** commit `exportLedgers` and its tests; the CLI and Dockerfile line last.

### HC-37b: `export-ledgers` verb (both launchers)

- **Branch** `scriptorium/hc-37b-export-verb`, worktree `.claude/worktrees/hc-37b`. **Depends on** HC-37a. **Size** about 38k.
- **May edit** `launcher/lib/ledger.sh`, `ledger.ps1` (new), `launcher/geldar-play`, `geldar-play.ps1`, `launcher/messages.d/65-ledger.tsv` (new), `00-core.tsv`, `launcher/README.md`, `docs/troubleshooting.md`, `launcher/test/ledger.test.ts` (new), `launcher/test/player-support.ts` and `fake-docker.sh` (to confirm; only to map the exporter role). **Must not edit** `player.*` libs.
- **Behaviour.** `geldar-play export-ledgers <id> [--out <dir>]` (default `<state>/<id>/ledger-export/<utc stamp>/`, a private dir, same name in both twins). A helper reads the supervisor volume as uid 1001 read-only with `--network none` and runs `geldar-ledger-export --state /vol --out /tmp/out --player <id> --tar`; the tar stream goes to a temp file on the host. Before extraction the host lists it with `tar -tf` and accepts only the exact names `manifest.json`, `instinct-v1.jsonl`, `costs-v1.csv`, `tokens-v1.csv`, `counters-v1.json` (no `/`, no `..`, regular files); anything else is `ledger_export_bad` and nothing is extracted. Then it extracts into the output folder with `--no-same-owner` and prints each file name and row count (from the manifest) and `ledger_exported`. It never writes to any volume, never prints ledger content. The verb needs `tar` on the host (add it to `verb_needs` and `Get-VerbNeeds`).
- **Tests.** `a good export lands five files and prints counts`. `a tar entry named ../x or an absolute path is refused and nothing is extracted` (fails if the listing check is removed). `the volume mount is read-only and the network is none` (fake docker records the args). `the output folder is private`. `no ledger text appears on stdout or stderr`. Both launchers.
- **Checks** CK-1, CK-2, CK-3, CK-4. **Both launchers** BL 1 to 5 with verb `export-ledgers`. **Blindness** B3, B9.
- **Commit** `feat(launcher): export-ledgers copies bounded ledgers for the metrics tool (HC-37b)`. **On-cap** commit bash and tests; record the pwsh gap.

### HC-38: Cohort arms by harness

- **Branch** `scriptorium/hc-38-cohort-arms`, worktree `.claude/worktrees/hc-38`. **Depends on** HC-16 (A5), HC-26 (B-7), HC-08 (A4), HC-37b (the export names the arm files). **Size** about 40k.
- **May edit** `launcher/lib/cohort.sh`, `cohort.ps1` (new), `launcher/geldar-play`, `geldar-play.ps1`, `launcher/messages.d/66-cohort.tsv` (new), `00-core.tsv`, `launcher/README.md`, `docs/troubleshooting.md`, `launcher/test/cohort.test.ts` (new), `launcher/test/cohort-fixture/` (new: `cohort.conf` and two characters). **Must not edit** `new.*` (the verb calls `verb_new` as a function), `player.*`.
- **Behaviour** (v3 plan H7: same character files, same world settings, different harness; the campaign never starts a player, D-HC-11). Verb `geldar-play cohort-new <manifest>`; the manifest is a data file of `key=value` lines read as data, never sourced (as `world.conf` is): `name`, `shard`, `mock` (optional), `persona_dir`, `characters` (comma list), `arms` (comma list of `claude`, `chatgpt`, `local`; at least two). For each character and arm it creates the player id `<name>-<character>-<arm>` (the whole id passes `valid_player_id`, at most 38 characters, else `cohort_id_long`) by calling the existing `new` path with `--cli <arm>` (A4), the **same** `--shard` and `--mock`, and a per-arm persona directory it copies byte for byte from `<persona_dir>/<character>/memory/{identity,goals}.md` (copies, never links: `persona_load` refuses hard links); the character's sheet file (`<persona_dir>/<character>/sheet.json`, optional) is delivered with HC-26's function (B-7) unchanged for every arm. It then verifies that every arm's persona files have equal SHA-256 for the same character and that the `player.json` files differ only in `player_id`, `mcp_url` and `harness`, and writes `<state>/cohort/<name>.tsv` (id, character, arm; no model: the declared model stays the owner's per-arm step, printed in the next-steps line). A failed member stops the verb and names the ids made so far; nothing is deleted automatically. No arm label is put in any file the character reads (B4).
- **Tests** (both launchers, fake gh and docker). `three arms by two characters make six players` and the id rule. `persona files are byte-identical across arms` (fails if one arm is given a modified copy). `shard and world address are identical across arms; only harness differs in player.json` (fails if a flag is dropped for one arm). `the sheet reaches every arm once and never a repository file`. `a member failing stops and lists the ones made`. `an arm other than the three is refused before anything is made`. `the manifest is never sourced` (a manifest value with `$(touch X)` leaves no file X). `no arm label in any repository file or any prompt` (B4).
- **Checks** CK-1, CK-2, CK-3, CK-4. **Both launchers** BL 1 to 5 with verb `cohort-new`. **Blindness** B3, B4.
- **Commit** `feat(launcher): cohort-new makes one player per character and harness arm (HC-38)`. **On-cap** commit bash and tests; record the pwsh gap.

### HC-39: Campaign close: docs sweep, retro, process

- **Branch** `scriptorium/hc-39-close`, worktree `.claude/worktrees/hc-39`. **Depends on** every other card merged and the campaign review done. **Size** about 25k (docs only; a fresh agent, then a fresh reviewer).
- **May edit** `docs/architecture.md`, `docs/clients.md`, `docs/chatgpt.md`, `docs/local-models.md` (HC-15), `docs/onboarding.md`, `docs/release.md`, `docs/threat-model.md`, `docs/launcher-hardening.md` (tests named per item), `docs/decisions.md` (index rows, only for decisions recorded in HC-00), `packages/*/README.md` for packages that gained a public surface (`instinct`, `seed`, `psyche`, `mind-loop`), `docs/analysis/harness/README.md`, `docs/analysis/harness/RESUME.md` (new or rewrite, at most 40 lines), `docs/analysis/harness/worknotes/retro-harness.md` (new). **Must not edit** code, tests, `template/**`.
- **Behaviour.** (1) List what each wave merged (read the ledger and `git log`) and update every doc that describes it; a behaviour change with no doc is named in the PR. (2) Check the claims of `docs/threat-model.md` against the merged code: the supervisor volume holds the sheet, the social store, the ledgers and the seed folder; the player user reads none of it; the three launcher helpers that read it are read-only with `--network none` except the one seed request write. (3) Retro, one page, from facts: passes per card, coders that hit the cap, merge conflicts on the R9 shared files, what reviews caught, what to slice differently. (4) Process changes shipped in the same PR, each naming its finding, preferring a guard (a test or repo check) over a rule. (5) Close the ledger: every HC row `Done`, `Deferred` (HC-33 and any unmet W-n assumption) or `Retired`, and the Open items of this file carried into the retro.
- **Tests.** CK-M clean; the reviewer checks each doc claim against the merged file it cites.
- **Checks** CK-M, CK-4. **Both launchers** n/a (docs only; the launcher docs list both). **Commit** `docs(harness): campaign close, docs sweep and retro (HC-39)`. **On-cap** docs sweep first, retro second, RESUME last.

## Open items

1. **Cross-check against kit B.** The names in `Assumed from kit B` are the riskiest part of this file: above all B-1 (`successProbability`), B-2 (policies as exposed-chance `Branch` trees: if GX-02 releases them differently, HC-28a's `branch.ts` adapts and its tests change) and B-3 (the step, context and `instinct.jsonl` line shape, the facts channel). If kit B has no `workspace` path in `InstinctContext`, HC-30a's people-file check needs one (read-only).
2. **World contract names (W-1 to W-4)** are guesses from the brief's field list; HC-27b keeps them in one table, HC-34a in one file. No card is `Ready` until the AN cards publish them.
3. **Ledger corrections** (README): split HC-27, HC-28, HC-30, HC-34, HC-35, HC-36, HC-37 as the table above; `new` takes the child id first and `--lineage-record <file>`; HC-35 adds a `seed` verb to the verb lists; HC-31 also depends on AN-44; HC-32 needs no template edit (stated in the card) and depends on HC-29 only; HC-36 also depends on AN-58 to AN-60; HC-38 also depends on HC-26 and HC-08; HC-30 also depends on HC-24 and HC-19.
4. **Persona refresh has no automatic apply path.** Identity is write-once and denied to the player, and the keeper's upstream gate refuses any change under `memory/` (`touches_memory`), so an owner edit on GitHub cannot reach a running player. HC-36b exports and documents a manual apply; a `persona-apply` verb needs its own card and an owner ruling.
5. **HC-35b on non-Claude harnesses** depends on kit A's loop running with no tools; if it cannot, only the Claude harness synthesizes and the rest answer `unsupported`.
6. **Unmeasured parameters:** prior strength 2, observation values, `SAMPLE_TICKS`, `MOVE_BLOCKS`, the 0.75 display threshold, `DAY_TICKS`, the seed fact counts and caps, `MAX_ROWS`. All are constants in one file each so an owner ruling or a measurement changes one line.
7. **Template.** No card here edits `template/`. A one-sentence addition to reflect step 2 is possible but changes the control arm; it needs its own decision and a card that also updates `tests/template` expectations.
8. **supervisor.ts and the launcher entry scripts are shared hot files** (R9). Merge HC-35b, HC-36a, HC-37a (supervisor) and HC-35c, HC-36b, HC-37b, HC-38 (launcher) serially and run the full check on the wave branch after each.
9. **Windows test skips.** Launcher tests that pass a double quote through the `.cmd` shims skip on pwsh; CI on Linux must show them running before a launcher card is called done.
10. **HC-33** stays blocked until the owner picks A, B or C; no coder is dispatched for it.
