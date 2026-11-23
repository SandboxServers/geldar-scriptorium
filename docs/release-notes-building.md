# Kit release notes: rc24 (draft, release is manual)

## New in rc24: building

- New skill `building`: the `break` and `plan` actions, how to read `survey` and `plan_check`, plan progress and the skip codes.
- `intents-and-limits` notes that the plan lane is separate from intents.
- Settings allow `Skill(building)`, `mcp__geldar__survey` and `mcp__geldar__plan_check`.
- Instruction twins (`CLAUDE.md`, `AGENTS.md`) gain one pointer line.
- `survey` and `plan_check` only appear when the shard flag is on. `break` and `plan` are refused while the flag is off.

## Also in rc24: everything from rc23

No Mind runs rc23 yet, so rc24 carries all of it too:

- the ten-program skill,
- the corrective retry,
- context trimming,
- the token meter,
- the instinct, psyche and sheet pieces, which stay off.

## Order

Ship the Geldar change (geldar PR 932) first, then tag the kit, then the owner merges each player's upgrade PR. A Mind reloads skills on restart. `survey` and `plan_check` work for a player only after that player's upgrade PR is merged and the Mind has restarted.
