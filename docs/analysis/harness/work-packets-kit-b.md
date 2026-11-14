# Harness campaign work packets: kit B (HW2 the instinct step, HW3 temperament and persona)

Part of the harness campaign. Ledger and decisions D-HC-01 to D-HC-11: [README.md](README.md). Retarget table: [retarget-map.md](retarget-map.md). Kit A (HC-00 to HC-16: `packages/mind-loop`, `harness: "local"`, the token meter, the stamps) is written by another author; this file refers to it by id only. Kit C (HC-27 and up) builds on the `packages/instinct` skeleton defined here.

Written 2026-11-14 against `geldar-scriptorium` at `ea1e0ed` (the harness-campaign worktree), reading `packages/supervisor/src/*`, `packages/chatgpt/src/tools.ts`, `packages/keeper`, `launcher/lib/*`, `launcher/messages.d`, `image/` and `tests/`. The sources are the v3 kit plan (section 4), the character-sheet brief (sections 3, 4, 5, 9, Appendix A), the original packets AN-13 to AN-23 and the D-CS answers (the recommended ones, assumed). Nothing here is dispatched. Every `(to confirm)` is something this author could not verify: a card that still has one of those in a file path or an API name is not `Ready` until the orchestrator resolves it (see Open items at the end).

## Honest limits

