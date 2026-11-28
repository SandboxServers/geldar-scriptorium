# HC-46b worknote

Base: main at f4415fe. Done locally, not pushed.

Changes: observe.ts `agents` entries gain an optional `pos` (x, y, z) from the same `posOf` that HC-46a uses; the key is omitted unless all three are finite. Existing `{name, distance}` output is unchanged. The agent's id is never copied.

New module social/roster.ts: `readRoster(stateDir)` reads `<stateDir>/roster.json` into a Map of name to life id. A missing, unreadable, non-regular or over-16-KiB file, or a JSON value that is not one object, gives an empty map. An entry is kept only when the name is 1 to 40 characters with no control characters and the id passes `SAFE_ID` (the existing check in social/store.ts, reused). It never throws. Only the HC-30a adapter is meant to call it; the map is not passed into any observation.

Tests: five new observe tests (names as on the card) and seven roster tests, including the card's roster test name. The `surroundingsReply` test helper takes an optional `agents` argument (default `[]`), so existing calls are unchanged.

Checks: vitest on observe.test.ts and social/roster.test.ts, 32 passed; biome ci on the four files, clean; instinct tsc clean; check:repo ok. Vitest ran through a scratch config rooted at packages/instinct, not the root config.
