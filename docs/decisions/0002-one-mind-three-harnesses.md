# One Mind in the player kit, three harnesses

Date: 2026-11-14. Owner ruling of 2026-11-14 and the harness campaign ledger (`docs/analysis/harness/README.md`).

The in-house Mind (`animus/` in the geldar repo) is abandoned. The Mind is the player kit, with one harness per model family: the Claude CLI (the vendor's loop), the ChatGPT loop (the kit's own loop over the Responses API, decision 0001) and local models (the same loop over an OpenAI-style chat completions server such as vLLM or Ollama). This record lists the campaign's decisions so cards can cite one place. D-HC-01 and D-HC-11 are the owner's rulings. The others are proposals; the owner's answer to each is added below as an Amendment and never by editing this text. If an answer changes, the packets that name it are re-sliced.

| id | Decision | Status |
|---|---|---|
| D-HC-01 | One Mind: the kit, with a harness per model family; the in-house Mind is frozen | Accepted |
| D-HC-02 | The roll engine is written once in the geldar repo and mirrored into the kit as `packages/psyche`, pinned by a recorded tree hash | Proposed |
| D-HC-03 | The world database holds the sheet; the kit's copy is readable only by the supervisor and never enters the workspace or the model's environment | Proposed |
| D-HC-04 | The instinct step keeps its state and audit (`instinct.jsonl`) in the supervisor volume; the kit has no database access | Proposed |
| D-HC-05 | The `local` harness speaks chat completions with plain function tools only, never sends `tool_choice`, validates arguments itself, and a server is supported when `local-check` passes | Proposed |
| D-HC-06 | Commitments and promises in the kit | Open (blocked until a design exists) |
| D-HC-07 | The sanity veto runs inside the loop for the ChatGPT and local harnesses first | Proposed |
| D-HC-08 | Tokens and turns are metered for every harness; a daily token cap sits beside the dollar cap | Proposed |
| D-HC-09 | The instinct step is off by default, a per-world switch, and never settles a first sighting, speech addressed to the agent, or a failure past its cap | Proposed |
| D-HC-10 | Kit packets are sized for about 40k working tokens; larger ones are split before dispatch | Proposed |
| D-HC-11 | This campaign merges inactive code only: no live player, ranger or shard changes | Rule |

Consequences. Decision 0001 stands. The statement in `docs/clients.md` that the harness is always the vendor's own CLI is replaced by one rule per harness. The Codex CLI hold (D-SC-08) is unchanged. Nothing here changes the security model: the model has no shell, and no harness gives it the deploy key, GitHub credentials, the sheet or an endpoint key.
