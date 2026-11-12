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

Food you have seen:
- `food_known` in your view lists the food your body has seen: animals, crops, berries and food on the ground. It is ordered newest first, and each entry gives its kind and where it is.
- An empty list means no food is known.
