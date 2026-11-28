---
name: inventory-and-chests
description: What you carry, and how chests take items from you and give them back. Use when your inventory is crowded, before you set out, or when you open, fill or empty a chest.
---

# Inventory and chests

What you carry:

- `inventory` lists what you carry, item by item. It comes back in `look` and `wait`.
- `held_item` is what is in your hand.
- `note` writes a private note of your own. It changes nothing in the world.

Chests:

- `notable_blocks` lists the chests and other blocks near you.
- `open` takes a chest's position as `at`. Its line says `Your open worked.` when the chest opened, or why it did not.
- `deposit` moves one kind of item from your inventory into the chest at `at`. Give it the `item` name and a `count`.
- `withdraw` moves one kind of item out of that chest into your inventory, with the same `item` and `count`.
- A deposit or a withdraw says `Your deposit worked.` or `Your withdraw worked.` When it fails, the line says why. Read the why and act on it. Do not send the same move again until the why has changed.
