# HC-17a worknote: the psyche mirror

- Engine source: geldar tag `psyche-v1.0.0`, commit `549e7d0736dc05049cd2c48c7f8aa02191781f9f`, release tree hash `b89848ab21240fbb2e33832d671a51d73e8393b3235807f19fa7a2355c5e4efe` (`geldar-tree-v1`, engine_version 1).
- Vendored with `node packages/psyche/scripts/vendor.ts --source <geldar psyche/src> --commit 549e7d07...`. The source was read from `git archive` of the tag; no geldar file was edited.
- `engine/` holds the 10 release files, `temperament.ts` included (inactive, no approved delivery route). The card's tree hash of `engine/` equals the release tree hash because the files are LF-only.
- Card edits outside the May-edit list, approved by the orchestrator: `.dockerignore` (`!packages/psyche`), `image/Dockerfile` (filter list), `tests/image/build.test.ts` (expected package list), `pnpm-lock.yaml` (importer `packages/psyche: {}`).
- `package.json` exports `./engine/index.ts` until HC-17b writes `src/index.ts`.
- Tests: `src/mirror.test.ts`, `src/engine.test.ts`. No install was run: `node_modules` in the worktree links to the main checkout's pnpm store.
