# CI scope

The workflow is `.github/workflows/ci.yml`. Its jobs are `changes`, `static`,
`tests` (a matrix of file groups), `e2e`, `markdown` and `ci gate`.

## Required check

`ci gate` is the one check to require on `main`. It passes only when `changes`
succeeded and each of `static`, `tests`, `e2e` and `markdown` either succeeded
or was skipped. A skip is only possible because `changes` said the job had
nothing to do. A failed or cancelled job fails the gate.

## What runs on a pull request

`changes` diffs the pull request's base and head commits with
`git diff --name-only`. The rules are in `tools/repo-checks/src/ci-scope.ts`.

- `static` always runs: lint, typecheck, repo checks, test-group coverage,
  spec references, workflow policy, actionlint and the scriptorium smoke test.
- `tests` is skipped only when every changed path is a `.md` file under
  `docs/analysis/` or `.claude/agent-memory/`. Any other change runs it.
- `e2e` runs when a changed path is under `launcher/`, `image/`, `packages/`,
  `template/`, `tests/e2e/`, `tools/release/` or `.github/workflows/`, or when
  a changed file is a `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
  `.nvmrc`, a `vitest.config.*` or a `tsconfig*.json`. The basename rules also
  match nested files, so a stray match runs more, not less.
- `markdown` runs when any changed path ends in `.md`.

## Fail open

Scope only ever turns jobs off for a clearly docs-only change. These all run
every job:

- a pull request whose changed-path list is empty,
- a failed `git diff`,
- a path that is not a non-empty string,
- any error reading the list.

A mistake in the scope rules therefore runs more checks, never fewer.

## Main and manual runs

A push to `main` and a `workflow_dispatch` run every job. The scope step is not
consulted, so a merge is always fully tested.

## Markdown lint

`pnpm lint:md` runs markdownlint-cli2 with the pinned version in
`package.json`. The rules and the reason for each disabled rule are in
`.markdownlint-cli2.jsonc`. The lint runs in the `markdown` job and locally.

## Changing the rules

Change `ci-scope.ts` and its tests together. `ci-workflow.test.ts` checks that
the gate waits for `changes` and that `tests` and `e2e` depend on it.
