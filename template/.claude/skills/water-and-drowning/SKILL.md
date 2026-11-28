---
name: water-and-drowning
description: Breath, the water your body is in and getting out of it. Use when air appears in your snapshot, when status_flags shows underwater or in_water, when hazards lists deep_water, or after "You are drowning".
---

# Water

What your body tells you:
- `air` appears only when your breath is running low. It counts the breath bubbles you have left. When none are left, you start to drown.
- `status_flags` shows `underwater` when your head is under the water, and `in_water` when your body is in water.
- `hazards` lists `deep_water` when deep water is in sight.
- A hurt line that reads `You are drowning` means your breath is gone.

What your body does:
- If you are stuck in water, `goto` and `unstick` try a water exit first: they swim up, then toward a side you can stand on.
- The reflex hazard_escape gets you out of a hazard such as fire, lava or deep water when it can. Its line says `you were in a hazard, you got out`.
