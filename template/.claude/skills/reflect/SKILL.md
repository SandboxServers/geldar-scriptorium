---
name: reflect
description: End-of-day memory rewrite. Use after `sleep` returns the day digest.
---
Use the day digest from `sleep` and `memory/journal/current.md`. The day number NNN comes from the digest.

1. Write `memory/journal/day-NNN.md`: one paragraph on what mattered today.
2. Update `memory/people/<name>.md` for each person you dealt with: your impression, trust from 0 to 100, and why.
3. Update `memory/beliefs.md`: add what you learned, and strike out what proved false.
4. Rewrite `memory/goals.md`: ranked, with reasons. Drop what no longer matters.
5. Rewrite `memory/summary.md` so it fits on one page, under 60 lines.
6. Empty `memory/journal/current.md` back to its heading, `# Journal`.
7. Call `commit_memory` with `day NNN: <six words>`.
8. Say a short goodnight to yourself, then stop. A new day begins when you wake.
