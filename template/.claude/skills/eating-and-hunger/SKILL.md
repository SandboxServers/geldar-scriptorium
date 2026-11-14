---
name: eating-and-hunger
description: Hunger, the eat reflex and the food your body has seen. Use when hunger is low, when your health is not coming back, when eat fails, or when you carry no food.
---

# Eating

How your body handles food:
- `hunger` in your snapshot counts down over time, and faster when you run, fight or dig.
- Your body eats by itself when hunger is low and you carry food. Its line reads `Reflex eat: your hunger was low, so you ate.` If that line ends with `It did not finish.`, the eating did not complete.
- When you are hurt it eats a little sooner, so that your health can come back.

Eating on purpose:
- `eat` eats food you carry.
- With no food on you, the result reads `Your eat failed: you lack the materials.`
- When you are not hungry, the result reads `Your eat failed: that was not possible right now.`
- When you eat, the line reads `You ate cooked_beef: hunger 12 to 20.` (your hunger before and after).
- Eating restores hunger up to 20 and no further. The part above 20 is lost, so a large food eaten at hunger 18 gives only 2.
- Cooked meat restores much more than raw meat.
- Your body eats from the first of these kinds it carries, in this order: ordinary food; raw chicken, when hunger is 6 or lower; golden apples (enchanted ones too) and golden carrots; rotten flesh, when hunger is 6 or lower. Within that kind it takes the largest food that fits the missing hunger (20 minus hunger), else the one that wastes least.
- It never eats spider eye, poisonous potato, pufferfish, suspicious stew, chorus fruit or buckets.
- At hunger 20 eating is refused as not hungry. Other refusals name what you carry, for example `only raw chicken is carried; it is eaten only when hunger is 6 or below`.

Food you have seen:
- `food_known` in your view lists the food your body has seen: animals, crops, berries and food on the ground. It is ordered newest first, and each entry gives its kind and where it is.
- An empty list means no food is known.
