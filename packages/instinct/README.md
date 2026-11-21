# @geldar/scriptorium-instinct

The instinct step (HC-18): `geldar-instinct` wakes once, reads the sheet, takes one wait from the world, decides,
optionally sends one act, saves its store and writes one audit line. Its result is one JSON line on stdout.

## Verbs

- `geldar-instinct run --run <n>` prints one result line and exits 0. It exits 2 when `GELDAR_INSTINCT_STATE` is unset.
- `geldar-instinct check-sheet <path>` prints nothing; exit 0 for a valid sheet, 2 for an invalid or missing one.
- Any other use exits 2. A failure outside `run` exits 1.

## Files (under `GELDAR_INSTINCT_STATE`)

- `sheet.json` is read only. Rolls derived from the sheet (`score`, `dc`, `bonus`, `dice`) reach both the printed
  result and the audit line. The facts and the `why` text do not. Because the audit carries those rolls,
  `instinct.jsonl` is not neutral: it should live in the supervisor volume (outside `/player`) once the supervisor
  wiring exists, and the supervisor must keep the rolls out of anything the agent reads.
- `state.json` is the kit-local store, written atomically at mode 0600. A file of the wrong shape is renamed
  `state.json.bad` and an empty state is used.
- `instinct.jsonl` is the audit, one line per run, one directory up from the state directory.

## Environment

`GELDAR_MCP_URL` (the world, http or https, no credentials), `GELDAR_MCP_TOKEN`, `GELDAR_HARNESS`,
`GELDAR_RUN_MODEL`, `GELDAR_INSTINCT_ARM`, `GELDAR_INSTINCT_FAILURE_CAP` (4), `GELDAR_INSTINCT_MAX_PICKS` (3),
`GELDAR_INSTINCT_THINK_P` (0.25), `GELDAR_INSTINCT_ROLLS` (`on` or `off`). The numbers are first guesses, unmeasured.

`GELDAR_INSTINCT` is the off-by-default switch for the step. The code does not read it yet, and nothing invokes the
step, so setting it changes nothing.

## Open issue: a wait advances the shared delivered mark

`observe.ts` reads the world with `wait`. In the world, a `wait` marks the events it returns as delivered in the
shared world state (`threshold/mcp` `wait.ts`, `rememberDelivered`). So an instinct `wait` can hide events from the
model's later cursorless `wait`. This package does not prevent it, and it is not fixed here. A world-side card must
decide how instinct waits are scoped (a non-advancing read).

**GELDAR_INSTINCT must not be enabled on a life until a world-side non-advancing read exists.** Until then, the
instinct step can cost the model events it would otherwise have seen.

An instinct `wait` also ends an open model wait for the same life (`wait_replaced`).

## Known gaps

- The world identifies instinct connections by the `x-geldar-instinct-key` header (GX-06). `world.ts` does not send it
  yet, so accepted instinct acts are recorded as model acts until HC-19 / HC-L1 wires it.
- The fake-world fixture and its tests (`connectWorld().call` text joining, `isError`, the 20 s timeout) are split to
  HC-18b. This package has unit tests for `replyText` only.
