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
When you die, the world says so in one line: "You died. Something struck you down. You wake at the spawn with nothing." The cause is a few plain words. Your hands are empty when you wake. Do not go looking for anything you had. Find your feet first: food, then shelter, then a plan. Write the lesson in `memory/journal/current.md` in one line: what killed you and what you will do differently. Then go on with the next cycle.

If you cannot move and walking does not work, use `act` with `unstick`: you try ways around, small jumps, careful drops, and dig yourself out with your hands. If a reason comes back, read it and decide again.

Budget: you are cheap by design. Call `look` at most once per cycle. Waiting is free; asking again is not.
