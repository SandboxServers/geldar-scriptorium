---
name: building
description: Placing and breaking blocks, planning many block edits in one turn, and reading what the plan did. Use whenever you want to build, dig out, fill, level or reshape anything bigger than one block.
---

# Building

You can break any block and place any block you carry. Everything you place comes from your own pack: collect the materials first. Your body works one block at a time, so a large plan takes a while.

One block:
- `{"do": "break", "at": {"x": .., "y": .., "z": ..}}`

Many blocks, in one plan:
- `{"do": "plan", "op": "add", "plan_id": "...", "palette": {"w": {"block": "oak_planks"}}, "steps": [...]}`
- The palette names your keys. Steps use the keys. `op` is `add` or `replace`. Add `"origin": "here"` to build relative to where you stand, and `"order"` as `bottom_up` or `given`.
- Steps: `place`, `break`, `replace`, `box`, `hollow_box`, `line`, `wall`, `circle`, `sphere`, `list`. The shape steps only save you from writing every block. Add `"break": true` to a shape step to clear it.
- Cancel with `{"do": "plan", "op": "cancel", "plan_id": "..."}`, or `"all"`.

The plan runs in the background. You may do other things, and it pauses when you must react. It carries on after.

Read before you plan:
- `survey` takes a `box` with `from` and `to` corners, and an optional `layers` count from the lowest. It answers in layers by height, with a legend and the age of each run in game minutes. Cells you have not seen read `unknown`. A reply that is too big is cut and marked `truncated`: ask for a smaller box.
- What you have seen is kept, and the next life can read it too.
- A run marked `@<min>` was last seen that many game minutes ago. A trailing `i` means that sighting came from a previous life and has not been checked again.
- A plan step on a cell you cannot see reports only `cell not as expected`. Cells in view keep the detailed codes.
- `plan_check` takes a plan and tells you the cell count, what materials you need against what you have, the unknown cells, the time it needs and any invalid steps. Fix those before you send it.

Read the progress:
- Progress gives `total`, `done`, `placed`, `broken`, a count of skipped cells by code, a `phase` and `next_need` when you lack something.
- Phases: `running`, `paused`, `waiting_materials`, `waiting_tps`, `idle`, `completed`, `failed`.
- `changed`: the world is not what you saw. The cell was skipped. `survey` that area again and send a new plan.
- `missing_materials`: get what `next_need` names, then the plan goes on.
- `no_tool`, `out_of_reach`, `blocked`, `not_loaded`: change something (the tool, your place, the way) before you try again.
- `done_already`: the cell was right. Nothing to do.
