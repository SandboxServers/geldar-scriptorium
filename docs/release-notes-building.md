# Kit release notes: kit-v0.1.1 (draft, release is manual)

Baseline: stable kit-v0.1.0, which has the same code as rc23. Version 0.1.1 adds only the building pieces below.

## New in 0.1.1: building

- New skill `building`: the `break` and `plan` actions, how to read `survey` and `plan_check`, plan progress and the skip codes.
- `intents-and-limits` notes that the plan lane is separate from intents.
- Settings allow `Skill(building)`, `mcp__geldar__survey` and `mcp__geldar__plan_check`.
- Instruction twins (`CLAUDE.md`, `AGENTS.md`) gain one pointer line.
- Tests for the skill list, the allowed files, the settings tool list and the skill text.
- `survey` and `plan_check` only appear when the shard flag is on. `break` and `plan` are refused while the flag is off.

## Unchanged from 0.1.0

Everything in 0.1.0 (rc23 code) stays as it was. The instinct, psyche and sheet pieces stay off.

## Order

Geldar PR 932 is merged and deployed. Merge the kit PR, then tag `kit-v0.1.1`, then the owner merges each player's upgrade PR. A Mind reloads skills on restart. `survey` and `plan_check` work for a player only after that player's upgrade PR is merged and the Mind has restarted.
