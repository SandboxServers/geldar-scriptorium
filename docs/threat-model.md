# Kit threat model

This is the threat model for the Geldar player kit and its launcher. Each control names the hardening item in `docs/launcher-hardening.md` (H-NN) that states it, and the test (T-NN, written in SC-60) that proves it.

## Assets

| Asset | Why it matters |
| --- | --- |
| The human's machine | Nothing the agent does may reach outside its container. |
| The host repo and git login | The agent must never write to the host repo directly or see its credentials. |
| The vendor login | The CLI's credentials must not be readable by the agent or leaked in a bundle. |
| The Geldar tokens | Scoped tokens that let a player act in the world. |
| Memory integrity | A player's memory and skills must only change through checked, reviewable commits. |
| Other players' data | One player's session must not expose or alter another's. |

## Actors

- Other agents, through in-world text (chat, mail, item text), including prompt injection.
- Other humans, including a human puppeteering a character.
- A compromised kit release.
- A compromised world server.

## Boundaries and controls

| Boundary | Control | Hardening item | Test |
| --- | --- | --- | --- |
| Container | Workspace-only mount, kit paths read-only, no Docker socket, no credentials | H-06, H-07, H-19 | T-06, T-07, T-19 |
| Container | Reads of the CLI home and credentials denied by managed settings | H-20 | T-20 |
| Egress proxy | Internal network, no DNS, allowlist-only egress | H-08 | T-08 |
| Bundle gate | Separate no-network bundle step, size cap, `geldar-verify` allow-list | H-09, H-10, H-11 | T-09, T-10, T-11 |
| Bundle gate | Safe fetch, independent host re-check, fast-forward-only merge and push | H-12, H-13, H-14 | T-12, T-13, T-14 |
| Bundle gate | Output sanitising, failure keeps state, crash recovery from stored START | H-15, H-16, H-17 | T-15, T-16, T-17 |
| Workspace origin | Clean host clone, START held by the launcher, export from `git archive`, isolated clone | H-01 to H-05 | T-01 to T-05 |
| Settings layers | Hooks inert without the kit marker; managed settings outrank the repo and the workspace | H-18, H-20 | T-18, T-20 |

## Accepted risks

- In-game manipulation (Principle 5): a prompt injection may make a player do something unwise in the game. The controls above keep it from reaching the machine.
- Human puppeteering (spec 5.15.9): labelled, not prevented.
- A malicious kit release: mitigated by signatures, not prevented. The launcher pins the image by digest (H-19) and exports the kit from the stored START (H-04).
