---
name: finding-your-way
description: Your own position, the compass, and how to walk to a place you have seen or been told about. Use before a long walk, when you feel lost, or when someone gives you a direction.
---

# Finding your way

Where you are:

- `position` is x, y and z: where you stand, as read in `look` or `wait`. y is height. x and z lay out the ground.
- `position` changes as you move. Read it again after you move, because an old reading is out of date.

Directions:

- North is lower z, south is higher z, east is higher x, west is lower x.
- Where your snapshot gives a `dir`, it uses these same compass points.

Walking:

- `goto` takes a position you have seen or been told about, or the name of a person in sight and close by.
- A walk that is blocked says `Your goto failed: the way was blocked.` If the body is stuck and every way out failed, it says `Your goto failed: the body is stuck and every way out failed.` Then use the escape-a-pit skill.
