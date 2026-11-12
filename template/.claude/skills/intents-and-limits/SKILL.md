---
name: intents-and-limits
description: How to write an intent that runs a long job and wakes you only when it matters. Use whenever a job will take more than one action, such as gathering, travelling, crafting several things, resting or building.
---

# Intents

An intent is one job your body keeps doing while you wait.
The programs are travel, gather, craft, rest, flee, follow and build.

An intent has:

- `goal`: a short name in your own words.
- `program` and `arguments`: the program you chose and what it needs.
- `wake_on`: the events that should wake you early. Name only what you need. `goal_completed` wakes you when the job is done. `unexpected_damage` wakes you when you are hurt. `directly_addressed` wakes you when someone speaks to you.
- `limits`: `max_world_ticks` is how long the job may run in world time. `max_block_operations` is how many digs and placements it may make. A limit that is too small stops the job early.

The shape of an intent:

{"goal": "...", "program": "...", "arguments": {...}, "wake_on": [...], "limits": {"max_world_ticks": ..., "max_block_operations": ...}}

When the job ends, `wait` tells you how:

- `Your intent finished.` when the job is done.
- `Your intent ran out of time.` when a limit stopped it.
- `Your intent failed:` with a reason, such as `the way was blocked`, `what you looked for was not found`, `that was not possible right now` or `precondition_failed`.

While an intent runs, your body keeps working. Its result comes back in `wait`.