- The roll engine `psyche/` does not exist yet (geldar AN-03, released for mirroring by GX-02). HC-17a and everything that imports the engine is written against the API sketch in brief section 4.3 and marked `(to confirm against AN-03)`.
- The world's MCP tool output shapes (`status`, `wait`) and the argument shape of `act` were not read. The cards define one normalised `Observation` type and put every guess inside one adapter file (`observe.ts`, HC-18) so a wrong guess is a one-file fix. Fixtures in the fake world (HC-24) fix the shape for tests only.
- Whether the world lets a second MCP connection read events without consuming them (the model's own `wait` cursor must not be disturbed) is the largest unknown (v3 plan section 9). See Open items 1.
- Every number (DCs 8, 11, 14, caps 4, picks 3, probability 0.25, radii) is the brief's first guess, unmeasured.

## Dispatch rules

The repo's dispatch rules 1 to 24 (`docs/analysis/scriptorium/work-packets.md`) apply to every card. The ones a coder most often breaks:

1. Work only in your worktree; PowerShell 7; run pnpm as `./scriptorium.ps1 pnpm <args>`; in a new worktree run `./scriptorium.ps1 setup` first.
2. Edit only the files the card lists under `May edit`. Shared files have one owner (rule 13): `pnpm-lock.yaml`, `image/Dockerfile` and `launcher/test/parity.ts` are re-applied by the orchestrator at merge; make your one-line change and say so in the report.
3. TypeScript: ESM, `.ts` import specifiers, no enums, namespaces or parameter properties. Each package `tsconfig.json` is `{"extends": "../../tsconfig.base.json", "include": ["src"]}`. Dependencies are exact pins (`@modelcontextprotocol/sdk` 1.32.2 and `zod` 4.6.7, as `packages/memory` uses). Files under 700 lines (soft 500), no `utils.ts`/`helpers.ts`, LF endings.
4. Every behaviour has a test that fails when the behaviour is reverted. Revert locally, run, restore, and say so in the report (rule 9). Tests that depend on wall clocks or process kills run only when `CI` is set (rule 19).
5. Coders run the card's checks plus `./scriptorium.ps1 pnpm lint` and `./scriptorium.ps1 pnpm typecheck`. The full `./scriptorium.ps1 check` runs at wave end on the integration branch (rule 21). Never run two full checks at once.
6. Commit once with the card's commit subject and the attribution lines the orchestrator supplies. Never push. Write a stub report first and update it (rule 12).
7. The character is blind to the sheet. No score, label, roll, DC or sheet field name may reach a string the model reads (prompt facts, tool results, journal lines, persona text). Player-facing strings are plain ASCII, pass `markedWords` and `forbiddenMention` from `tests/template/tool-skill-scan.ts`, and contain no digits except counts the world itself told the agent.
8. No game knowledge or terrain coaching: a function may use only what the observation, the agent's own memory files or the agent's own record says.
9. Do not weaken the container model: no new capability, mount, port, network or secret in `image/compose/player.yml` beyond what a card names.

Waves: integration branch `scriptorium/hw2` (HC-17a to HC-24) and `scriptorium/hw3` (HC-25 to HC-26c), from `main`. Packet branch `scriptorium/hc-NN-<slug>`, worktree `.claude/worktrees/hc-NN`, branched from the wave branch. Reports go to `.claude/reports/harness/<packet>-<role>.md`.

## Fan-out plan

Gate (small, front-loaded): HC-17a (mirror) and HC-17b (kit-owned sheet and check helpers) in parallel; then HC-18 (skeleton, contract types, world link, result protocol), which every other card needs. Parallel after HC-18: HC-19 (supervisor), HC-20 (failure), HC-21a then HC-21b (idle), HC-22 (novelty), HC-23a (veto in `mind-loop`, needs kit A HC-10, HC-11 merged). Join: HC-23b (supervisor fd 4 after HC-19 and HC-26c), HC-24 (integration). HW3: HC-25 (persona, needs HC-17b), HC-26a (host side), HC-26b (volume delivery, after 26a), HC-26c (supervisor side and the blindness proof, after 26b and HC-19). Siblings share no files except those named in rule 2.

Splits made here (the README ledger lists one row each): HC-17 into 17a and 17b; HC-21 into 21a and 21b; HC-23 into 23a and 23b; HC-26 into 26a, 26b and 26c. Added dependencies the ledger lacks: HC-23b needs HC-19 and HC-26c; HC-25 needs only HC-17b; HC-24 needs HC-17a to HC-23b.

## SHARED CONTRACT

Every card builds against these names. A card that needs a different name stops and reports.

### Packages and binaries

| Package | Name | Owner card | Binary |
|---|---|---|---|
| `packages/psyche` | `@geldar/scriptorium-psyche` | HC-17a (mirror under `engine/`), HC-17b (kit-owned `src/`) | none |
| `packages/instinct` | `@geldar/scriptorium-instinct` (exports `.` and `./contract`; `./contract` is pure: no imports but `node:crypto`) | HC-18 | `geldar-instinct` |
| `packages/persona-sheet` | `@geldar/scriptorium-persona-sheet` | HC-25 | `geldar-persona-sheet` |
| `packages/mind-loop` | kit A | HC-05; HC-23a adds `src/sanity.ts` only | none |

`geldar-instinct` is installed in the image like `geldar-chatgpt`: `printf '#!/bin/sh\nexec node --use-env-proxy /opt/geldar/packages/instinct/src/cli.ts "$@"\n'` (`--use-env-proxy` because the world is reached through `proxy-player`). Verbs: `run --run <n>` (one JSON line on stdout), `check-sheet <path>` (exit 0 valid, 2 invalid, prints nothing).

### Environment names

Supervisor settings (read in `packages/supervisor/src/settings.ts`, passed to the `player` service by name only in `image/compose/player.yml`; an invalid value is a `SettingError` that names the variable):

| Variable | Values | Default |
|---|---|---|
| `GELDAR_INSTINCT` | `off` or `on` | `off` (D-HC-09) |
| `GELDAR_INSTINCT_ARM` | `^[a-z][a-z0-9-]{0,30}$`, the declared arm | `instinct` |
| `GELDAR_INSTINCT_FAILURE_CAP` | integer 1 to 20 | 4 |
| `GELDAR_INSTINCT_MAX_PICKS` | integer 1 to 20 | 3 |
| `GELDAR_INSTINCT_THINK_P` | decimal 0 to 1 (`^(0\|1\|0\.[0-9]{1,3})$`) | `0.25` |
| `GELDAR_INSTINCT_ROLLS` | `on` or `off` (d20 checks; D-CS-05) | `on` |
| `GELDAR_INSTINCT_SANITY` | `on` or `off` (the HC-23 veto) | `on` |
| `GELDAR_INSTINCT_TIMEOUT` | seconds, 1 to 600 | 60 |

Environment of the `geldar-instinct` child (built by `instinctEnv()` in HC-19, nothing else is inherited): `PATH`, `HOME=/tmp`, `NODE_USE_ENV_PROXY=1`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `http_proxy`, `https_proxy`, `no_proxy`, `GELDAR_MCP_URL`, `GELDAR_MCP_TOKEN`, `GELDAR_WORKSPACE`, `GELDAR_INSTINCT_STATE` (the directory below), `GELDAR_HARNESS`, `GELDAR_RUN_MODEL` (only when set) and the `GELDAR_INSTINCT_*` names above. The model child's `childEnv` never gets any `GELDAR_INSTINCT*` name or any sheet value (HC-26c proves it).

### Files in the supervisor volume (`geldar-sup-<id>`, mounted at `/state/supervisor` in `player`, owner `supervisor` uid 1001, directory mode 2750 group keeper)

| Path | Mode | Written by | Content |
|---|---|---|---|
| `instinct.jsonl` | 0600 | `geldar-instinct` and the supervisor | the audit, one line per instinct run (shape below) |
| `instinct/` | 0700 | launcher helper (HC-26b), supervisor | directory, owner 1001; the keeper (uid 1002, group read on the parent) cannot enter it |
| `instinct/sheet.json` | 0600 | launcher helper (HC-26b) | the sheet copy (brief 3.2), written only by the launcher |
| `instinct/state.json` | 0600 | `geldar-instinct` | the kit-local store (shape below) |
| `instinct/last.json` | 0600 | supervisor (child stdout) | the last result line, replaced each run |
| `instinct/sanity.json` | 0600 | supervisor (HC-23b) | the derived veto parameters for fd 4 |

The sheet never goes in the workspace volume (`geldar-ws-<id>`), never in an environment variable, never in a command line (D-HC-03).

### The result protocol (`packages/instinct/src/contract.ts`)

```ts
export const INSTINCT_V = 1;
export type FxName = 'failure' | 'novelty' | 'idle' | 'guard' | 'none';
export type PassReason =
  | 'off' | 'no_sheet' | 'sheet_invalid' | 'no_world' | 'send_failed' | 'dead'
  | 'speech_addressed' | 'first_sighting' | 'failure_past_cap'   // forced escalations
  | 'insight' | 'no_variation' | 'no_adopted_goal' | 'no_candidate' | 'think_draw' | 'max_picks'
  | 'nothing_to_do' | 'error';
export const FORCED: readonly PassReason[] = ['speech_addressed', 'first_sighting', 'failure_past_cap'];
export interface RollRecord {
  id: string;                    // `${lifeKey}:${tick}:${fx}:${n}`
  fx: string; score: number; dc: number;
  mode: 'dis' | 'flat' | 'adv' | 'off';   // 'off' = no d20 (rolls off, or a weighted or think draw)
  dice: number[]; kept: number | null; bonus: number; total: number | null; success: boolean;
}
export interface ActRecord { tool: 'act'; arguments: Record<string, unknown> }   // argument shape (to confirm)
export type InstinctResult =
  | { v: 1; kind: 'settle'; fx: FxName; why: string; act: ActRecord; rolls: RollRecord[]; world: { accepted: true; line: string } }
  | { v: 1; kind: 'pass-with-facts'; fx: FxName; facts: string[]; rolls: RollRecord[] }
  | { v: 1; kind: 'pass'; reason: PassReason; forced: boolean; rolls: RollRecord[] };
export function parseInstinctResult(text: string): InstinctResult | null;  // strict; null on anything else; text <= 65536 bytes
export function sanitizeFact(text: string, max: number): string;           // printable ASCII only, quotes to ', at most `max` chars
```

`geldar-instinct run` prints exactly one such line and exits 0, or exits 1 with nothing on stdout. A `settle` is printed only after the world accepted the act; a refused or failed send becomes `pass` with reason `send_failed`. `why` and every fact are fixed text from the instinct package, never model text and never a score.

### An `instinct.jsonl` line

```json
{"v":1,"ts":"2026-11-14T10:00:00Z","waking":12,"run":7,"arm":"instinct","source":"instinct","harness":"claude","model":"haiku","kind":"settle","fx":"idle","reason":null,"forced":false,"why":"habit for the top goal","act":{"tool":"act","arguments":{}},"world":{"accepted":true,"line":"Your intent was accepted."},"facts":[],"rolls":[],"model_called":false}
```

`kind` is `settle`, `pass-with-facts`, `pass` or `error`. `source` is the literal `"instinct"` on every line (D-HC-04, ruling 8). `waking` is the instinct counter in `state.json` (one per `run`); `run` is the supervisor's next run number. `model_called` is `false` only for `settle`. An `error` line (written by the supervisor when the child fails) has `reason` one of `exit`, `timeout`, `bad_output` and no `act`. `harness` and `model` follow the HC-04 stamp (to confirm against HC-04). The fields never include the sheet or any score; a roll record holds the die values and the target, which are audit data the character never receives.

### `state.json`

```ts
export interface InstinctState {
  v: 1; waking: number; picks_in_a_row: number;
  attempts: Record<string, number>;                 // problem key (HC-20) -> failures
  tried: Record<string, string[]>;                  // problem key -> hashes of argument sets already resubmitted (max 8)
  seen: string[];                                   // sighting keys already met (max 500, oldest dropped)
  last_intent: { goal: string; program: string; arguments: Record<string, unknown> } | null;
  habits: Record<string, { program: string; arguments: Record<string, unknown>; n: number }[]>;  // HC-21b; goal text -> max 5
  pending_acts: string[];                            // own-act lines not yet shown to the model (max 3)
  cursor: string | null;                             // the instinct step's own event cursor (to confirm)
}
```

Read tolerant (missing file means the empty state), written atomically (`state.json.new`, mode 0600, rename). A corrupt file is renamed `state.json.bad` once and an empty state is used.

### Normalised observation (`packages/instinct/src/observe.ts`, the only file that knows the world's output shape)

```ts
export type EventKind = 'speech_to_me' | 'speech' | 'intent_finished' | 'intent_failed' | 'action_failed' | 'hurt' | 'other';
export interface EventLine { kind: EventKind; text: string; from?: string }
export interface Observation {
  tick: number | null; dead: boolean; night: boolean | null; position: { x: number; y: number; z: number } | null;
  health: number | null; hunger: number | null; inventory: Record<string, number>; foodCarried: boolean | null; inventoryFull: boolean | null;
  agents: { name: string; distance: number | null }[]; entities: { kind: string; hostile: boolean; distance: number | null }[];
  notable: { kind: string; distance: number | null }[];
  intent: { goal: string; program: string; arguments: Record<string, unknown> } | null;
  events: EventLine[]; cursor: string | null;
}
```

Event kinds come from the world's own plain lines named in the play skills: `Your intent finished.`, `Your intent ran out of time.`, `Your intent failed: <reason>`, `Your <verb> failed: <reason>.`, speech in `untrusted_world_text` (a line addressed to the agent is `speech_to_me`; the exact marker is `(to confirm)`). Event text is untrusted: it is only classified and truncated (200 characters), never executed or copied into a fact.

### Rolls and seeds

`lifeKey` is the last path segment of `GELDAR_MCP_URL` (`/p/<player_id>`). `tick` is `obs.tick ?? state.waking`. `n` counts the rolls of one run from 0. The engine call is `rngFor(lifeKey, tick, fx, n)` and `roll(fx, score, dc, rng, proficiency)` (to confirm against AN-03). The kit helper `check()` (HC-17b) is the only caller of `roll`. With `GELDAR_INSTINCT_ROLLS=off` a check is deterministic: success when the exact probability of meeting the DC is at least 0.5 (D-CS-05); weighted picks and think draws stay seeded and recorded with `mode: 'off'`.

### Prompt facts (the only channel from the instinct step to the model)

A closed set of templates in `packages/instinct/src/facts.ts`; each takes only world-derived words. No fact states a number except a count the agent can see in its own events.

| Key | Text |
|---|---|
| `repeat_failure` | `You have tried this {n} times and it has not worked.` (n from the failure counter) |
| `new_sighting` | `You have not seen {name} before.` (name from the observation, `[A-Za-z0-9 _'-]{1,40}`) |
| `own_act` | `You did this a moment ago: {line}` (line: the world's reply, at most 120 printable characters) |

At most 4 facts per waking. The supervisor appends them to the prompt written to descriptor 3 (HC-19).

### Launcher message keys (messages.d)

| Key | File | Card | Kind |
|---|---|---|---|
| `persona_sheet_done`, `persona_sheet_noop` | `62-persona-sheet.tsv` | HC-25 | information (row in "Not a problem") |
| `persona_sheet_bad`, `persona_sheet_applied`, `persona_sheet_failed` | `62-persona-sheet.tsv` | HC-25 | error (own `###` heading, three labelled paragraphs) |
| `sheet_stored` | `63-sheet.tsv` | HC-26a | information |
| `sheet_bad`, `sheet_failed` | `63-sheet.tsv` | HC-26a, HC-26b | error |

New verbs: `persona-sheet` (HC-25) and `sheet-set` (HC-26a), both launchers. New launcher test group `sheet` (HC-25 registers it; HC-26a and HC-26b reuse it).

### Repo-check rules for launcher changes (read from `tools/repo-checks/src/{cli,twin-drift,troubleshooting.test}.ts`)

A launcher card changes `launcher/lib/<name>.sh` and `launcher/lib/<name>.ps1` together. `pnpm check:repo` fails on twin drift: each lib registers its group (`GP_GROUPS="$GP_GROUPS sheet"` and `$GP_GROUPS += 'sheet'`), `launcher/test/parity.ts` lists the group for both launchers, and every `private_mkdir` has a `New-PrivateDir` twin. `tools/repo-checks/src/troubleshooting.test.ts` (run by `pnpm test`) requires every key in `launcher/messages.d/*.tsv` to have exactly one `### key` heading in `docs/troubleshooting.md` with the three paragraphs starting `What it means.`, `Why it is safe.` and `What to do.` (each with a sentence), or one row in the "Not a problem" table. Messages are `key<TAB>text` lines with `%s` slots.

---

## HW2: the instinct step

## HC-17a: mirror the roll engine as `packages/psyche`, pinned by a tree hash

- **Branch** `scriptorium/hc-17a-psyche-mirror`, worktree `.claude/worktrees/hc-17a`. **Depends on** AN-03 and GX-02 (geldar), D-HC-02. If the engine is not released yet, write the script, the test and a placeholder-free skeleton, mark the card `BlockedDependency`, and stop: never write an engine yourself.
- **May edit** `packages/psyche/package.json` (new), `packages/psyche/tsconfig.json` (new), `packages/psyche/scripts/vendor.ts` (new), `packages/psyche/MIRROR.json` (new, written by the script), `packages/psyche/engine/**` (new, written by the script only), `packages/psyche/src/mirror.test.ts` (new), `packages/psyche/src/engine.test.ts` (new), `packages/psyche/README.md` (new, 20 lines), `biome.json` (to confirm: add `"!packages/psyche/engine"` to `files.includes` if the vendored files fail biome), `image/Dockerfile` (the filter list on the `pnpm install` line: add `psyche`).
- **Must not edit** anything under `packages/psyche/engine/` by hand; any file outside the list; the geldar repo.
- **Behaviour.**
  1. `package.json`: name `@geldar/scriptorium-psyche`, `private`, `type: module`, `exports: {".": "./src/index.ts"}` (HC-17b writes `src/index.ts`; until then `exports` points at `./engine/index.ts` (to confirm against AN-03)), script `typecheck`.
  2. `scripts/vendor.ts`: `node packages/psyche/scripts/vendor.ts --source <dir> --commit <40 hex>` where `<dir>` is the released engine source (the geldar `psyche/src` directory, to confirm against GX-02). It (a) refuses a `--commit` that is not 40 lowercase hex characters, a `--source` containing a symlink, a file over 200 KiB, or a path with `..`; (b) deletes `packages/psyche/engine/`, copies every file except `*.test.ts` byte for byte; (c) computes `treeHash(dir)`; (d) writes `MIRROR.json`.
  3. `treeHash(dir)`: sha256 (hex) over the text made of one line per file, files sorted by POSIX path with plain byte order: `<posix path relative to engine/>\0<sha256 hex of the file bytes>\n`. Export it from `scripts/vendor.ts` and use the same function in the test.
  4. `MIRROR.json`: `{"source_repo":"SandboxServers/geldar","source_path":"psyche/src","source_commit":"<40 hex>","tree_sha256":"<hex>","files":["index.ts", ...],"vendored_by":"scripts/vendor.ts"}`. No timestamp (the file must be reproducible).
  5. `src/mirror.test.ts` (the CI pin): recompute `treeHash('packages/psyche/engine')` and compare with `MIRROR.json.tree_sha256`; the `files` list equals the files found; `source_commit` matches `^[0-9a-f]{40}$`; no `*.test.ts`, `node_modules`, symlink or dotfile under `engine/`; the engine imports only relative paths or `node:crypto` (regex over every `import ... from '...'`); the engine source contains none of `node:fs`, `node:net`, `node:http`, `node:child_process`, `fetch(`, `process.env`, `Date.now`, `Math.random` (the list is `(to confirm against AN-03)`).
  6. `src/engine.test.ts` conformance, against the brief 4.3 sketch (names `(to confirm against AN-03)`): `STANDARD_SHEET` has every score 3; `alignmentLabel(3,3)` is `TN`, `(5,5)` is `LG`, `(1,1)` is `CE`; `step(score, 6, -2, 2, 14)` over scores 1 to 5 is 10, 8, 6, 4, 2; `factor(score, 1, 2)` is 0.25, 0.5, 1, 2, 4; the exhaustive probability table of brief 4.1 (score 1 to 5 against DC 8, 11, 14, 17, expected 30,16,6,1 / 42,25,12,4 / 65,50,35,20 / 88,75,58,36 / 94,84,70,51 percent) computed by feeding `roll` a scripted `Rng` whose `next()` yields `(k - 0.5) / 20` for every k in 1 to 20 (all 20 or 400 outcomes) and rounding to a whole percent; `rngFor(a,b,c,d)` twice gives the same first ten values and a different tick gives different ones.
  7. Docs in `README.md`: how to re-vendor (the command), that `engine/` is never edited, that a change means a new geldar release, a new commit and a new hash in the same PR.
- **Tests (named) and revert checks.** `mirror: recorded tree hash equals the engine directory` (fails if one byte of `engine/` changes: change one byte, run, restore); `mirror: files list matches` (fails when a file is added); `mirror: engine is pure` (fails if `fetch(` is added to an engine file); `engine: roll table matches brief 4.1` (fails if the engine changes its dice rule); `engine: step floors 10 8 6 4 2`; `vendor: refuses a bad commit text and a symlink` (a unit test of the script's argument checks using a temp directory).
- **Checks.** `./scriptorium.ps1 setup`; `./scriptorium.ps1 pnpm --filter @geldar/scriptorium-psyche typecheck`; `./scriptorium.ps1 pnpm exec vitest run packages/psyche`; `./scriptorium.ps1 pnpm lint`; `./scriptorium.ps1 pnpm typecheck`; `./scriptorium.ps1 pnpm check:repo`.
- **Size** 35k. **Commit subject** `feat(psyche): mirror the roll engine pinned by a recorded tree hash (HC-17a)`.
- **On-cap** commit passing work, list what is left, never invent engine code.

## HC-17b: kit-owned sheet parser and the `check()` helper in `packages/psyche`

- **Branch** `scriptorium/hc-17b-psyche-kit`, worktree `.claude/worktrees/hc-17b`. **Depends on** HC-17a merged (a stub `engine/index.ts` exporting the sketch names is acceptable only for local typechecking and must not be committed).
- **May edit** `packages/psyche/src/index.ts` (new), `packages/psyche/src/sheet.ts` (new), `packages/psyche/src/check.ts` (new), `packages/psyche/src/sheet.test.ts` (new), `packages/psyche/src/check.test.ts` (new), `packages/psyche/package.json` (the `exports` line only). **Must not edit** `engine/**`, `MIRROR.json`.
- **Behaviour.**
  1. `src/index.ts`: `export * from '../engine/index.ts';` (to confirm the engine's entry) then `export * from './sheet.ts'; export * from './check.ts';`.
  2. `src/sheet.ts`: the kit's own strict reader of the brief 3.2 schema (the world copy is canonical; this reads the kit copy). `export type Sheet = { version: 1; attributes: {curiosity; common_sense; cleverness; aggression}; alignment: {law; good}; op_modes: {explorer; farmer; miner; builder; crafter; warrior; nitwit}; proficiency?: Record<'combat'|'farming'|'mining'|'building'|'crafting'|'exploring'|'social', {level: 0|1|2|3; xp: number}> }` with each score an integer 1 to 5. `export function parseSheet(text: string): Sheet | null` returns `null` for: text over 4096 bytes, JSON that does not parse, any key not in the schema at any level (additionalProperties false), a missing required key, a score that is not an integer 1 to 5, a proficiency level not an integer 0 to 3, `xp` negative. It never throws and never returns a partial sheet.
  3. `src/check.ts`: `export interface CheckOptions { prof: number; rolls: boolean }`; `export function successChance(score: Score, dc: number, prof: number): number` = `p` for flat, `1-(1-p)^2` for advantage, `p^2` for disadvantage, with `p = clamp((21 - (dc - bonus)) / 20, 0, 1)`, `bonus = {1:-2,2:0,3:0,4:0,5:2}[score] + prof`, mode `dis` for scores 1 and 2, `adv` for 4 and 5, `flat` for 3. `export function check(fx: string, score: Score, dc: number, rng: Rng, n: number, lifeKey: string, tick: number, opts: CheckOptions): { success: boolean; roll: RollRecord }`: with `opts.rolls` true it calls the engine `roll(fx, score, dc, rng, opts.prof)` and maps the result into a `RollRecord` (`id` = `${lifeKey}:${tick}:${fx}:${n}`); with it false it returns `success: successChance(...) >= 0.5` and a record with `mode: 'off'`, `dice: []`, `kept: null`, `total: null`. (`RollRecord` is declared in `@geldar/scriptorium-instinct/contract`; to avoid a cycle declare the same interface in `src/check.ts` and have HC-18 re-export it from the contract with a test that the two are assignable.)
- **Tests and revert checks.** `parseSheet: accepts the standard sheet and the Appendix A Adam sheet` ; `parseSheet: rejects unknown keys, score 0, score 6, 3.5, a missing group, a 5 KB text` (revert: loosen additionalProperties and the unknown-key case fails); `successChance matches the brief 4.1 table within one percent for 25 cells and matches the engine's enumeration` (revert: change a bonus and it fails); `check: rolls off is deterministic at the 0.5 line` (score 3, DC 11, prof 0 gives true, DC 14 false; revert: invert the comparison); `check: rolls on records the dice from the engine`.
- **Checks.** typecheck for the package; `./scriptorium.ps1 pnpm exec vitest run packages/psyche`; lint; typecheck; `check:repo`.
- **Size** 30k. **Commit subject** `feat(psyche): sheet reader and deterministic-or-rolled check helper (HC-17b)`. **On-cap** as HC-17a.

## HC-18: `packages/instinct` and `geldar-instinct`: the world link and the result protocol

- **Branch** `scriptorium/hc-18-instinct-core`, worktree `.claude/worktrees/hc-18`. **Depends on** HC-17b. If kit A's `packages/mind-loop` (HC-05) already exports a world connector, import it and do not write `world.ts`'s `connectWorld`; otherwise write it as below and note in the report that HC-05 should absorb it.
- **May edit** `packages/instinct/package.json`, `tsconfig.json`, `src/cli.ts`, `src/index.ts`, `src/contract.ts`, `src/contract.test.ts`, `src/world.ts`, `src/observe.ts`, `src/observe.test.ts`, `src/state.ts`, `src/state.test.ts`, `src/audit.ts`, `src/audit.test.ts`, `src/facts.ts`, `src/facts.test.ts`, `src/decide.ts` (the orchestrator and the guards), `src/decide.test.ts`, `src/run.ts`, `src/fake-world.fixture.ts` (all new; the fixture is test support, never imported by shipped code), `image/Dockerfile` (the `pnpm install` filter: add `instinct`; and the `geldar-instinct` RUN line), `tests/image/cli.test.ts` (to confirm: one assertion that `/usr/local/bin/geldar-instinct` exists). **Must not edit** `packages/chatgpt`, `packages/supervisor`, `packages/psyche`.
- **Behaviour.**
  1. `contract.ts` and `contract.test.ts`: exactly the shared contract above. `parseInstinctResult` is strict (unknown `kind` or key, a `settle` without `world.accepted === true`, more than 4 facts, a fact over 200 characters or containing a non-printable character: all `null`).
  2. `world.ts`: `export async function connectWorld(env: {GELDAR_MCP_URL?: string; GELDAR_MCP_TOKEN?: string}): Promise<{ call(name: string, args: Record<string, unknown>): Promise<string>; close(): Promise<void> }>`. Copy the connection of `packages/chatgpt/src/tools.ts` `connectTools` (read it): `new Client({name:'geldar-instinct', version:'0.1.0'})`, `StreamableHTTPClientTransport(url, {requestInit: {headers: {Authorization: 'Bearer <token>'}, redirect: 'error'}})`, refuse a scheme other than http or https and any username or password in the URL. `call` runs `client.callTool({name, arguments}, undefined, {timeout: 20_000})` and returns the joined text blocks only (images dropped); an `isError` result throws. A connect failure or timeout makes `run` print `pass` with reason `no_world`.
  3. `observe.ts`: `observe(world): Promise<Observation>` calls the tool `status` and then `wait` with `{max_seconds: 1, cursor: state.cursor ?? undefined}` (both `(to confirm)`: the cursor argument and whether a `max_seconds` of 1 returns at once). `parseObservation(statusText: string, waitText: string): Observation` is the one function that knows the shapes; it parses JSON when it can and falls back to classifying plain lines. Every field the world does not give is `null`, `{}` or `[]`. Unit-test it on fixtures in `observe.test.ts`, including the sentences quoted in the contract.
  4. `state.ts`: `loadState(dir)`, `saveState(dir, state)`, `emptyState()`, bounded as in the contract; files 0600, directory 0700 created if missing. `audit.ts`: `appendAudit(path, line)` appends one JSON line (`appendFileSync`, mode 0600), `buildAuditLine(...)` fills the fixed fields of the contract's example.
  5. `facts.ts`: the three templates and `makeFact(key, slots)`; every output goes through `sanitizeFact`.
  6. `decide.ts`: `export type Fx = (ctx: FxContext) => FxResult;` with the `FxContext`/`FxResult` types below, and `decide(ctx, fxs: Fx[]): InstinctResult`. Order: (a) guards, in this order: `obs.dead` gives `pass` `dead`; any event of kind `speech_to_me` gives `pass` `speech_addressed` (forced); any agent in `obs.agents` whose sighting key is not in `state.seen` gives `pass` `first_sighting` (forced, and its key is added to `state.seen` only after the guard has fired once, so the model gets to meet the stranger); (b) run each fx in order; `act` returns a settle candidate and stops; `escalate` returns `pass` with its reason (forced when in `FORCED`); `facts` accumulate (a `facts` result with `stop: true` ends the loop at once with `pass-with-facts`); `pass` continues. (c) if no fx acted: facts present give `pass-with-facts`, else `pass` `nothing_to_do`. The sighting key is `<kind>:<lowercased name>`.
  ```ts
  export interface FxContext {
    obs: Observation; sheet: Sheet; state: InstinctState; cfg: InstinctConfig;
    lifeKey: string; tick: number; goal: string | null; knownText: string;
    check(fx: string, score: Score, dc: number, prof?: number): { success: boolean; roll: RollRecord };
    draw(fx: string): number;                        // seeded uniform [0,1), recorded as a RollRecord with mode 'off'
    rolls: RollRecord[];                             // every check and draw of this run, in order
  }
  export type FxResult =
    | { kind: 'act'; fx: FxName; why: string; act: ActRecord }
    | { kind: 'facts'; fx: FxName; facts: string[]; stop?: boolean }   // stop: end the fx loop with pass-with-facts
    | { kind: 'escalate'; fx: FxName; reason: PassReason }
    | { kind: 'pass' };
  ```
  `InstinctConfig` is `{arm, failureCap, maxPicks, thinkP, rolls}` read from the `GELDAR_INSTINCT_*` names with the contract defaults.
  7. Own acts (ruling 8): when `decide` returns a settle, `run` adds `own_act` text (the world's reply line, truncated) to `state.pending_acts` (max 3, newest first). After any non-settle result `run` turns the result into `pass-with-facts` carrying those lines as `own_act` facts (plus any other facts, max 4) and clears the list. Only a `pass` for a forced reason also carries them (the model must know what its body did).
  8. `run.ts` `runInstinct(env): Promise<InstinctResult>`: read `GELDAR_INSTINCT_STATE`; if `sheet.json` is missing give `pass` `no_sheet`; if `parseSheet` fails give `pass` `sheet_invalid`; connect; observe; build the context; `decide`; for an act call `world.call(act.tool, act.arguments)` and, if it throws or its text is empty, return `pass` `send_failed`; save state; append the audit line; close. Any exception becomes `pass` `error` and an audit line of kind `pass`, reason `error` (no stack, no message). `cli.ts`: `run` prints `JSON.stringify(result)` and a newline; `check-sheet <path>` prints nothing, exit 0 or 2; any other verb exits 2.
  9. The act carries the source tag in the audit line only (`source: "instinct"`). Whether the world's `act` tool also accepts a `source` argument is `(to confirm)` against the geldar tool schema and GX-01; if it does, add `source: 'instinct'` to the arguments in `decide`'s act builder in a follow-up card, never by guessing here.
  10. `fake-world.fixture.ts`: an in-process MCP server over `StreamableHTTPServerTransport` on `127.0.0.1` with port 0, tools `status`, `wait`, `act` taking scripted replies (`script({status, wait, act})`), recording every call; `close()`. Reused by HC-24.
- **Tests and revert checks** (all against the fixture; no model, no docker): `connect failure gives pass no_world and exit 0` (revert: let the exception escape); `settle is printed only after the world accepted the act, a refused act gives pass send_failed` (revert: print settle before the call); `missing sheet gives pass no_sheet, malformed gives sheet_invalid`; `a first-time agent gives pass first_sighting with forced true and a second run does not`; `speech_to_me gives pass speech_addressed forced`; `dead gives pass dead`; `the audit line has source "instinct" on every kind and holds no sheet field name` (scan the text for `curiosity`, `common_sense`, `cleverness`, `aggression`, `law`, `good`, `op_modes`; revert: add the sheet to the line); `own act is carried to the next non-settle result once and then cleared`; `state survives a restart and a corrupt state.json is renamed .bad`; `parseInstinctResult rejects a settle without accepted true`.
- **Checks.** typecheck for the package; `./scriptorium.ps1 pnpm exec vitest run packages/instinct`; lint; typecheck; `check:repo`; `./scriptorium.ps1 pnpm exec vitest run tests/image/cli.test.ts` only if you edited it (Docker; skipped locally if no Docker).
- **Size** over 40k if done in one session. If the report shows over 35k used before step 10, stop and commit steps 1 to 9; the orchestrator splits the fixture (step 10) into `HC-18b`. **Commit subject** `feat(instinct): geldar-instinct world link, observation, result protocol and audit (HC-18)`. **On-cap** as HC-17a.

## HC-19: the supervisor runs `geldar-instinct` before each waking

- **Branch** `scriptorium/hc-19-supervisor-instinct`, worktree `.claude/worktrees/hc-19`. **Depends on** HC-18, HC-04 (stamps), and HC-08 if it has merged (it owns the `harness` union in `settings.ts`; add only the new `instinct` member).
- **May edit** `packages/supervisor/src/settings.ts`, `packages/supervisor/src/deps.ts`, `packages/supervisor/src/prompt.ts`, `packages/supervisor/src/supervisor.ts`, `packages/supervisor/src/fixture.ts` (the fake `execSelf` and an `instinct` behaviour), `packages/supervisor/src/instinct.test.ts` (new), `packages/supervisor/package.json` (add `"@geldar/scriptorium-instinct": "workspace:*"`), `image/compose/player.yml` (environment names only), `tests/image/player-compose.test.ts` (to confirm: the env list), `docs/troubleshooting.md` (none needed: no launcher message). **Must not edit** `packages/instinct`, `launcher/`.
- **Behaviour.**
  1. `settings.ts`: add `instinct: { enabled: boolean; arm: string; failureCap: number; maxPicks: number; thinkP: number; rolls: boolean; sanity: boolean; timeoutSecs: number }` to `Settings` and read it in `readSettings` with the contract names, values and defaults. An invalid value throws `new SettingError('<NAME>')`.
  2. `deps.ts`: add to `Deps` `execSelf(spec: SelfSpec): Promise<number>` with `interface SelfSpec { file: string; args: string[]; env: Record<string, string>; cwd: string; stdoutPath: string; timeoutMs: number }`. `realDeps` spawns it directly (no `setpriv`: it runs as the supervisor user, uid 1001, so it can read `instinct/sheet.json`), `stdio: ['ignore', <fd of stdoutPath opened 0600>, 'ignore']`, SIGKILL on timeout, resolves the exit code (1 when it cannot start or is killed). Do not change `createExec`/`launchCommand`.
  3. `supervisor.ts`: add `export function instinctEnv(settings: Settings, env: Env): Record<string, string>` building exactly the child environment listed in the contract. Add `private async runInstinct(n: number): Promise<InstinctResult>` that: writes nothing if `!settings.instinct.enabled` (the caller does not call it); removes `instinct/last.json`; calls `deps.execSelf({file: 'geldar-instinct', args: ['run', '--run', String(n)], env: instinctEnv(...), cwd: settings.stateDir, stdoutPath: join(stateDir, 'instinct', 'last.json'), timeoutMs: settings.instinct.timeoutSecs * 1000})`; reads `last.json` (at most 65536 bytes) and `parseInstinctResult`; on a non-zero exit, a timeout, a missing or invalid file it appends `{"v":1,"ts":...,"run":n,"arm":...,"source":"instinct","kind":"error","reason":"exit"|"timeout"|"bad_output","model_called":true}` to `instinct.jsonl` and returns `{v:1,kind:'pass',reason:'error',forced:false,rolls:[]}`. It never throws; the whole body is in a `try`.
  4. In `rounds()`, between `n = nextRunNumber(...)` and `this.status(n, 'running', ...)`: compute `const willTidy = this.settings.harness !== 'chatgpt' && this.tidyDue(this.journalSize());` (the existing `tidy` constant then uses `willTidy && this.prepareTidy()`; do not change tidy behaviour). If `settings.instinct.enabled && !willTidy`, call `runInstinct(n)`: `settle` logs `instinct settled run=<n> fx=<fx>`, sets `last = 'settled'`, writes `this.status(n, 'sleeping', last, sum)`, does `await this.deps.sleep(s.delayBase, () => this.shouldStop())` and `continue`s (no model run, no `save()`, no `costs.csv` line, no change to `fails` or `delay`, the run number is not consumed); `pass-with-facts` keeps `facts` for step 5; `pass` changes nothing. A tidy waking never runs the instinct step.
  5. `prompt.ts`: `buildPrompt(n, lastWords, note, facts: readonly string[] = [])`: after the optional note, for each fact append ` ${fact}`; with no facts the output is byte for byte what it is today. `oneRun(n, facts)` passes them (add the parameter; the chatgpt path uses the same prompt file on descriptor 3).
  6. `player.yml`: under the `player` service `environment:` add the name-only entries `- GELDAR_INSTINCT`, `- GELDAR_INSTINCT_ARM`, `- GELDAR_INSTINCT_FAILURE_CAP`, `- GELDAR_INSTINCT_MAX_PICKS`, `- GELDAR_INSTINCT_THINK_P`, `- GELDAR_INSTINCT_ROLLS`, `- GELDAR_INSTINCT_SANITY`, `- GELDAR_INSTINCT_TIMEOUT` (after the `GELDAR_RUN_*` block, no values, like the existing ones). No other line changes; the keeper service gets none. The launcher passes the owner's shell environment through to compose, so no launcher change is needed (confirm by reading `pl_compose` in `launcher/lib/player.sh`: it unsets only the secret names).
  7. `PASS_THROUGH` in `supervisor.ts` is not touched: the child (`childEnv`) gets no instinct variable.
- **Tests (named, in `instinct.test.ts`) and revert checks.** `off by default: the child is never started and no instinct.jsonl is written` (revert: call it unconditionally); `settle: the supervisor starts no model run, skips save and costs, sleeps delayBase and the run number is reused` (revert: fall through to `oneRun`); `pass-with-facts: the prompt file holds the base text, then the facts, on one paragraph` and `no facts: the prompt is byte for byte as before` (revert: always append); `pass: unchanged`; `a crashing child (exit 1), a timeout and garbage output each log an error line, run the model normally and never raise the failure count` (revert: let the error propagate, fails with an exception); `five instinct failures in a row never auto-STOP the supervisor`; `a tidy waking does not run the instinct step`; `instinctEnv has exactly the contract names and no CLAUDE_CODE_OAUTH_TOKEN`; `childEnv has no GELDAR_INSTINCT name even when the supervisor environment sets them all`; `readSettings: defaults, and each bad value names its variable`; `compose: the player service lists the eight names and the keeper none` (in `tests/image/player-compose.test.ts`).
- **Checks.** typecheck for supervisor; `./scriptorium.ps1 pnpm exec vitest run packages/supervisor`; `./scriptorium.ps1 pnpm exec vitest run tests/image/player-compose.test.ts`; lint; typecheck; `check:repo`.
- **Size** 40k. **Commit subject** `feat(supervisor): run the instinct step before each waking and act on its result (HC-19)`. **On-cap** commit what passes (steps 1 to 3 with tests), list what is left.

## HC-20: failure counting, the falling insight DC and the per-agent retry cap

- **Branch** `scriptorium/hc-20-failure-fx`, worktree `.claude/worktrees/hc-20`. **Depends on** HC-18 (the `Fx` type, `FxContext`).
- **May edit** `packages/instinct/src/fx/failure.ts` (new), `packages/instinct/src/fx/failure.test.ts` (new), `packages/instinct/src/fx/variation.ts` (new), `packages/instinct/src/fx/variation.test.ts` (new), `packages/instinct/src/run.ts` (one line: register `failureFx` first in the list; coordinate: the orchestrator merges HC-20, HC-21a and HC-22 registrations by hand), `packages/instinct/src/observe.ts` (only to record `last_intent`, see 1). **Must not edit** `decide.ts`.
- **Behaviour** (brief 5.4 with D-CS-01; the problem identity is the point):
  1. `run.ts` updates `state.last_intent = obs.intent` at the end of every run when `obs.intent !== null` (it is the intent most recently seen running; a failure line next run refers to it).
  2. `problemKey(goal: string, program: string): string` = first 16 hex characters of sha256 of `${goal}\0${program}`. Arguments are never part of the key, so a varied resubmission is the same problem and its count does not reset.
  3. `retryCap(cleverness: Score, base: number): number` = `clamp(base + (cleverness - 3), 2, 6)` (the v3 plan's "retry cap by cleverness"; the slope is a first guess, Open items 6). With base 4: scores 1 to 5 give 2, 3, 4, 5, 6. `cfg.failureCap` is the base.
  4. `failureFx(ctx)`: (a) if any event is `intent_finished`: delete `attempts` and `tried` for the key of `state.last_intent` and return `{kind:'pass'}`. (b) If no event is `intent_failed` or `action_failed`, or `state.last_intent` is null: `pass`. (c) `key = problemKey(...)`; `attempts[key] = (attempts[key] ?? 0) + 1` (once per run however many failure lines). (d) `if (attempts >= retryCap(sheet.attributes.cleverness, cfg.failureCap))` return `{kind:'escalate', fx:'failure', reason:'failure_past_cap'}` (forced). (e) Insight roll: `ctx.check('insight', cleverness, Math.max(8, 14 - attempts), proficiencyOf(program))` where the proficiency level comes from `sheet.proficiency` (travel `exploring`, gather `mining`, craft `crafting`, build `building`, follow `social`; default 0; other programs 0). Success returns `{kind:'facts', fx:'failure', stop:true, facts:[repeat_failure(attempts)]}`: the model is called with the fact and no later fx runs (the "new idea" call; `decide` honours `stop`, see HC-18 step 6; the audit line gets `reason: 'insight'`). (f) Insight failure: `variation(intent, state.tried[key], ctx.obs.inventory)`; a result gives `{kind:'act', fx:'failure', why:'one change to the failed try', act}` with `act = {tool:'act', arguments:{intent: <varied intent>}}` (shape `(to confirm)`) and the argument hash appended to `tried[key]` (max 8); `null` gives `escalate` `no_variation`.
  5. `variation.ts` `variation(intent, tried: string[], inventory): Intent | null`, only changes that need no hidden knowledge: `gather`: if `arguments.count` is a number above 1, `count = floor(count/2)` (min 1). `craft`: if `count` above 1, `count = 1`. `build`: if `arguments.block` is a string and the inventory holds another kind with count above 0, the alphabetically next kind other than the current. `travel`, `follow`, `rest`, `flee` and anything else: `null`. A varied argument set whose hash (sha256 of the stable JSON) is already in `tried` gives `null`. This is where the brief's map-dependent variations are dropped: the kit has no map memory (Open items 7).
- **Tests (in `failure.test.ts`, `variation.test.ts`) and revert checks.** `first failure: attempts 1, insight DC 13` and `DC falls: attempts 2 gives 12, attempts 6 gives 8 (floor)` (revert: remove the floor); `the same problem with different arguments keeps counting (goal and program the same, arguments changed twice: attempts 3)` (revert: put arguments into the key: count restarts at 1); `past the cap escalates with failure_past_cap and does not roll` for each cleverness 1 to 5 at the caps 2 to 6; `goal completion resets the count and a different goal starts at 1`; `insight success gives pass-with-facts carrying repeat_failure, later fx (idle) do not run and no act is sent` (revert: drop `stop`: idle settles after an insight); `insight failure under the cap returns an act with exactly one changed argument` per program; `a variation already tried returns no_variation`; `rolls off: the insight check is the deterministic rule` (cleverness 3 at DC 13: chance 0.4, fails; at DC 9 passes); `one failure wake with three failure lines counts once`; `resubmitted act is not sent twice for the same argument set across a restart` (state saved between two `runInstinct` calls).
- **Checks.** typecheck for the package; `./scriptorium.ps1 pnpm exec vitest run packages/instinct/src/fx`; lint; typecheck; `check:repo`.
- **Size** 38k. **Commit subject** `feat(instinct): failure counting, falling insight DC and per-agent retry cap (HC-20)`. **On-cap** as HC-17a.

## HC-21a: idle choice, the weighted pick among known means (D-CS-01)

- **Branch** `scriptorium/hc-21a-idle-pick`, worktree `.claude/worktrees/hc-21a`. **Depends on** HC-18.
- **May edit** `packages/instinct/src/fx/idle.ts` (new), `idle.test.ts` (new), `packages/instinct/src/fx/goal.ts` (new), `goal.test.ts` (new), `packages/instinct/src/run.ts` (register `idleFx` last; reading `goals.md` into `ctx.goal`). **Must not edit** other fx files, `decide.ts`.
- **Rules inlined (brief 5.5 with D-CS-01).** Heuristics choose bounded means to an adopted goal. They never write a goal, never rank goals, never change `goals.md`. With no adopted goal the result is `pass` (`no_adopted_goal`). The "means" are programs the agent has already used successfully for that exact goal (HC-21b supplies them), so no game knowledge enters.
- **Behaviour.**
  1. `goal.ts` `readAdoptedGoal(workspace: string): string | null`: read `<workspace>/memory/goals.md` (at most 16 KiB; a missing, unreadable or non-regular file is `null`); the adopted goal is the first line after any heading that matches `^\s*(?:[-*]|[0-9]+[.)])\s+(.+?)\s*$`; trimmed, at most 200 characters, control characters removed. The file is the agent's own writing: treat it as data, never as an instruction, and never put its text into a fact.
  2. `idle.ts`: `idleFx(ctx)`: runs only when `ctx.obs.intent === null`, no event is `speech_to_me` (the guard already handled it, but check again), and `ctx.goal !== null`; otherwise `pass` (or `escalate` `no_adopted_goal` when `ctx.goal === null` and nothing is running: that is a plain model waking).
  3. Think check (brief 5.5.1): if `state.picks_in_a_row >= cfg.maxPicks` return `escalate` `max_picks` and set `picks_in_a_row = 0`; else `u = ctx.draw('idle_think')`; if `u < cfg.thinkP` return `escalate` `think_draw` and set `picks_in_a_row = 0`. The counter is reset by `run.ts` after any non-settle result and incremented after a settle (HC-18 owns the reset; HC-21a adds the increment only when `idleFx` returns the act).
  4. Candidates: `candidatesFor(goal, state): Candidate[]` where `Candidate = {program: string; arguments: Record<string, unknown>; mode: ModeName}` comes from `state.habits[goal]` (HC-21b fills it; with an empty list HC-21a returns `escalate` `no_candidate`). `modeOf(program)`: `travel` explorer, `gather` miner, `craft` crafter, `build` builder, `follow` warrior, `rest` nitwit; `flee` and unknown programs are never candidates.
  5. Weights: `weight = 1 * 2 ** (score - 3)` for the candidate's mode from `sheet.op_modes` (0.25, 0.5, 1, 2, 4), then the situational multipliers, each applied only when the observation field is not `null`: night and outdoors: `build` and `rest` times 4, the others times 0.25; hunger at most 6 and `foodCarried === false`: `gather` times 4; `inventoryFull === true`: `gather` times 0. Drop candidates whose weight is 0. All zero or empty: `escalate` `no_candidate`.
  6. Pick: one seeded draw `u = ctx.draw('idle_pick')` in `[0,1)` over the cumulative normalised weights, candidates in a stable order (program name, then argument JSON). Return `{kind:'act', fx:'idle', why:'a means that worked for the top goal', act:{tool:'act', arguments:{intent:{goal, program, arguments}}}}` (shape `(to confirm)`), arguments exactly as recorded (the brief says "fresh arguments"; the kit has no map memory, so it never invents any: Open items 7).
  7. A settle by `idleFx` is allowed only if the guards of `decide` passed (they run first); nothing here bypasses them.
- **Tests and revert checks.** `no adopted goal: pass and never a settle` (revert: pick any candidate: fails); `the goal reader takes the first ranked line, ignores headings and prose, trims, truncates and ignores a 1 MB file`; `weights 0.25 0.5 1 2 4 by op mode score` and `night multipliers, hunger multiplier, full inventory zeroes gather` (table test); `think check: after maxPicks settles in a row the next result escalates max_picks and resets`; `think draw below thinkP escalates think_draw and the draw is recorded in rolls with mode off`; `an option with no recorded arguments is never picked`; `a running intent means pass`; `same state and tick give the same pick (seeded)` and `a different tick may differ`; `the idle fx never writes goals.md` (the temp workspace file hash is unchanged).
- **Checks.** typecheck; `./scriptorium.ps1 pnpm exec vitest run packages/instinct/src/fx/idle.test.ts packages/instinct/src/fx/goal.test.ts`; lint; typecheck; `check:repo`.
- **Size** 36k. **Commit subject** `feat(instinct): idle choice: weighted pick among known means to the adopted goal (HC-21a)`. **On-cap** as HC-17a.

## HC-21b: habits, the means that worked for a goal

- **Branch** `scriptorium/hc-21b-habits`, worktree `.claude/worktrees/hc-21b`. **Depends on** HC-21a, HC-20 (`last_intent` is recorded there).
- **May edit** `packages/instinct/src/fx/habits.ts` (new), `habits.test.ts` (new), `packages/instinct/src/run.ts` (call `learnHabits` once per run, before `decide`). **Must not edit** `idle.ts` except its import of `candidatesFor` if HC-21a left it as a stub in `habits.ts`.
- **Behaviour.** `learnHabits(state, obs, goal)`: when an event is `intent_finished` (the plain line `Your intent finished.`) and `state.last_intent` is non-null and `state.last_intent.goal` equals the exact adopted `goal` string (no fuzzy match: a reworded goal misses, which is safe and weak, as the brief says), upsert `{program, arguments, n}` into `state.habits[goal]` (same program and same stable argument JSON: `n += 1`; otherwise append; keep at most 5 per goal, drop the lowest `n`; keep at most 50 goals, drop the least recently used). `ran: an intent the instinct step itself submitted` also counts (it is the agent's own act). Programs `flee` and unknown programs are never stored. `candidatesFor` (the HC-21a function) now reads `state.habits[goal]`.
- **Tests and revert checks.** `a finished intent for the adopted goal is remembered once and counted on repeat`; `a reworded goal is not matched` (revert: lowercase and trim loosely: fails); `flee is never stored`; `bounds: 5 per goal, 50 goals`; `habits survive a restart (state saved and reloaded)`; `an intent that ended in failure is not remembered`; `end to end with HC-21a: a remembered program for the goal is picked and settles` (this is the test that fails if the habit source is reverted to empty).
- **Checks.** as HC-21a with the habits test file. **Size** 25k. **Commit subject** `feat(instinct): habits: remember the means that finished the adopted goal (HC-21b)`. **On-cap** as HC-17a.

## HC-22: novelty from authorized knowledge

- **Branch** `scriptorium/hc-22-novelty`, worktree `.claude/worktrees/hc-22`. **Depends on** HC-18.
- **May edit** `packages/instinct/src/fx/novelty.ts` (new), `novelty.test.ts` (new), `packages/instinct/src/fx/known.ts` (new, the knowledge reader), `known.test.ts` (new), `packages/instinct/src/run.ts` (register `noveltyFx` after `failureFx`; fill `ctx.knownText`).
- **Rules inlined (brief 5.3, decision 0058, v3 plan 4.3).** "New" means new to this life, judged only from the observation, the agent's own memory files and `state.seen`. A function never contains a world fact (no ore depth, recipe or coordinate). Novelty never settles and never moves the agent: it only adds a fact (`new_sighting`) so the model notices. A newly met agent is the guard's job (`first_sighting`, forced escalation), not novelty's.
- **Behaviour.**
  1. `noticeRadius(curiosity: Score): number` = `[4, 8, 16, 24, 32][curiosity - 1]`.
  2. `known.ts` `readKnownText(workspace)`: lowercase concatenation of `memory/beliefs.md`, `memory/summary.md`, `memory/journal/current.md` and the file names under `memory/people/` (each file at most 32 KiB, at most 40 people files; unreadable parts skipped). A sighting is known when its name appears as a whole word in this text or its key is in `state.seen`.
  3. `noveltyFx(ctx)`: sightings = `entities` and `notable` (not agents) with `distance !== null && distance <= R`, each with key `<kind>:<lowercased kind>`; skip known ones. For each new sighting, nearest first, at most 2 per run: mark `state.seen` first (one roll per first sighting; a failed roll does not leave it new: that would buy fresh rolls), then `ctx.check('novelty', curiosity, 11, proficiency('exploring'))`; success adds a `new_sighting` fact with the kind as the name; failure adds nothing. Return `{kind:'facts', ...}` when any fact was made, else `pass`. A sighting with unknown distance is ignored.
  4. It never reads or writes anything outside `state` and the workspace memory files read-only.
- **Tests and revert checks.** `radius table 4 8 16 24 32`; `a thing beyond the radius is ignored and stays new`; `a name already in beliefs or summary is known and gives nothing`; `a first sighting is marked seen whether the roll succeeds or fails, so it is rolled once` (revert: mark only on success: a second run rolls again, fails); `success gives one new_sighting fact and no act`; `rolls off is deterministic: curiosity 3 DC 11 succeeds`; `an agent is never a novelty sighting`; `a hostile fact text carries only the sanitized kind, never event text` (an entity kind containing a newline or a quote is sanitized); `no file outside memory is read` (the reader is given a workspace with a secrets file next to memory; its content never appears in the result).
- **Checks.** as HC-21a with the novelty files. **Size** 30k. **Commit subject** `feat(instinct): novelty from the agent's own authorized knowledge (HC-22)`. **On-cap** as HC-17a.

## HC-23a: the sanity veto inside `packages/mind-loop` (owned-loop harnesses)

- **Branch** `scriptorium/hc-23a-sanity-veto`, worktree `.claude/worktrees/hc-23a`. **Depends on** HC-10, HC-11 (the call allowance and the corrective retry; kit A) and HC-17b. If either has not merged, the card is `BlockedDependency`.
- **May edit** `packages/mind-loop/src/sanity.ts` (new), `packages/mind-loop/src/sanity.test.ts` (new), `packages/mind-loop/src/loop.ts` (to confirm the file name from HC-05: the single place where a model's tool call is about to be executed), `packages/mind-loop/src/loop.sanity.test.ts` (new), `packages/mind-loop/package.json` (add `"@geldar/scriptorium-psyche": "workspace:*"`). **Must not edit** `packages/chatgpt`, `packages/supervisor`, the Claude harness (D-HC-07: it gets a PreToolUse hook later, behind its own card).
- **Rules inlined (brief 5.8, D-HC-07, D-CS-18).** Round 1 covers owned-loop harnesses only. The veto is a pre-act check on a model-made call. It uses no model call of its own; a veto costs the loop's next model call. The veto and the corrective retry of HC-11 share one allowance: at most two model calls per decision (a decision is one chain from a model response to the call that finally executes), and the same allowance stops a third. With the allowance exhausted the loop falls back as HC-11 defines (ends the waking). A veto is allowed only when one more call remains after the call that triggered it (`used + 1 < max`), and a decision gets at most one veto; a second hit in the same decision is waived and the call runs.
- **Behaviour.**
  ```ts
  export interface SanityParams { v: 1; life: string; common_sense: 1 | 2 | 3 | 4 | 5; rolls: boolean; arm: string }
  export type SanityCheck = 'night_exposure' | 'starving_with_food' | 'fighting_near_death' | 'full_inventory';
  export interface PendingCall { name: string; arguments: Record<string, unknown> }
  export interface SanityView { night: boolean | null; outdoors: boolean | null; health: number | null; hunger: number | null; foodCarried: boolean | null; inventoryFull: boolean | null; shelterCarried: boolean | null }
  export const VETO_TEXT: Record<SanityCheck, string> = {
    night_exposure: 'You think again: it is night and you have no shelter.',
    starving_with_food: 'You think again: you are hungry and you carry food.',
    fighting_near_death: 'You think again: you are badly hurt.',
    full_inventory: 'You think again: your pack is full.',
  };
  export function sanityHits(call: PendingCall, view: SanityView): SanityCheck[];
  export function readSanityParams(fd?: number): SanityParams | null;   // fd 4 by default; null on any error, EBADF included
  export function vetoOrRun(call, view, params, tick, allowance: { used: number; max: number }, vetoedAlready: boolean): { veto: SanityCheck | null; roll: RollRecord[] };
  ```
  1. `sanityHits`, the four checks of brief 5.8 (a `null` field skips that check; a hit needs every condition true): night exposure = `night && outdoors` and the call is a `travel` intent whose target distance is over 64 blocks (the distance argument name is `(to confirm)`; skip when absent) and `shelterCarried === false`; starving with food = `hunger <= 6 && foodCarried === true` and the call is not an `eat` act; fighting near death = `health <= 6` (the standard floor; the per-agent floor needs aggression in this process, which is not delivered: Open items 5) and the call is an `attack`; full inventory = `inventoryFull === true` and the call is a `gather` intent.
  2. `vetoOrRun`: for each hit, `check('sanity', common_sense, 8, 0, opts)` from `@geldar/scriptorium-psyche` (`rolls` from params); the first hit that is caught returns its veto if the allowance rule above allows; the call that is not vetoed runs unchanged ("dim bots make dim mistakes").
  3. In the loop, immediately before executing a model-made world tool call: build `SanityView` from the last `status` or `look` tool result the loop already holds (the adapter is one function `viewFromStatus(text)`; fields it cannot read are `null`; shapes `(to confirm)`); if `params !== null` and `vetoOrRun` returns a veto: do not execute, send the model `VETO_TEXT[...]` as that call's tool result, count it against the allowance, and emit an event item `{type:'sanity', check, roll}` through the loop's existing stdout emit (to confirm the emit name in HC-05) so the roll lands in `session-<n>.jsonl` in the supervisor volume. The roll never goes into any model-visible text.
  4. `params === null` (instinct off, claude harness, or fd 4 absent) gives the loop's behaviour exactly as before this card.
- **Tests and revert checks (the truth table).** valid and no hit: runs; valid, hit, roll missed: runs; valid, hit, caught: vetoed once, the second model call is valid and has no hit: runs; second call has a hit (caught or not): runs (second veto waived); second call invalid: falls back (allowance exhausted); the first call invalid and the corrective retry valid with a hit: runs (no call left for a veto); `params null: no change, the existing loop tests pass unchanged` (revert: apply sanity without params); each of the four checks fires at its boundary (food 6 yes, 7 no; health 6 yes, 7 no; travel 64 no, 65 yes); rolls off: common_sense 3 vetoes, 2 does not (DC 8: chances .65 and .42); `the veto text and every tool result the model receives contain no digit and none of the words roll, dice, score, sheet` (scan); `the model-call count of a vetoed decision is exactly 2` (revert: drop the allowance check and a third call happens).
- **Checks.** typecheck for `mind-loop`; `./scriptorium.ps1 pnpm exec vitest run packages/mind-loop`; lint; typecheck; `check:repo`.
- **Size** 40k. **Commit subject** `feat(mind-loop): sanity veto sharing the two-call allowance (HC-23a)`. **On-cap** as HC-17a.

## HC-23b: deliver the veto parameters to the loop on descriptor 4

- **Branch** `scriptorium/hc-23b-sanity-fd`, worktree `.claude/worktrees/hc-23b`. **Depends on** HC-19, HC-23a, HC-26c (`readSheetFile`).
- **May edit** `packages/supervisor/src/deps.ts` (`ExecSpec.paramsPath?: string`; `createExec` stdio index 4), `packages/supervisor/src/supervisor.ts` (`oneRun` only), `packages/supervisor/src/sanity.ts` (new: `deriveSanityParams`), `packages/supervisor/src/sanity.test.ts` (new), `packages/supervisor/src/launch.test.ts` (one case: the stdio array). **Must not edit** `childEnv`, `PASS_THROUGH`.
- **Behaviour.** `deriveSanityParams(settings, sheet, lifeKey): SanityParams` = `{v:1, life, common_sense: sheet.attributes.common_sense, rolls: settings.instinct.rolls, arm: settings.instinct.arm}`, and nothing else from the sheet. In `oneRun`, when `settings.instinct.enabled && settings.instinct.sanity && settings.harness !== 'claude'` and the sheet file is valid, write `instinct/sanity.json` (0600) and set `spec.paramsPath`; `createExec` opens it read-only as descriptor 4 (`stdio: ['ignore', out, 'ignore', prompt, params]`, `'ignore'` when absent). The sheet is not otherwise visible to the child. Where the loop (an owned loop, not the model) holds `common_sense` in process memory: it has no shell, no environment dump and its file tools are bounded to memory and skills (confirm in HC-05), so the model cannot read it; this is a deliberate, narrow exception to HC-26c's rule and is Open items 4.
- **Tests and revert checks.** `claude harness: no fd 4, no sanity.json` (revert: deliver always: fails); `chatgpt harness with instinct on: fd 4 holds exactly the five SanityParams keys and no other sheet field` (assert the parsed keys); `instinct off: nothing is delivered`; `sanity off: nothing is delivered`; `the child environment and arguments contain neither the value nor the file name`; `an invalid sheet delivers nothing and the run goes on`.
- **Checks.** supervisor tests, lint, typecheck, `check:repo`. **Size** 25k. **Commit subject** `feat(supervisor): hand the loop its veto parameters on descriptor 4 (HC-23b)`. **On-cap** as HC-17a.

## HC-24: HW2 integration against a fake world, docs, wave close

- **Branch** `scriptorium/hc-24-instinct-integration`, worktree `.claude/worktrees/hc-24`. **Depends on** HC-17a to HC-23b merged on `scriptorium/hw2`.
- **May edit** `packages/instinct/src/integration.test.ts` (new), `packages/instinct/src/fake-world.fixture.ts` (extend scripts only), `packages/supervisor/src/instinct.integration.test.ts` (new), `docs/instinct.md` (new, at most 120 lines: what the step is, off by default, the three results, the audit file, the forced escalations, the honest limits; no sheet numbers beyond the brief's published table), `docs/architecture.md` (one paragraph and one table row), `docs/threat-model.md` (one paragraph: the instinct child holds the MCP token and the sheet and runs as the supervisor user; it reads the workspace read-only as data). **Must not edit** product code (a failing integration test is reported, not fixed here).
- **Behaviour.** The supervisor integration test runs the real `geldar-instinct` child (`node packages/instinct/src/cli.ts run`, through a test `execSelf` that spawns it with `instinctEnv`-shaped env and a temporary state directory holding a valid sheet) against the fake MCP world on `127.0.0.1`, with the model run faked by the supervisor test fixture. Cases (each a named test; "model run" is the fixture's `exec` of the sh wrapper):
  1. **off**: `GELDAR_INSTINCT` unset or `off`: no child spawned, no `instinct.jsonl`, zero connections on the fake world; the model runs. (Revert: default to on.)
  2. **on, settle**: sheet idle weights, an adopted goal in the temp workspace `goals.md`, a recorded habit for it, a status with no running intent and no agents: the fake world sees exactly one `act`; the supervisor starts no model run; `instinct.jsonl` has one `settle` line with `source: "instinct"`; the next waking's prompt (forced pass) carries the `own_act` fact.
  3. **on, pass-with-facts**: a status with a thing in view within the radius: the model runs once and its prompt file ends with the `new_sighting` fact; no `act` reached the fake world.
  4. **forced escalation** (three tests, each asserting `kind: 'pass'`, `forced: true`, one model run and no `act` call even when a habit exists that would settle): speech addressed to the agent; a first-time agent in view; a failure past the cap (script the failing intent events until `retryCap` is reached for cleverness 3: 4 attempts).
  5. **failure under the cap**: the first failure settles a varied resubmission (one `act`), the second failure with a different argument still counts as the same problem (assert `attempts` is 2 in `state.json`).
  6. **restart**: stop the supervisor, create a new `Supervisor` on the same state directory: `waking` continues, `attempts` and `habits` persisted, `picks_in_a_row` persisted, and the audit file keeps appending (no truncation).
  7. **think check**: after `maxPicks` (3) settles in a row the fourth waking runs the model (reason `max_picks`).
  8. **the step fails safe**: the fake world closed (connect refused), a child that exits 1, a child that hangs past `GELDAR_INSTINCT_TIMEOUT` (CI only, rule 19) and a sheet that is invalid: each leaves the player running the model, never raises `fails`, writes an `error` or `pass` line.
  9. **blindness**: the prompt file of every waking, the model child's recorded environment and arguments and every `facts` string contain none of: a sheet key name in quotes, `roll`, `dice`, `score`, `sheet`, `instinct`, and no digit beyond the `repeat_failure` count.
- **Docs and close.** After the tests pass: update `docs/instinct.md`, `docs/architecture.md`, `docs/threat-model.md`; the wave retro and process changes follow the `campaign-packet` skill section 6 (a separate docs packet and the orchestrator).
- **Checks.** `./scriptorium.ps1 pnpm exec vitest run packages/instinct packages/supervisor packages/psyche`; lint; typecheck; `check:repo`; `check:specs` is not affected (these docs are outside `docs/analysis/scriptorium`). The wave-end full `./scriptorium.ps1 check` runs on `scriptorium/hw2`.
- **Size** 40k. **Commit subject** `test(instinct): HW2 integration against a fake world, with docs (HC-24)`. **On-cap** commit what passes; split the docs into their own packet.

---

## HW3: temperament and persona

## HC-25: sheet-to-persona generator for `geldar-play new` (both launchers)

- **Branch** `scriptorium/hc-25-persona-sheet`, worktree `.claude/worktrees/hc-25`. **Depends on** HC-17b.
- **Rules inlined.** Identity is write-once (geldar 0015): this is a birth-time act that runs before `new`, on the owner's persona directory, never on a clone. The text has no numbers and no labels. Only the two fields furthest from 3 get a sentence, each one of three wordings. The generator never sees the world and has no network.
- **May edit** `packages/persona-sheet/package.json`, `tsconfig.json`, `src/cli.ts`, `src/bank.ts`, `src/render.ts`, `src/render.test.ts`, `src/bank.test.ts` (all new), `image/Dockerfile` (the install filter: add `persona-sheet`; the `geldar-persona-sheet` RUN line), `launcher/lib/persona-sheet.sh` (new), `launcher/lib/persona-sheet.ps1` (new), `launcher/geldar-play` and `launcher/geldar-play.ps1` (the verb list, `verb_needs` and the dispatch: to confirm the exact lines, see `launcher/geldar-play` lines 26 to 33, 112, 113 and 149), `launcher/messages.d/62-persona-sheet.tsv` (new), `docs/troubleshooting.md` (headings and rows for the five keys), `launcher/test/parity.ts` (add group `sheet` to both lists), `launcher/test/persona-sheet-suite.ts`, `launcher/test/persona-sheet.bash.test.ts`, `launcher/test/persona-sheet.pwsh.test.ts` (new), `launcher/test/fake-docker.d/40-persona-sheet.sh` (new: a `fake_role_player_sheet` that prints the fixture paragraph and honours `--network none`).
- **Behaviour.**
  1. Generator (`render.ts`): `renderTemperament(sheet: Sheet, playerId: string): string | null`. Fields in fixed order `curiosity, common_sense, cleverness, aggression, law, good` (`law` and `good` read from `alignment`). Distance from 3 is `abs(score - 3)`; sort by distance descending, ties by the fixed order; take the first two with distance above 0; none gives `null` (the all-3 sheet adds nothing). Side is low for 1 and 2, high for 4 and 5. The wording index is `fnv1a32(playerId + '\0' + field) % 3` (FNV-1a over UTF-8 bytes, offset 2166136261, prime 16777619), so a rerun is reproducible. Output is the sentences joined by one space, ending with a newline, no heading.
  2. `bank.ts`: the 36 sentences, `BANK[field][side]` an array of 3 (exactly these; the first two of each are the brief's own sentences for the extreme and the moderate score, the third is new; the strength nuance between 1 and 2 (4 and 5) is not kept: Open items 8).

     | Field | Low (1 or 2) | High (4 or 5) |
     |---|---|---|
     | curiosity | You have little interest in the unknown. / You keep mostly to what you know. / New things rarely tempt you away from the familiar. | New places and things pull at you. / You cannot leave a mystery alone. / You like to find out what lies beyond the next rise. |
     | common_sense | You often act before you think. / You sometimes miss the obvious. / Plain warnings do not always register with you. | You are practical and level-headed. / Little gets past your good sense. / You notice what is plainly in front of you. |
     | cleverness | New ideas come to you slowly. / You prefer the tried way. / You tend to repeat what has worked before. | You often see another way to do things. / You are full of new ideas. / When one way fails, another comes to mind. |
     | aggression | You avoid any fight you can. / You would rather run than fight. / You give way before you stand and quarrel. | You stand your ground. / You meet trouble head on. / You do not back away from a quarrel. |
     | law | You follow no one's rules but your own. / Rules bend when they get in your way. / You go your own way, whatever has been agreed. | You keep your word and respect what is others'. / Your word is iron and you honour every agreement. / You hold to what was agreed, even when it costs you. |
     | good | You look after yourself, whoever pays. / You put yourself first. / Other people's needs come after your own. | You help others when you can. / You give freely, even at a cost to yourself. / You are quick to share what you have. |

  3. `cli.ts`: `geldar-persona-sheet render --player <id> --sheet <path>` prints the paragraph and exits 0; exits 3 and prints nothing when the sheet is all 3 (nothing to add); exits 2 for an invalid sheet (`parseSheet` null) or an invalid id (`^[a-z][a-z0-9-]{0,30}$`).
  4. Launcher verb `persona-sheet <id> --sheet <file> --persona-dir <dir>`, both twins, in `persona-sheet.sh` and `.ps1` (group `sheet`): needs `docker` only. Steps: validate `<id>` and that `<dir>/<id>/memory/identity.md` passes the existing `persona_part` and `persona_read` checks (reuse them: `persona_load` in `launcher/lib/new.sh`; `Read-Persona` in `new.ps1`); refuse a `--sheet` that is not a regular file, is a link, or is over 4096 bytes (`persona_sheet_bad` with the reason word); refuse when `<dir>/<id>/.sheet-applied` exists (`persona_sheet_applied`; the sidecar sits outside `memory/`, so `new` never copies it); resolve the kit image from `GELDAR_KIT_IMAGE` through `resolve_kit_image ''` (a missing value is `persona_sheet_failed` with reason `image`: Open items 9); run one throwaway container through `helper_run` with `--network none`, `--user <host uid:gid>` and the sheet mounted `-v <sheet>:/in/sheet.json:ro`, script `geldar-persona-sheet render --player <id> --sheet /in/sheet.json` (the output comes back on stdout, nothing is mounted writable); exit 3 prints `persona_sheet_noop` and writes nothing; otherwise the text is checked with the same byte checks as a persona file (control characters, UTF-8, invisible characters) and the combined identity stays within 8192 bytes (else `persona_sheet_bad` reason `size`); then `identity.md` is replaced whole through a temporary file and `rename` (a blank line, then the paragraph appended), the sidecar is written with `sha256(sheet bytes)` and `sha256(paragraph)` (mode 0600), and `persona_sheet_done` is printed. The sheet text is never printed and never put on a command line.
  5. Messages (`62-persona-sheet.tsv`): `persona_sheet_done    The temperament was added to the identity file for %s. Next: geldar-play new %s --persona-dir ...`; `persona_sheet_noop    That sheet has no setting away from the middle, so nothing was added for %s.`; `persona_sheet_bad    The sheet or persona for %s was refused (%s). Nothing was changed.`; `persona_sheet_applied    A sheet was already applied to the persona for %s. Nothing was changed.`; `persona_sheet_failed    The temperament for %s could not be made (%s). Nothing was changed.`. Rows for `done` and `noop` in the "Not a problem" table; `###` sections for the other three with the three labelled paragraphs.
- **Tests and revert checks.** Package: `all 15625 sheets: the output has no digit, none of the 15 alignment labels, none of score|sheet|stat|roll|dice|attribute|alignment|trait|level|proficiency, passes markedWords (watch human maker stream credit shard) and forbiddenMention, is plain ASCII and under 300 characters` (marker scan; revert: put a label into a sentence and it fails); `only the two fields furthest from 3 appear, ties by the fixed order`; `the all-3 sheet renders null`; `the same player and sheet always give the same wording; a different player id may differ`; `every one of the 36 sentences is used by some sheet`; `wording index is fnv1a32 mod 3 (three test vectors)`. Launcher (both twins through `persona-sheet-suite.ts`): `identity.md gains the paragraph and nothing else changes; goals.md untouched`; `a second run is refused and nothing changes`; `an all-3 sheet writes nothing and prints noop`; `the docker call has --network none, a read-only sheet mount and no sheet text in any argument` (fake docker call log); `a link, a hard-linked identity file, an oversized combined identity are refused before any write`; `new --persona-dir still accepts the changed persona`. Twin parity is enforced by `check:repo`.
- **Checks.** package typecheck and `./scriptorium.ps1 pnpm exec vitest run packages/persona-sheet`; `./scriptorium.ps1 pnpm exec vitest run launcher/test/persona-sheet.bash.test.ts launcher/test/persona-sheet.pwsh.test.ts` (the bash one skips on Windows without bash: see `launcher/test/harness.ts`); `./scriptorium.ps1 pnpm exec vitest run tools/repo-checks/src/troubleshooting.test.ts`; lint; typecheck; `check:repo`.
- **Size** over 40k in one session; two sessions: HC-25a (package, bank, scans, Dockerfile) and HC-25b (verb, both twins, messages, docs, tests). Dispatch as two cards if the first report shows more than 30k used. **Commit subject** `feat(launcher): add geldar-play persona-sheet, birth-time temperament from a sheet (HC-25)`. **On-cap** as HC-17a.

## HC-26a: host side of sheet delivery: `new --sheet` and `sheet-set`

- **Branch** `scriptorium/hc-26a-sheet-host`, worktree `.claude/worktrees/hc-26a`. **Depends on** HC-25 (group `sheet`, messages file pattern), D-HC-03.
- **Rules inlined (D-HC-03).** The world database is canonical; the kit copy is made by the launcher and refreshed by an explicit owner command. The host copy lives in the player's private state directory (`$(player_dir <id>)`, mode 0700), never in the clone (the repository is public and the workspace is readable by the character).
- **May edit** `launcher/lib/sheet.sh` (new), `launcher/lib/sheet.ps1` (new), `launcher/lib/new.sh` and `new.ps1` (the `--sheet <file>` option in `verb_new` / `Verb-new`, and one call after the player directory is made), `launcher/geldar-play` and `.ps1` (verb `sheet-set`: verb list and `verb_needs` is `docker git perl`, to confirm), `launcher/messages.d/63-sheet.tsv` (new), `docs/troubleshooting.md`, `launcher/test/sheet-suite.ts`, `launcher/test/sheet.bash.test.ts`, `launcher/test/sheet.pwsh.test.ts` (new), `launcher/test/new.test.ts` (one case for `--sheet`).
- **Behaviour.** `sheet_store <id> <file>` (twins `sheet_store` / `Save-Sheet`): the file must be a regular file, not a link, 1 to 4096 bytes, valid UTF-8 text starting with `{` after optional blanks (the full parse is `geldar-instinct check-sheet` at delivery, HC-26b: no image is needed here); it is copied to `$(player_dir <id>)/sheet.json` with `umask 077` through a temporary file and `rename`, directory `private_mkdir`ed; mode 0600; `sheet_stored` is printed. `new --sheet <file>` calls it after the existing `private_mkdir "$d"` of `verb_new` (so a failed sheet leaves the repository created: the check runs before any `gh` call, at the same point as `persona_load`, and a bad file stops `new` with `sheet_bad` before anything is created). `sheet-set <id> <file>`: `read_player`, `lock_acquire`, `sheet_store`; delivery to a running volume happens at the next `start` or `restart` (HC-26b), or now when `pl_running` is true (HC-26b adds that call; HC-26a prints `sheet_stored` only). The sheet is never echoed. Messages: `sheet_stored    The sheet for %s is stored on this machine. It reaches the player at the next start.`; `sheet_bad    The sheet file for %s was refused (%s). Nothing was changed.`.
- **Tests and revert checks (both twins).** `new --sheet stores the sheet 0600 in the state directory and not in the clone` (revert: copy it into the clone: the clone scan finds it); `git ls-files` of the new clone does not list a sheet file; `a link, a directory, a 5 KB file and a binary file are refused before anything is created`; `sheet-set replaces the stored copy and keeps its mode`; `no docker call is made`; `the sheet text never appears in stdout, stderr or any call log`; twin parity by `check:repo`.
- **Checks.** `./scriptorium.ps1 pnpm exec vitest run launcher/test/sheet.bash.test.ts launcher/test/sheet.pwsh.test.ts launcher/test/new.test.ts`; troubleshooting test; lint; typecheck; `check:repo`.
- **Size** 38k. **Commit subject** `feat(launcher): store a character sheet privately with new --sheet and sheet-set (HC-26a)`. **On-cap** as HC-17a.

## HC-26b: deliver the sheet into the supervisor volume at start and restart

- **Branch** `scriptorium/hc-26b-sheet-deliver`, worktree `.claude/worktrees/hc-26b`. **Depends on** HC-26a, HC-18 (`check-sheet`).
- **May edit** `launcher/lib/player.sh` and `player.ps1` (`verb_start`, `verb_restart`, `verb_sheet_set`: one new function call each; new functions `pl_deliver_sheet` / `Send-PlayerSheet`), `launcher/lib/sheet.sh` and `.ps1` (the delivery helper), `launcher/messages.d/63-sheet.tsv` (`sheet_failed`), `docs/troubleshooting.md`, `launcher/test/sheet-suite.ts` (cases), `launcher/test/fake-docker.d/50-sheet.sh` (new: `fake_role_player_sheet_put`). **Must not edit** `image/compose/player.yml` (no new mount: the volume already exists).
- **Behaviour.** `pl_deliver_sheet <id>`: when `$(player_dir <id>)/sheet.json` does not exist, do nothing and return 0 (instinct off or no sheet: a missing sheet is `no_sheet` at run time). Otherwise run one throwaway kit container through `helper_run` with: `--network none`, `--user 0:0`, `--cap-add CHOWN --cap-add FOWNER` (the helper runs as root for the first start only because a fresh volume belongs to root; `helper_run` already drops every other capability and sets no-new-privileges; confirm the set by reading `launcher/lib/prepare.sh` lines 25 to 41), mounts `-v <host sheet>:/in/sheet.json:ro` and `-v geldar-sup-<id>:/vol`, and the script `geldar-instinct check-sheet /in/sheet.json && mkdir -p /vol/instinct && cp /in/sheet.json /vol/instinct/sheet.json.new && chown -R 1001:1001 /vol/instinct && chmod 0700 /vol/instinct && chmod 0600 /vol/instinct/sheet.json.new && mv /vol/instinct/sheet.json.new /vol/instinct/sheet.json`. A failing check or copy dies `sheet_bad` (reason `invalid`) or `sheet_failed` and the start is refused before `compose up` (never start a player whose sheet delivery failed, so the player and its sheet cannot disagree). `verb_start` and `verb_restart` call it after `pl_allowlist` and before `compose up`; `verb_sheet_set` calls it after storing when `pl_running` is true. Mount nothing from the workspace volume or the clone; the sheet text is never in an argument (only the host path, which is a state directory path).
- **Tests and revert checks (both twins, fake docker).** `start with a stored sheet runs exactly one delivery helper before compose up, with --network none, a read-only sheet mount, the supervisor volume, and no /player mount` (revert: mount `geldar-ws-<id>`: the assertion on mounts fails); `no stored sheet: no helper`; `an invalid sheet (the fake check exits 2) refuses start with sheet_bad and compose is never called` (revert: ignore the exit code); `restart redelivers`; `the helper's script text names /vol/instinct and never /player`; `no argument of any docker call contains a JSON brace or a sheet key name`; `sheet.json mode 0600 and owner 1001 are in the script text`.
- **Checks.** the sheet and player launcher tests, `launcher/test/player.test.ts` (existing cases must pass unchanged), troubleshooting test, lint, typecheck, `check:repo`.
- **Size** 35k. **Commit subject** `feat(launcher): deliver the stored sheet into the supervisor volume at start (HC-26b)`. **On-cap** as HC-17a.

## HC-26c: supervisor-side sheet reading and the proof the model never sees it

- **Branch** `scriptorium/hc-26c-sheet-proof`, worktree `.claude/worktrees/hc-26c`. **Depends on** HC-26b, HC-19.
- **May edit** `packages/instinct/src/sheetfile.ts` (new, `readSheetFile`), `packages/instinct/src/sheetfile.test.ts` (new), `packages/instinct/src/run.ts` (use `readSheetFile` instead of the plain read), `packages/supervisor/src/blind.test.ts` (new), `tests/image/player-compose.test.ts` (cases), `tests/image/sheet-blind.test.ts` (new, Docker; skipped locally without Docker, runs in CI). **Must not edit** `childEnv` or `PASS_THROUGH` (the test proves they are right; a failure is reported).
- **Behaviour.** `readSheetFile(dir: string, uid: number): Sheet | null`: `lstat` the file (a link, a non-regular file, a mode with any group or other bit, an owner other than `uid` on POSIX, or a size over 4096 bytes gives `null`, which `run` reports as `pass` `sheet_invalid`), then `parseSheet`. On Windows the mode and owner checks are skipped (tests that need them skip, rule 14).
- **The proof (`blind.test.ts` and the compose and image tests).** A sentinel sheet is used: the compact JSON text of a sheet whose six attribute scores are 2, 4, 1, 5, 2, 4 and the `GELDAR_INSTINCT*` variables are set in the supervisor environment together with a poisoned `GELDAR_SHEET` and `GELDAR_INSTINCT_SHEET`.
  1. **env**: for each harness (`claude`, `chatgpt`, and `local` once HC-08 has merged) `childEnv(settings, env)` has no key matching `/SHEET|INSTINCT/i` and no value containing a sheet key name or the sentinel text; the same for the `launchCommand` arguments and `spec.cwd` of a real `oneRun` spec captured through the fixture. (Revert: add `GELDAR_INSTINCT` to `PASS_THROUGH`: fails.)
  2. **file and path**: the sheet sits at `<stateDir>/instinct/sheet.json` and nowhere under `settings.workspace`; after a full fixture run (instinct on, a settle and a model run) a recursive scan of the fake workspace and of every captured child argument finds neither the sentinel text, the file name `sheet.json`, nor the path of the state directory (the prompt file `prompt.txt` path is allowed: it is passed as descriptor 3). (Revert: write the sheet into the workspace: fails.)
  3. **mounts** (compose text, no Docker): the `player` service mounts the workspace only at `/player`, the supervisor state only at `/state/supervisor`, no host path, no secret; the `keeper` service mounts the supervisor state read-only and has no instinct variable; neither service mentions `sheet`. (Revert: add a `sheet` bind mount: fails.)
  4. **modes** (Linux CI, Docker): in the built kit image, with `/state/supervisor` prepared as the player entrypoint prepares it (2750, uid 1001, gid 1002) and `instinct/sheet.json` created 0600 uid 1001 inside a 0700 directory, running as uid 1000 (the player) and as uid 1002 (the keeper) `cat` fails with permission denied for both; as uid 1001 it succeeds. (Revert: chmod 0644: fails.)
  5. **the narrow exception**: for harness `chatgpt` with sanity on, the only sheet-derived data the loop process receives is the five-key `SanityParams` on descriptor 4 (HC-23b); the test asserts the parsed keys and that `aggression`, `curiosity`, `cleverness`, `law`, `good` and `op_modes` are absent from it and from everything else the loop process was given.
- **Checks.** `./scriptorium.ps1 pnpm exec vitest run packages/instinct/src/sheetfile.test.ts packages/supervisor/src/blind.test.ts tests/image/player-compose.test.ts`; `tests/image/sheet-blind.test.ts` (Docker; note it ran or skipped); lint; typecheck; `check:repo`.
- **Size** 35k. **Commit subject** `test(supervisor): prove the sheet never reaches the model child; harden the sheet read (HC-26c)`. **On-cap** as HC-17a.

---

## Open items

Every `(to confirm)` in this file, and every question this author could not settle.

### Things to confirm before a card is Ready

1. **The world's tool shapes** (HC-18 `observe.ts`, HC-20 and HC-21a act builders): `status` and `wait` output, the `cursor` and `max_seconds` arguments, whether `wait` with a short timeout returns at once, how speech addressed to the agent is marked, the argument shape of `act` for an intent (goal, program, arguments, wake_on, limits), the name of the travel target distance, the world tick, and whether a second MCP connection reading `wait` events disturbs the model's own cursor. Until one of these is read from the geldar tool schemas the instinct step is blocked, and a wrong answer to the cursor question would make the step steal events from the player. This is the largest risk.
2. **AN-03 and GX-02**: the engine's entry file and API names (`rngFor`, `roll`, `step`, `factor`, `alignmentLabel`, `STANDARD_SHEET`), how dice come from `Rng.next()`, the import specifier style (`.ts` or `.js`), the engine's purity ban list, the released source directory and file list (HC-17a, HC-17b, HC-23a).
3. **Kit A**: the `mind-loop` file where a model tool call is executed, the call allowance object of HC-10 and HC-11 and its fallback, the loop's `emit` name, whether `packages/mind-loop` exports a world connector (HC-23a, HC-18), the HC-04 stamp shape for `harness` and `model` in `instinct.jsonl`, and `settings.ts`'s `harness` union after HC-08 (HC-19, HC-26c).
4. **A tension in the card set**: HC-23a puts `common_sense` inside the owned-loop process (descriptor 4, HC-23b), while HC-26c's rule is that the sheet never reaches the model child process. The cards keep the exception narrow (one derived integer, owned loops only, no shell tool, nothing in env or files) and prove it. If the owner wants no exception, HC-23 must become a supervisor-side service the loop asks over a pipe, which is a larger card.
5. **The fight-near-death floor** (brief 5.2 and 5.8) is aggression-dependent; the loop does not receive aggression, so HC-23a uses the standard floor of 6. A per-agent floor needs a second derived integer in `SanityParams`.
6. **The per-agent retry cap formula** `clamp(base + (cleverness - 3), 2, 6)` (HC-20) is a first guess for the v3 plan's "retry cap by cleverness"; the brief itself has one shard-wide `failure_hard_cap` of 4.
7. **Dropped brief behaviours for lack of game knowledge or map memory in the kit**: the brief's waypoint, remembered-spot, blueprint and "fresh arguments" variations (HC-20, HC-21a), the explorer, farmer and crafter idle candidates (they need a map or recipe ingredients). HC-31 and AN-45 can add them once the Body publishes the programs.
8. **Persona wording bank** (HC-25): the v2 4.1 bank was not available to this author; the 36 sentences are the brief's own sentences plus one new sentence per field and side. The nuance between scores 1 and 2 (4 and 5) is lost; the owner should approve the bank wording.
9. **How `persona-sheet` finds a kit image before any player exists** (HC-25): the card uses `GELDAR_KIT_IMAGE`. Whether the release should ship the digest in the launcher's share directory instead is undecided.
10. **Launcher line numbers** in `launcher/geldar-play` and `.ps1` (verb list, `verb_needs`, dispatch), `launcher/test/core.test.ts` capability output, `tests/image/cli.test.ts` and `tests/image/player-compose.test.ts` assertions, `biome.json` for the vendored engine, and the `--cap-add` set of the delivery helper (HC-25, HC-26a, HC-26b, HC-17a, HC-18, HC-19, HC-26c).
11. **The `source` tag in the world**: whether the world's `act` tool accepts or records a `source` and whether GX-01 stamps it. Until then "source instinct" exists only in `instinct.jsonl` and in the `own_act` fact path.

### Design questions not settled

- **No commitment store and no Postgres** (D-HC-04, D-HC-06): the instinct step's memory is a 0600 JSON file. A corrupt or lost `state.json` silently resets failure counts, habits and the seen set, which changes behaviour without an audit gap. The cards rename a corrupt file and log it; they do not rebuild state from the audit.
- **Idle-goal reading**: the adopted goal is the first ranked line of the agent's own `goals.md`, a free-text file the model edits. An agent that rewrites its goals every waking never builds a habit. That is acceptable (it falls back to the model) and unmeasured.
- **Settled waking cadence**: a settle sleeps `GELDAR_RUN_DELAY` (20 s) and the loop runs the step again; nothing yet varies wake spacing by curiosity (v3 plan 4.3).
- **Whether `instinct.jsonl` needs rotation** (it grows by one line per waking) is not decided; HC-37 (operator export) is the natural owner.
- **`new --sheet` at birth versus `sheet-set` later**: both exist (HC-26a). Refresh of proficiency from the world's canonical sheet is manual (an owner exports and runs `sheet-set`); no card automates it.
- **Veto and corrective retry on one allowance** (HC-23a): the truth table waives a second veto instead of falling back; D-CS-18 allows either. The owner should confirm the waiver.
