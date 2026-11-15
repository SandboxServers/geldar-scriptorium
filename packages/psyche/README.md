# @geldar/scriptorium-psyche

The roll engine of the psyche, vendored from the geldar repo `psyche/src` and pinned by a recorded tree hash.

- `engine/` is a byte-for-byte copy of `psyche/src` at the release tag and commit in `MIRROR.json`. Never edit it by hand.
- `MIRROR.json` records the source commit, the release tag, the release tree hash (`geldar-tree-v1`) and the tree hash of `engine/`.
- Re-vendor from the repo root, with a local geldar checkout at a released tag:
  `node packages/psyche/scripts/vendor.ts --source <geldar>/psyche/src --commit <40 hex>`
- The script refuses a source whose tree does not match `psyche/RELEASE.json`, a commit that is not 40 lower-case hex, a symlink, a file over 200 KiB and a `..` path.
- A change to the engine means a new geldar release, a new commit and a new hash in the same PR.
- `temperament.ts` is inactive: no delivery route is approved, and nothing outside this package may import it. `src/mirror.test.ts` enforces that.
- Tests: `src/mirror.test.ts` (the pin, purity and import rules, and the vendor's refusals) and `src/engine.test.ts` (the brief's examples).
