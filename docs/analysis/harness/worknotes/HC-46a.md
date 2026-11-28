# HC-46a worknote

Base: scriptorium/hw0 at 673d756. Done locally, not pushed.

Changes: observe.ts keeps `pos` (x, y, z) on entities and notable blocks when all three are numbers (key omitted otherwise); notable distance is the straight-line distance from the agent's position, null when either is unknown. The header comment line "Not given by the world:" did not name notable distance, so it is unchanged.

Card deviation: the card says every existing test passes unchanged. One does not: "reads position, health, hunger, inventory array, agents, entities and notable blocks" asserted the old output (no pos, notable distance null) and its fixture has coordinates. Its entities and notable expectations were updated to the new values (pos present, distance sqrt(97)); assertion logic is unchanged. observe.test.ts is in may-edit.

Five new tests added in observe.test.ts (names as on the card). Revert-checks:
- notable distance forced to null: "notable distance is the straight-line distance from the agent's position" fails (and the updated existing test). Restored.
- pos dropped from entitiesOf: "entity pos is copied from x, y, z and its distance is the world's" fails (and the updated existing test). Restored.
instinct tests: 94 passed, 1 skipped. lint, typecheck, check:repo pass.

Open question for the orchestrator: SnapshotEntity.type is any lowercase string ("A being in sight"); the contract does not exclude a non-agent player being listed as an entity. Entities are read by type only, with no name, so no player name is handled here.
