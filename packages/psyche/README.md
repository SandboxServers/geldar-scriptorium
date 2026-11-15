# @geldar/scriptorium-psyche

The roll engine of the psyche, vendored from the geldar repo `psyche/src` and pinned by a recorded tree hash.

- `engine/` is a byte-for-byte copy of `psyche/src` at the release tag and commit in `MIRROR.json`. Never edit it by hand.
- `MIRROR.json` records the source commit, the release tag, the release tree hash (`geldar-tree-v1`) and the tree hash of `engine/`.
- Re-vendor from the repo root, with a local geldar checkout at a released tag:
  `node packages/psyche/scripts/vendor.ts --source <geldar>/psyche/src --commit <40 hex>`
- The script refuses a source whose tree does not match `psyche/RELEASE.json`, a RELEASE.json whose tag is not `psyche-vX.Y.Z` or whose hash is not 64 hex, a commit that is not 40 lower-case hex, a symlink or junction (the source root too), a source with no engine files, a file over 200 KiB and a `..` path. Every refusal leaves `engine/` and `MIRROR.json` as they were: the copy is built in `.engine-staging` and swapped in only after all checks pass.
- A change to the engine means a new geldar release, a new commit and a new hash in the same PR. `src/mirror.test.ts` hard-codes `GOOD_COMMIT`, `RELEASE_TREE_HASH` and the tag, so at a re-vendor those three are edited by hand in the same PR.
- `temperament.ts` is inactive: no delivery route is approved, and nothing outside this package may name `TEMPERAMENT_BANK`, `temperamentFor` or `psyche/engine/temperament`. `src/mirror.test.ts` scans every file of the repository except `packages/psyche`, `docs/`, `.claude/`, `.git`, `node_modules` and `dist` (and skips binary files and files over 2 MiB).
- Tests: `src/mirror.test.ts` (the pin, purity and import rules, the temperament scan, and the vendor's refusals) and `src/engine.test.ts` (the brief's examples and the boundaries of alignment, mode, step and proficiency).
