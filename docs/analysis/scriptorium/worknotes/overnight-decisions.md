# Overnight run: decisions made without the owner

Owner instruction (2026-11-09): work autonomously overnight; note each decision and the answer chosen; do not compromise quality or security; at the end of the campaign write a full campaign retro.

Rules I hold myself to: no weakening of a security control to make a test pass; no guess on an owner decision that changes who can do what (those stay marked and wait); nothing merged in another repo (geldar) without its owner; spend limits and secrets stay the owner's.

| # | When | Decision | Answer chosen | Why |
|---|---|---|---|---|
| 1 | 2026-11-09 | License for D-SC-05 ("an open license") | Apache-2.0 at the repo root | Open, with a patent grant. Owner may swap. |
| 2 | 2026-11-09 | Who builds Wave 3 in the geldar repo | The Scriptorium orchestrator's subagents, on their own branch and PR off geldar `main`. The geldar orchestrator (Phase 0) said it will not start it without its own user and edits only docs/state files. PRs stay open for the owner; nothing is merged in geldar | The owner asked for Wave 3 to proceed; the geldar orchestrator suggested a separate branch and PR. Merging into another repo's `main` is the owner's call |
