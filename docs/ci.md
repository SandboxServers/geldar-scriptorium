# CI scope

The workflow is `.github/workflows/ci.yml`. Its jobs are `changes`, `static`,
four vitest families (`hostile`, `launcher`, `image`, `rest`, each a matrix of
file groups), `e2e`, `markdown` and `ci gate`.

## Required check

`ci gate` is the one check to require on `main`. It passes only when `changes`
succeeded and each of `static`, the four vitest families, `e2e` and `markdown`
either succeeded or was skipped. A skip is only possible because `changes` said
the job had nothing to do. A failed or cancelled job fails the gate.

## What runs on a pull request

`changes` diffs the pull request's base and head commits with
`git diff --name-only`. The rules are in `tools/repo-checks/src/ci-scope.ts`.

- `static` always runs: lint, typecheck, repo checks, test-group coverage,
  spec references, workflow policy, actionlint and the scriptorium smoke test.
- `hostile` and `launcher` run when a changed path is under `launcher/`,
  `image/`, `packages/`, `tools/release/` or `.github/workflows/`, when it is a
  non-markdown file under `template/`, or when it is a toolchain file (a
  `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.nvmrc`, a
  `vitest.config.*` or a `tsconfig*.json`). A README-only change under
  `template/` does not run them.
- `image` runs when a changed path is under `launcher/`, `image/`, `packages/`,
  `template/`, `tools/`, `tests/` (not `tests/e2e/`) or `.github/workflows/`,
  or is a toolchain file. It covers `tests/image/`, `tests/hostile/` and
  `tests/template/`.
- `rest` runs for the same changes as `image`, and for any path no rule knows
  that is not markdown. It covers every other test file.
- `e2e` runs when a changed path is under `launcher/`, `image/`, `packages/`,
  `template/`, `tests/e2e/`, `tools/release/` or `.github/workflows/`, or when
  a changed file is a toolchain file. The basename rules also match nested
  files, so a stray match runs more, not less.
- `markdown` runs when any changed path ends in `.md`.

A changed `.md` file that no test reads (a root `README.md`, say) turns every
vitest family off. The files the tests read are `docs/linux-tests.md`,
`docs/release.md` and `docs/ci.md`, and they keep `rest` and `image` on.

A docs-only change (every path a `.md` under `docs/analysis/` or
`.claude/agent-memory/`) turns every vitest family and `e2e` off.

## Test groups

Each test file is in exactly one group in `tools/repo-checks/src/ci-groups.ts`.
Each group belongs to one family, and a family's matrix runs only when its
scope flag is on. The shards are balanced on the timings of the last green run
(seconds, summed per shard):

- `hostile-a`: h11-gate, h08-allowlist, h17-recovery (about 525).
- `hostile-b`: h13-recheck, devworld.pwsh, h14-push, h07-clivolume (about 524).
- `hostile-c`: every other hostile file, including new ones (the rest of the
  family, about 485 plus files with no timing).
- `launcher-a`: upgrade.pwsh, session, new, core-timing (about 764).
- `launcher-b`: pre, upgrade.bash, core, setup, multi (about 777).
- `launcher-c`: every other launcher file, including new ones (bundle, finish,
  commands, persona.pwsh, stage, about 790, and the files with no timing).
- `image`: `tests/image/`, `tests/hostile/`, `tests/template/`.
- `rest`: every other test file.

The timings are a sum of serial file times, a rough upper bound: vitest runs
the files of one job in parallel, so the job takes about as long as its
longest file. Re-measure with the timing output of a run before moving files.
Run `node tools/repo-checks/src/ci-groups-cli.ts check` to confirm every file
is in one group.

## Fail open

Scope only ever turns jobs off for a clearly docs-only change. These all run
every job:

- a pull request whose changed-path list is empty,
- a failed `git diff`,
- a path that is not a non-empty string,
- any error reading the list.

A non-markdown path that no rule knows turns `rest` on. A mistake in the scope
rules therefore runs more checks, never fewer.

## Main and manual runs

A push to `main` and a `workflow_dispatch` run every job. The scope step is not
consulted, so a merge is always fully tested.

## Markdown lint

`pnpm lint:md` runs markdownlint-cli2 with the pinned version in
`package.json`. The rules and the reason for each disabled rule are in
`.markdownlint-cli2.jsonc`. The lint runs in the `markdown` job and locally.

## Changing the rules

Change `ci-scope.ts` and its tests together. Change `ci-groups.ts` and the
matrix in `ci.yml` together. `ci-workflow.test.ts` checks that the gate waits
for every job and that each family job is gated by its scope flag, and
`ci-groups.test.ts` checks that each family's matrix lists exactly its shards.
