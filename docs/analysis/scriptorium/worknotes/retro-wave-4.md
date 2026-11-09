# Retro: wave 4 (the kit image)

Written 2026-11-08, at the close of wave 4. All six packets are merged to `scriptorium/wave4`; the wave review and PR follow. Previous retro: [retro-waves-0-2.md](retro-waves-0-2.md). Token figures are the agent usage the orchestrator recorded per session; only SC-40b's coder report and the spec, review and fix reports are kept in `.claude/reports/scriptorium/`, so the other figures cannot be re-derived from the repo.

## Packets

| Packet | Model | Tokens | Notes |
|---|---|---|---|
| SC-40a | Haiku | 71k | One session |
| SC-40b | Sonnet | 55k | One session |
| SC-41a | Haiku | 69k | Stopped before commit on load-induced test timeouts; the orchestrator committed (`22aa3cb`) |
| SC-41b | Sonnet | 75k | One session |
| SC-42a | Haiku | 94k | Hit the context cap before check and commit; the orchestrator committed (`7792000`) |
| SC-42b | Haiku 87k, then Sonnet 70k | 157k | Continuation by Sonnet |

Spec writing: the writer used 128k tokens, then three spec-review passes and three fix passes ran before any coder started (`wave4-spec-review-1..3.md`, `wave4-fix-1..3.md`).

## What went well

- **Spec review paid off again.** The three passes caught theatre tests (capability checks that cannot fail; an internal-network revert that did not fail its test), a git-status assertion that was vacuous on the CI uid, missing Vitest timeouts, a Squid file-permission problem reproduced on Linux, and a stub CLI that assumed no network. All were fixed before a coder ran.
- **The pinned CLI is tested for real** (`tests/image/cli.test.ts`), including a case where an empty managed file lifts the denies so the deny case is not vacuous.
- **D-SC-01 settled** (no API key in CI; live checks are local only), so the docs say plainly what CI does not prove.
- **Owner direction absorbed.** The owner asked about deterministic driving; the Wave 3 cards were aligned to the spec's intent model. A token-ring / attention-scheduler idea is parked in [idea-attention-scheduler.md](idea-attention-scheduler.md).

## What cost time or tokens

| Finding | Evidence | Cost |
|---|---|---|
| The default 5 s Vitest timeout flaked the wave-2 git tests under parallel Docker load | `db5f5c9` raised the default to 30 s | SC-41a stopped before commit |
| Parallel `docker build` of one tag raced ("already exists") | `wave4-buildrace-fix.md`; fixed by `tests/image/global-setup.ts` building once (`47cf9ab`) | One fix pass |
| Concurrent packets shared one image tag | Same report | Cross-packet interference; now isolated by `KIT_IMAGE` |
| A `check` run inside a `.claude/worktrees` path passed, yet the wave branch then failed lint and typecheck | SC-42a: `03ad3e9` "Fix SC-42a lint and type errors found on the wave branch" | A worktree check is not a reliable gate; an extra fix commit |
| A private IP literal in a test | `acf4ff8` switched to a documentation address | Breaks the no-private-IP repo rule; caught and fixed |
| The pinned CLI's wording differed from the packet (case 1), and case 2 was a theatre test | `d79e2d1` "correct case 2 text and revert" | Corrected after the first version |
| Haiku hit the context cap again | SC-42a at 94k; SC-42b needed a Sonnet continuation | Orchestrator commit; a continuation session |

## What the reviews caught that the packets missed

Theatre tests and vacuous assertions (above), a Squid file-permission problem visible only on Linux, and a test that assumed no network where the stub CLI needed one.

## What we would slice differently

- Image packets with a matrix of CLI-behavior cases (SC-42b) go to Sonnet from the start.
- Docker-touching packets get an isolated image tag in the brief, not as a fix afterwards.
- Check the pinned CLI's real output wording while writing the packet, so expected strings are not guessed.

## Process changes shipped with this retro

| Change | Answers |
|---|---|
| Dispatch rule 16 (and the skill): a packet is green only when `check` passes on the wave branch after the merge | SC-42a lint and type failures |
| Dispatch rule 17 (and the skill): Docker packets use `KIT_IMAGE=geldar-kit:<packet>`; the image is built once per vitest run by the global setup | Build race, shared tag |
| `tests/image/global-setup.ts` and 30 s default timeouts (merged during the wave) | Build race, flaky timeouts |
| `image/README.md` and the H-08 and H-20 rows in the hardening and threat docs | Docs pass |

## Proposed next

Carried from the wave 0-2 retro and extended. None is built.

| Item | Owner | Status |
|---|---|---|
| Merge-packet helper in `scriptorium.ps1`: merge `--no-ff`, run `check` on the wave branch, refuse to continue on failure (turns rule 16 into a guard) | orchestrator | proposed |
| Ledger helper (`ledger set SC-NN <status>`) that edits only the matching row | orchestrator | proposed |
| Spec lint (`check:specs`): control characters, literal line breaks in code spans, dangling `SC-NN` references | orchestrator | proposed |
| Shared git runner for `geldar-git` and `geldar-verify` (they drifted) | follow-up packet | proposed |
| Fixture helper putting `--no-replace-objects` and `core.hooksPath` first on every fixture git call | follow-up packet | proposed |
| Investigate why `check` inside `.claude/worktrees/<packet>` passed while the wave branch failed | orchestrator | proposed |

## State for the next wave

Wave 3 (the mock world, repo G) has not started: geldar PR #3 (decisions 0007 to 0016) is still open and `contract/` on geldar `main` lacks the `mcp-*` schemas. Open owner decisions: D-SC-05, D-SC-06, D-SC-08.
