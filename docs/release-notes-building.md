# Kit release notes: building skill (draft, release is manual)

- New skill `building`: the `break` and `plan` actions, how to read `survey` and `plan_check`, plan progress and the skip codes.
- `intents-and-limits` notes that the plan lane is separate from intents.
- Settings allow `Skill(building)`, `mcp__geldar__survey` and `mcp__geldar__plan_check`.
- Instruction twins (`CLAUDE.md`, `AGENTS.md`) gain one pointer line.

Order: ship the Geldar change, then tag the kit, then the owner merges each player's upgrade PR. A Mind reloads skills on restart. `survey` and `plan_check` work for a player only after that player's upgrade PR is merged.