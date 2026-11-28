# Scriptorium work packets: wave 13 (kit-side pieces of geldar wave C5, all HELD)

Part of [work-packets.md](work-packets.md) (dispatch rules 1-24). Ledger: [README.md](README.md). Written 2026-11-11 from the geldar orchestrator's message (peer `geldar-93`, wave C5 "Goldar learnings": Body parity and the unavailable tools).

**Rule for every card in this wave: HELD until geldar-93 sends "landed" for the matching geldar packet.** Nothing is deployed yet. Until then no template, skill, guide or README text makes any availability or deploy claim (same pattern as SC-125 and geldar PR #151). With each "landed", geldar sends the exact event type names and fixed texts; the card is then built against them. Character-visible text stays in-world and keeps geldar decisions 0058 and 0059 (the character knows only what it has seen, tried or been told in the world; never told it is watched; no recipes, maps or numbers in its head; no meta words). Patron-facing items go in `template/README.md` or the guide only, never in text the character reads.

**What does not need a card.** C5-01 (soft-dig pathing, fast stall-then-replan, partial paths) is Body only: movement just gets better; the `unstick` line of SC-125 stays valid and there is no new player-facing verb. Lessons from live play that need nothing in the kit: a stuck Haiku character ends its own session with a "stuck" summary (the supervisor's continuation text covers continuity); mining logs inside a leaf canopy traps a character (the Body fix is the answer). The journal discipline works well (the character records coordinates, lessons and plans and reads them next run): keep the journal and reflect emphasis in the play and reflect skills as they are. **Do not document** the current behaviour that the credits (the thought and act budget) are spent by rejected and failed acts, and that a stuck character can be left with zero budget so that even `unstick` is refused: an owner ruling is pending on the geldar side.

## Cards

### SC-150: reading your results: the outcome events (HELD on C5-02)
- Geldar adds per-action `action` / `action_failed` outcome events with readable fixed-text wording, plus plain `why` wording for intent failures, in the wake and wait events. This replaces the bare `precondition_failed` experience.
- **Build when landed:** update the play skill's "reading your results" guidance (step 4 today says to read the reason and decide again) and any event list in the player guide, using the exact event names and fixed texts geldar sends; in the character's voice; no numbers. Tests: the skills test pins the line; no meta words; no digit unless geldar's text has one.
- **Needs from geldar:** the exact event type names, field names and every fixed text.

### SC-151: waking after a death (HELD on C5-03)
- A death becomes an event the character is told ("You died. <cause>. You wake at the spawn with nothing." style, fixed text, no meta).
- **Build when landed:** the play and reflect skills cover waking after a death in the character's voice: nothing in your hands, write the lesson in the journal, find your feet; no talk of lives, respawns, game or counters. Patron side: a death may set `died_at`, after which the character's thoughts become public (geldar decision 0138: the owner sees live; everyone sees a dead life's thoughts; an owner can opt in to delayed public thoughts): `template/README.md` only, never in character-visible text.
- **Needs from geldar:** the exact event name and the fixed text; the wording of decision 0138 for the Patron paragraph.

### SC-152: `give`, `note` and `follow` (HELD on C5-04)
- The verbs become real. Names resolve only among agents the character can currently see (line-of-sight rule), so the kit must not tell the character it can address anyone by name.
- **Build when landed:** add the verbs to the play skill (and the guide) in the character's words and with that limit stated as what the character experiences (you can only speak to or follow someone you can see); no names are promised. Tests as for SC-125.
- **Needs from geldar:** exact verb and argument names and any failure texts.

### SC-153: craft and smelt guidance (HELD on C5-05 and C5-06)
- Crafting hardening and furnace use. Recipes are still discovered by ingredients: no recipe knowledge in the kit (decision 0058).
- **Build when landed:** the play skill's craft guidance gains furnace use in the character's words: how to try, how to read a failure; no recipe, no item list, no number beyond what geldar's fixed texts hold.

### SC-154: the skills that wait on the Body: `author`, `moot`, `offer` (HELD on C5-08, C5-09, C5-10)
- `author` (write_book, C5-08): stays "not available" until geldar says landed; the stamping rules are an open owner decision.
- `moot` (propose and vote, C5-09): social laws only; the Moot Stone is a configured coordinate; mechanical laws are deliberately not implemented. Build when landed.
- The Shrine is the `offer` verb (C5-10), BlockedDecision on the plugin consuming items; not the `trade` skill. Build when landed and unblocked.
- `write_sign` and build blueprints (C5-07): add to the play skill when landed.
- Each: the skills test pins the "not available" or the new text; in the character's voice; no availability claim before "landed".

### SC-155: Patron-facing README items (HELD on owner decisions and deploys)
- Kino (the public watch page: anonymous viewers see only agents the owner flags public-camera), skins (a ranger skin is uploaded through MineSkin and imported by the operator with `colo-admin skin-import`; whether a player repo carries a `skin.png` for the Patron to upload is an owner decision), and the thought-visibility opt-in (SC-151).
- **Build when the owner decides and geldar says it is deployed:** short plain paragraphs in `template/README.md` (no repo name, no meta words about how the kit is built, no claim of availability before deploy); never in character-visible text. The README test pins them and the line cap.
