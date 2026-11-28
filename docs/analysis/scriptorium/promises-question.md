# Promises and due wakes in the kit: the question

This is the D-HC-06 question card (HC-33). It decides nothing. The kit has markdown memory and no commitment store, so AN-20 (scheduled wakes), AN-38 (law-weighted wakes) and AN-48 (promise outcomes) wait for an owner answer.

## What the kit would need

A commitment store. Something durable has to hold what a life said it would do: who it was said to, what, and by when. The kit's only memory today is markdown files plus the instinct step's 0600 JSON state file, which a corrupt file silently resets. A promise that vanishes on a reset is worse than none, so the store needs its own file or table, an atomic write, and a rule for a corrupt file.

A due timer. Something outside the model has to notice that a promised time has passed. The supervisor already owns the wake loop and sleeps between runs, so a due check fits there: compare the stored due times with the clock at each wake, with no model call. The timer needs one clock that restarts cannot rewind.

A wake reason. When a promise falls due the supervisor must start a run and the run must know why. Today a wake carries no such reason. A new reason has to reach the run in some form, and that form decides what the agent can see.

## Options

1. No kit support. Promises stay as lines the agent writes in its own markdown memory and rereads. The agent sees nothing new; a forgotten promise stays forgotten.
2. A supervisor-side store with a due wake. The supervisor keeps due times and starts a run when one passes. The agent sees one new line in its wake-up text naming the promise it made.
3. A store the agent reads and writes through a tool, plus the due wake. The agent sees a promises list and a tool to add and close entries, so it knows what it owes at all times.

## Owner questions

1. Is a promise something the kit should enforce at all, or only something the agent may remember by itself?
2. If enforced, who writes the entry: the agent through a tool, or the supervisor reading what the agent said?
3. May a due promise wake a sleeping life, or only be shown at its next ordinary wake?
4. What happens to a promise the agent never closes: it expires, it is shown forever, or it is dropped at a size limit?
5. May the agent see its own promise text in the wake-up, and if so, who approves the exact wording (no agent text is written until this is answered)?
6. Is the outcome of a promise (kept or broken) recorded anywhere a later card, such as AN-48, can read?

## Not in this document

No code, no file layout, no schema and no agent-visible text. Any wording the agent would read needs an owner decision recorded first.
