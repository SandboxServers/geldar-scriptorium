# RESUME: harness campaign

Updated 2026-11-14. Read [README.md](README.md) (ledger, decisions, waves) and [retarget-map.md](retarget-map.md) first.

**State:** planning only. The campaign was created from the owner's ruling of 2026-11-14 (abandon the in-house Mind `animus/`; the player kit is the one Mind, Claude + GPT + local vLLM/Ollama through one loop). Six card files are being written and then cross-checked:

| File | Cards | Status |
|---|---|---|
| `work-packets-kit-a.md` | HC-00 to HC-16 (HW0 ground truth, HW1 local harness) | Writing |
| `work-packets-kit-b.md` | HC-17 to HC-26 (HW2 instinct step, HW3 persona) | Writing |
| `work-packets-kit-c.md` | HC-27 to HC-39 (social model, kit halves of lineage and drift, measurement) | Writing |
| `work-packets-geldar-a.md` | GX-01, GX-02, AN-02 to AN-12 (W1, W2) | Writing |
| `work-packets-geldar-b.md` | AN-24 to AN-28, 44, 39 to 41, 45, 46, 47, 49, 50, 51, 52, 37, 53 (W5, W7 to W9) | Writing |
| `work-packets-geldar-c.md` | AN-54, 42, 55, 57, 58, 43, 59, 60, 33 to 36, GX-03 (W10 to W12) | Writing |

**Next actions**

1. Cross-check the six files: shared names (packages, env vars, message keys, JSON shapes, the field names GX-01 and HC-04 must agree on), duplicate ownership of a file, dependency order against the ledger. Fix the README ledger rows to the real card ids and `Ready` / `BlockedDependency` / `BlockedDecision`.
2. Open a PR with the campaign folder. Ask the owner to rule on D-HC-02 to D-HC-10 and the assumed D-CS answers (README Decisions).
3. Tell the geldar orchestrator (geldar-93) and geldar-registration: the 62-packet original lives only as untracked files in the Codex worktree `C:\Users\Steve\.codex\worktrees\24f7\geldar\docs\analysis\character-sheet\` (not pushed), and the world cards here replace it for the packets that stay in geldar.
4. When the owner accepts: create `scriptorium/hw0`, dispatch HC-00 to HC-04, then HW1 (HC-05 onward) with the `campaign-packet` skill.

**Open decisions** D-HC-02 (engine sharing), D-HC-03 (sheet storage), D-HC-04 (instinct state and audit), D-HC-05 (local API), D-HC-06 (commitments in the kit, BlockedDecision), D-HC-07 (veto scope), D-HC-08 (metering), D-HC-09, D-HC-10; the geldar D-CS-01 to D-CS-18 stay assumed at their recommended answers.

**Not in this campaign:** activating anything for a live player; the Colo or any node; geldar-registration's register service, NATS life registry and skins KV.
