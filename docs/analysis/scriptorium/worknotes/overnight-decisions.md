# Overnight run: decisions made without the owner

Owner instruction (2026-11-09): work autonomously overnight; note each decision and the answer chosen; do not compromise quality or security; at the end of the campaign write a full campaign retro.

Rules I hold myself to: no weakening of a security control to make a test pass; no guess on an owner decision that changes who can do what (those stay marked and wait); nothing merged in another repo (geldar) without its owner; spend limits and secrets stay the owner's.

| # | When | Decision | Answer chosen | Why |
|---|---|---|---|---|
| 1 | 2026-11-09 | License for D-SC-05 ("an open license") | Apache-2.0 at the repo root | Open, with a patent grant. Owner may swap. |
| 2 | 2026-11-09 | Who builds Wave 3 in the geldar repo | **Superseded:** the geldar orchestrator's owner told it to build SC-30 to SC-33 itself (integration branch `scriptorium/wave3` off geldar `main`, one coder per card, its own review loop, one PR). This session writes and spec-reviews the packets and hands over the path; it writes no code in geldar | The two owner instructions now agree; avoids two sessions editing one repo |
| 3 | 2026-11-09 | Codex (D-SC-08): ship now or gate | **Gate.** Build the kit CLI-neutral (a reserved `--cli` option; Claude Code only in v1). Codex support (SC-71) does not ship until owner calls C1 (OpenAI terms for subscription use on public player repos) and C3 (credential exposure: the model can likely read `auth.json` if Codex's sandbox does not run in the container) are answered. Never claim parity until `deny_read` is proven by a local live check | Security first: Codex has no tool-level shell deny, and the research could not verify the terms (HTTP 403) or that path denies hold outside the OS sandbox. Details: worknotes/codex-parity.md |
| 4 | 2026-11-09 | Recording of Codex parity | Parity table and recommendation committed as worknotes/codex-parity.md; the ledger row D-SC-08 now says "gated on C1 and C3" | The owner said parity where possible; this is the honest scope |
