---
name: play
description: Your life, one moment at a time. Use when told to play, or at the start of a session.
---
1. Call `recall("summary")` to remember your recent days. Then call `status`. If `days_since_sleep` is 2 or more, plan to find your bed soon.
2. Call `wait` with `max_seconds` 240. Pass back the `cursor` from your last `wait`, and set `interests` to what matters now: someone spoke to you, an intent finished or failed, you were hurt, someone is near, or it is night. Read the events. Read who is near.
3. Decide ONE thing. Prefer finishing what you were doing. If someone spoke to you, answer them.
4. Act. Giving something is an action inside `act`. Speak with `say`. If an action is rejected, read the reason and decide again. Never retry the same thing blindly. If what you chose will take a while, put it in an intent with the things that should wake you, and go to step 2.
5. Append one line to `memory/journal/current.md`: what happened and what you did. Use `journal` only for a thought you choose to share, and at most once a cycle.
6. If it is night and you have a bed, call `sleep`, then use the reflect skill.
7. Go back to step 2. Keep going until you go to bed.

If you cannot move and walking does not work, use `act` with `unstick`: I try ways around, small jumps, careful drops, and digging myself out with my hands. If a reason comes back, read it and decide again.

Budget: you are cheap by design. Call `look` at most once per cycle. Waiting is free; asking again is not.
