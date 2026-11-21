# HC-17a worknote: the psyche mirror

- Engine source: geldar tag `psyche-v1.0.0`, commit `549e7d0736dc05049cd2c48c7f8aa02191781f9f`, release tree hash `b89848ab21240fbb2e33832d671a51d73e8393b3235807f19fa7a2355c5e4efe` (`geldar-tree-v1`, engine_version 1).
- Vendored with `node packages/psyche/scripts/vendor.ts --source <geldar psyche/src> --commit 549e7d07...`. The source was read from `git archive` of the tag; no geldar file was edited.
- `engine/` holds the 10 release files, `temperament.ts` included (inactive, no approved delivery route). The card's tree hash of `engine/` equals the release tree hash because the files are LF-only.
- Card edits outside the May-edit list, approved by the orchestrator: `.dockerignore` (`!packages/psyche`), `image/Dockerfile` (filter list), `tests/image/build.test.ts` (expected package list), `pnpm-lock.yaml` (importer `packages/psyche: {}`).
- `package.json` exports `./engine/index.ts` until HC-17b writes `src/index.ts`.
- Tests: `src/mirror.test.ts`, `src/engine.test.ts`. No install was run: `node_modules` in the worktree links to the main checkout's pnpm store.
- HC-17b must re-export names one by one from `./engine` (never `export *`), so `TEMPERAMENT_BANK` and `temperamentFor` are not exposed through the package entry. `package.json` still points `exports` at `./engine/index.ts` until HC-17b writes `src/index.ts`.

## Review findings (HC-17a review of 8f034ac6, fixed in the fix pass)

| # | Finding | Status |
|---|---------|--------|
| 1 | Temperament scan was an extension allowlist and failed open | Fixed: every file under the repo is read, except the listed skips, binary files and files over 2 MiB |
| 2 | Scan pattern matched the bare word `temperament` (breaks HC-25) | Fixed: pattern is `TEMPERAMENT_BANK\|temperamentFor\|psyche/engine/temperament` |
| 3 | Pin had no independent anchor | Fixed: `RELEASE_TREE_HASH` is compared with the engine hash and with MIRROR.json |
| 4 | A failed vendor could delete `engine/`; an empty source passed | Fixed: copy staged in `.engine-staging`, swapped last; empty source refused; refusal tests use a populated `engine/` |
| 5 | 200 KiB boundary, no-timestamp and reproducibility untested | Fixed: exact-boundary and two-run byte tests added |
| 6 | `engine.test.ts` missed axis swap, mode boundary, step clamp, proficiency | Fixed: cases added |
| 7 | RELEASE tag not checked or recorded; source root symlink not refused | Fixed: tag form and hash form checked, root refused if a link |
| 8 | Import rule skipped dynamic `import(` and `require(`; bare imports missed; purity list short | Fixed: all forms flagged; purity list extended |
| 9 | MIRROR.json extra fields; README drift | Accepted (extra fields recorded); README updated |
| 10 | `exports` points at `./engine/index.ts`, which exposes `TEMPERAMENT_BANK` | Open for HC-17b: named re-exports only |
| 11 | `tests/image/build.test.ts` and `tests/template/knowledge-boundary.test.ts` fail biome format at base | Open: pre-existing, outside this packet |
