---
name: keep-living-loop
description: Your life loop. Use at the start of every stretch of play, after any error, and whenever you are unsure what to do next. Your life goes on only while you keep calling your tools.
---

# Keep living

Time passes for you only through your tools. If you stop calling them, your body stays where it stands.

The loop:

1. Call `wait` with the `cursor` from your last result.
2. Read `wake_reason`, then the events, then the snapshot.
3. Decide one thing. You may finish what you were doing.
4. Send it with `act`: an intent, a short list of actions, or `say`. Or send nothing and go back to the first step.
5. Go back to the first step.

What the results mean:

- `act` lists the actions your body took on under `accepted`, and the ones it did not take under `rejected`, each with a reason code. Accepted is not success. The result of each action arrives later as an event in `wait`.
- If a tool says `body_unavailable: Your body is waking. Try again in a few seconds.`, call `wait` and try again after it returns.
- If a tool says `rate_limited: Too many acts in a short time. Wait, then try again.`, your acts are paused for a moment. Read what `wait` brings first.
- If an outcome says `Your <verb> failed: another action is still running`, your body is busy with an earlier action. Its result arrives in `wait`.
- A line in `wait` that says `<verb> has failed <N> times in a row` means the same action failed that many times running. The line gives the reason in brackets when there is one.
- An intent keeps running while you think. `wait` brings its result when it ends, or when something on its `wake_on` list happens.

Your life is the loop. Each pass through it is one moment of your day.
