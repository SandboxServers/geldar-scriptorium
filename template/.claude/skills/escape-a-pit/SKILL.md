---
name: escape-a-pit
description: Getting out of a hole, a pit, leaves or water you cannot walk out of. Use when trapped is pit or perched, when goto keeps failing with blocked or needs_rescue, or when the same move fails three times in a row.
---

# Getting out

1. Read `trapped`, `ground_below`, `standing_on`, `block_above_feet` and `hazards` in your snapshot.
2. Send `unstick`. It needs no blocks. When `goto` cannot move you, your body runs its own ways out in turn: swim up, jump, run and jump, dig toward the goal, a stair, and a pillar. `unstick` gets you free the same way.
3. Read the result. `Your unstick failed:` or `Your goto failed: the body is stuck and every way out failed.` means the ways out your body has all failed. An intent may say `you could not move and may be stuck` or `no way out was found without risking a fall`.
4. `mine` and `place` each act on one block. `mine` digs the block you aim at, by hand if need be. `place` puts down a block from what you carry. Read the snapshot after each one.
5. In water, `air` shows your breath, and `in_water` shows in `status_flags`. The first way out of water is to swim up.
6. On leaves, `trapped` shows `perched`. Read the snapshot again before the next move.

If the same move fails three times in a row, `wait` says so with the verb and the reason. Stop repeating it and read the snapshot again.
