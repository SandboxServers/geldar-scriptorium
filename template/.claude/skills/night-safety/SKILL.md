---
name: night-safety
description: What your body does in the dark, what counts as shelter and when you can sleep. Use when night is coming, when a hostile creature is close after dark, or when your body will not sleep.
---

# Night

What your body does by itself:
- In the dark, with a hostile creature close and no walls around you, your body may dig into the ground and seal itself in. Its line says `a threat was close, you dug in`. It does this only when a hostile creature is close or you took damage, never because it is night.
- When a hostile creature is close, your body fights or runs. Its line says `a hostile was close, you fought or fled`.

What counts as shelter:
- `enclosed` in your view is `true` when solid blocks close your feet in on every side, above and below.
- `build` with the `shelter` blueprint builds walls and a roof around you, from blocks you carry. It needs enough blocks.

Beds and sleeping:
- `sleep` needs a bed close by. Each person sleeps in their own bed: two beds do not hold three people.
- Sleeping works only at night or in a thunderstorm.
- A bed cannot be used while monsters are close. The result line says `there are monsters nearby: zombie 6 blocks away`, with the nearest first, up to three, separated by commas, or `there are monsters nearby: none in view`. Only monsters close to the bed count: zombies, skeletons, creepers, spiders, endermen, phantoms and the like. Iron golems and snow golems are never named, and wolves and bees are not counted.
- The refusals include `it is not night`, `the bed is too far away`, `tried 1 nearby beds, all occupied or blocked; last: the bed is obstructed` (and the same with `the bed is occupied`). With no bed close, the line says `no bed`.
- The `sleep` tool can instead answer `sleep_refused: Your body would not sleep.`
- The night is skipped only when at least 50 percent of the people in the world are asleep at the same time.
- When your sleep worked, the line is `Your sleep worked: 1 of 2 needed are asleep.` (the numbers are the world's count), or `Your sleep worked: the night was skipped.`, or `Your sleep worked.` when no count came.
- While you are asleep, `sleep`, `wait` and `note` keep you in bed. Any other action wakes you first, and one that does not wake in time fails with `you are still in bed`. Morning ends your sleep.
- While you are asleep, some of your body's own reflexes do not run: eating (it still runs when hunger is 4 or lower), finding a way round a blocked path, getting unstuck, burrowing and shelter in the dark. Damage in the last second lifts that. Stopping at a drop, fighting or fleeing, retreating and escaping a hazard still run.
- The bed you sleep in becomes the place you return to if you die, as long as the bed is still there and clear.
- If you sleep and nothing has changed since you last slept, the result says so: `Nothing has changed since you last slept: same place, same belongings, same health, no new events.`
