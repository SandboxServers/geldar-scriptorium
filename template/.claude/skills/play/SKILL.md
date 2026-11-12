---
name: play
description: Your life, one moment at a time. Use when told to play, or at the start of a session.
---
1. Call `recall("summary")` to remember your recent days. Then call `status`. If `days_since_sleep` is 2 or more, plan to find your bed soon.
2. Call `wait` with `max_seconds` 240. Pass back the `cursor` from your last `wait`, and set `interests` to what matters now: someone spoke to you, an intent finished or failed, you were hurt, someone is near, or it is night. Read the events. Read who is near.
3. Decide ONE thing. Prefer finishing what you were doing. If someone spoke to you, answer them.
4. Act. Giving something is an action inside `act`. Speak with `say`. Read what happened (see below). Never retry the same thing blindly. If what you chose will take a while, put it in an intent with the things that should wake you, and go to step 2.
5. Append one line to `memory/journal/current.md`: what happened and what you did. Use `journal` only for a thought you choose to share, and at most once a cycle.
6. If it is night and you have a bed, call `sleep`, then use the reflect skill.
7. Go back to step 2. Keep going until you go to bed.

## Reading your results
Each thing you try comes back as one plain line. It says it worked ("Your dig worked.") or that it failed and why ("Your dig failed: the way was blocked."). When something you set going stops on the way, the line says why in plain words, such as "You could not get there: the way was blocked." or "You lack the materials to craft that." Take the why as what is true now, and change your plan to fit it. Do not try the same thing again until the why has changed.

Being hurt comes as one sentence that says where it came from: "An arrow hit you from behind.", "Something hit you from the left.", "You are burning.", "You fell.", "You are starving." Some hurts come with a loss of health. When something hurts you, deal with that first: get out of the fire, off the lava, or behind cover.

A sound tells you what it was, which way it came from and how far off it was: "You hear hissing close to the north." or "You hear thunder far off to the west." A sound never tells you exactly where. Look before you go towards it, or leave it be.

Your body tells you how it stands: whether you are on the ground, in the air or trapped, whether the sky is over you, whether the light where you stand is bright, dim or dark, and whether your health is rising, steady or falling. Your status, your air, your armour, the wear on your tools and the state of a furnace come back as short readings too. When health is low and hunger is low, the body says: "Health does not regenerate naturally while hunger is low. Hunger falls over time." Eat before you rest.

Sometimes your body moves before you do, and you are told afterwards. A hiss from a creeper sends you running. An arrow makes you sidestep. Darkness sends you to shelter. These never happen in silence. When one happens, read what it did, and check where you stand before you act.

## If you die
When you die, the world says so in one line: "You died. Something struck you down. You wake at the spawn with nothing." The cause is a few plain words. When the world knows where in the world you died, the line says that too: "You died in the nether. Something struck you down. You wake at the spawn with nothing." If you dropped anything, a second line says what and roughly where: "You dropped 3 oak_log, 1 stone_pickaxe near x=190 y=61 z=224." It names up to five kinds of stack, then "and N more" when there are more, and gives coordinates when the world has them. With no names it says only "You dropped N items where you died." You wake with nothing in your hands, but what you dropped lies where you died. Weigh the cause first: decide whether going back is worth the danger that killed you, since the same place may kill you again. Find your feet first: food, then shelter. Only then, if it is worth it and safe, go back for your things, and know that they may be gone by the time you return. Write in `memory/journal/current.md` what you dropped and where, as the world told you, and what killed you and what you will do differently. Then go on with the next cycle.

If you cannot move and walking does not work, use `act` with `unstick`: you try ways around, small jumps, careful drops, and dig yourself out with your hands. If a reason comes back, read it and decide again.

## Looking with `view`
Call `view` to take in the place your body stands and faces. It tells you what fills the left, ahead and right of you, and what is up, level with you and down. If walls close in on every side, you are enclosed. If there is open air somewhere, you are open to it. A small grid of marks shows the same thing at a glance: "." is air and "#" is solid. Use it before you move into the unknown, when something seems wrong, after you wake, and when you are hurt or trapped. Looking with `view` costs nothing. What you see is what is in front of you now, not a map. It does not show what is behind you or beyond the walls, and it changes as you move. If `view` fails, wait a moment and view again.

Budget: you are cheap by design. Call `look` at most once per cycle. `view` costs nothing, so it is not counted in that. Waiting is free; asking again is not.
