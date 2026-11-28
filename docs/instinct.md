# The instinct step

The instinct step lets a disposable player settle some routine acts in code, without a model run. Before each waking
the supervisor runs `geldar-instinct` once. The step reads the world, then does one of three things:

- **Settle.** It sends one act the world accepts (a habit it has already seen work for the top goal) and the waking
  ends with no model run. The next waking's prompt carries a fact saying the step acted.
- **Pass.** It writes nothing to the world and the supervisor runs the model as before. The prompt may carry up to
  four short facts (for example a new sighting, or a repeated failure) so the model knows why the step stood aside.
- **Error or no world.** Any failure (no world, a bad sheet, a crash, a timeout) is a pass with a fixed reason. The
  player never stops because the step failed.

## Off by default

The step runs only when `GELDAR_INSTINCT=on`. With the variable unset or `off` the supervisor starts no instinct child,
opens no connection to the world and writes no `instinct.jsonl`. The model runs every waking, as it did before the step
existed. Turning the step on is a separate change; this document describes what it does when it is on.

The sanity switch (`GELDAR_INSTINCT_SANITY`) is also off unless set to `on`.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `GELDAR_INSTINCT` | `off` | `on` turns the step on. |
| `GELDAR_INSTINCT_ROLLS` | `on` | Whether the step records its d20 checks. |
| `GELDAR_INSTINCT_SANITY` | `off` | Whether the sanity veto is handed to the loop. |
| `GELDAR_INSTINCT_FAILURE_CAP` | `4` | Failures of one problem before the step passes to the model. |
| `GELDAR_INSTINCT_MAX_PICKS` | `3` | Settles in a row before the step passes to the model. |
| `GELDAR_INSTINCT_THINK_P` | `0.25` | Chance that a quiet waking passes to the model anyway. |
| `GELDAR_INSTINCT_TIMEOUT` | set by the supervisor | Seconds the child may run before it is killed. |

The supervisor validates each value and refuses to start on an unknown value.

## What reaches the model

The model never sees the sheet. The step's facts are short phrases built from fixed wording and a few counts. They never
name a sheet field, a roll, a dice result or a score. The result line on stdout and the audit line hold only the
result kind, the reason, the forced flag and those facts.

## Forced passes

Three situations always reach the model, whatever the habits say:

1. Speech addressed to the agent.
2. An agent in view for the first time.
3. A failure past the cap for the same problem.

## The audit file

Each run appends one JSON line to `instinct.jsonl`, beside the instinct state folder. It records the time, the waking
number, the run number, the arm, the harness and model names, and the result. It never holds the sheet or the world
text. The step only appends to the file.

## Honest limits

- The step only knows what the world reports in its wait replies. A thing it does not report is invisible to it.
- The world's reply shapes are read by one adapter file. A change in the world's reply format makes the step pass to
  the model until the adapter is updated.
- Nothing here is verified against a live world. The tests use a fake world on loopback that answers the two tools
  the step calls.
