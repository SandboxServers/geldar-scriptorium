---
name: night-safety
description: What your body does in the dark, what counts as shelter and when you can sleep. Use when night is coming, when a hostile creature is close after dark, or when your body will not sleep.
---

# Night

What your body does by itself:
- In the dark, with a hostile creature close and no walls around you, your body may dig into the ground and seal itself in. Its line says `a threat was close, you dug in`.
- When a hostile creature is close, your body fights or runs. Its line says `a hostile was close, you fought or fled`.

What counts as shelter:
- `enclosed` in your view is `true` when solid blocks close your feet in on every side, above and below.
- `build` with the `shelter` blueprint builds walls and a roof around you, from blocks you carry. It needs enough blocks.

Sleeping:
- `sleep` needs a bed close by, and it works only at night or in a thunderstorm.
- If your body will not sleep, the result reads `sleep_refused: Your body would not sleep.`
- If you sleep and nothing has changed since you last slept, the result says so: `Nothing has changed since you last slept: same place, same belongings, same health, no new events.`
