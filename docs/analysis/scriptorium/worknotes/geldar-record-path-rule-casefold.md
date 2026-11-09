# Path rule tightened: case-folded directory over the identity file

For the geldar repo orchestrator. Do not edit geldar from the scriptorium repo.

## What changed
The path rule (spec section 7, packages/path-rule, launcher recheck.sh and recheck.ps1) now also rejects, in every mode, any path whose ASCII-lowercased form starts with `memory/identity.md/`. Before, only the whole path `memory/identity.md` (any case) was locked.

## The exploit in 3 lines
1. On a case-insensitive host (Windows, macOS default) a session commit adds `memory/Identity.md/x.md`, which passed the rule.
2. The host `merge --ff-only` turns the working-tree file `memory/identity.md` into a directory, deleting the locked identity file.
3. The launcher reports saved, the commit is already on origin, and the next launch is refused as dirty.

## Not done
Rejecting any added path whose case-folded form collides with an existing start-tree path (or a directory prefix of one) needs the start tree, so it cannot live in the pure path rule. It would be a separate check in the host re-check and the gate, and is left for a decision.

## Proposed decision record text
Decision: the path rule treats `memory/identity.md/` (ASCII case-folded) as a prefix that is never allowed. Reason: case-insensitive hosts fold `memory/Identity.md/x.md` onto the locked identity file. This tightens spec section 7 rule for identity; no previously valid path is affected, since identity.md is a file and nothing could legally live under it.
