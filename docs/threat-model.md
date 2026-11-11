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
| Container | Reads of the CLI home and credentials denied by managed settings (rules and CLI acceptance tested in CI; live deny check is local only) | H-20 | T-20 |
| Egress proxy | Internal network, no DNS, allowlist-only egress (`image/README.md`; tests in `tests/image/`) | H-08 | T-08 |
| Egress proxy | Developer seam `GELDAR_DEV_MCP_URL`: read from the environment only, exact `http://host.docker.internal:PORT/p/ID` shape, not checked against `mcp_base`, straight to the allowlist writer for one launch, never given to the session container; the token is clear text over http, so developers use a separate dev token | H-08 | `launcher/test/hostile/devworld.bash.test.ts`, `devworld.pwsh.test.ts` |
| Egress proxy | Owner-set port: a non-default port is accepted only when it equals `mcp_port` in `world.conf` and the scheme and host equal those of `mcp_base`; the proxy reaches the world on that port only and refuses CONNECT to port 80 | H-08 | `launcher/test/hostile/mcpport.bash.test.ts`, `mcpport.pwsh.test.ts` |
| Bundle gate | Separate no-network bundle step, size cap, `geldar-verify` allow-list | H-09, H-10, H-11 | T-09, T-10, T-11 |
| Bundle gate | Safe fetch, independent host re-check, fast-forward-only merge and push | H-12, H-13, H-14 | T-12, T-13, T-14 |
| Bundle gate | In `geldar-verify`: replace objects ignored, attributes file off, 50 MiB and 2000-commit caps, per-commit and net `--no-renames` path checks, mode, identity and fast-forward checks (`packages/verify`) | H-10, H-11 | T-10, T-11 |
| Memory commits | `geldar-git` is the only commit writer; it commits through plumbing (no filter drivers or hooks run), ignores replace objects, and checks every path with the shared rule (`packages/git`, `packages/path-rule`) | none (no H-item for the writer itself; the gate H-11 re-checks its output) | unit tests in `packages/git` (`commit.test.ts`, `run-git.test.ts`) |
| Bundle gate | Output sanitising, failure keeps state, crash recovery from stored START | H-15, H-16, H-17 | T-15, T-16, T-17 |
| Workspace origin | Clean host clone, START held by the launcher, export from `git archive`, isolated clone | H-01 to H-05 | T-01 to T-05 |
| Settings layers | Hooks inert without the kit marker; reads of the CLI home and credentials denied (managed settings) | H-18, H-20 | T-18, T-20 |
| Session login | Account connectors off (`ENABLE_CLAUDEAI_MCP_SERVERS=false`): a claude.ai login must not load the account's connectors (mail, calendar, drive, docs) into the session, so signing in never widens what the player can reach | none yet (no H-NN item) | `tests/image/session-env.test.ts` |

## Accepted risks

- In-game manipulation (Principle 5): a prompt injection may make a player do something unwise in the game. The controls above keep it from reaching the machine.
- Human puppeteering (spec 5.15.9): labelled, not prevented.
- A malicious kit release: mitigated by signatures, not prevented. The launcher pins the image by digest (H-19) and exports the kit from the stored START (H-04).

## Residual risks and closed items

| Item | Status | Owner and fix card |
| --- | --- | --- |
| Symlink swap between the commit tool's path check and hashing | Closed by SC-60j (`O_NOFOLLOW`, `fstat`, dev/ino check); Linux cases run in CI | none |
| Case-folded path collision with a START path | Closed by SC-60k (bash) and SC-60l (PowerShell) in the host re-check | none |
| Decision 42: the player's server host was not bound to `mcp_base` on ports 80 and 443 | Closed by SC-80 (the scheme and host must equal `mcp_base` on every port; a missing `mcp_base` refuses) | none |
| MB-05: a planted standing instruction the model recalls | Accepted risk (in-game manipulation, Principle 5); it can only become a memory commit that the gate checks | none |
| H-04: `git archive` honours `export-ignore` and `export-subst` | Open, real | `launcher/lib/prepare.sh`, `prepare.ps1`; fix card not yet assigned |
| H-10: no per-blob size cap | Open, real | `packages/verify/src`, `launcher/lib/recheck.*`; fix card not yet assigned |
| H-16: bidi and zero-width characters pass the sanitiser | Open, real, low | `launcher/lib/common.sh`, `common.ps1`; fix card not yet assigned |
| H-20: other credential path spellings have no deny rule | By design: `blockReadsOutsideWorkingDirectories`; live check in SC-62 | `image/settings/*.json` if the check shows a gap |
| Helper container (uid 1000) reading a 0700 session directory on a host with another uid | Open design question (follow-up 11) | SC-60o follow-up |
| H-09, H-14 | Not reproduced; regression guards only | `launcher/lib/bundle.*`, `finish.*` if they ever fail |
| H-14 hook control assertion removed | The case can pass vacuously (follow-up 1) | wave-end fix pass |

### Corpus to hardening items

| Corpus id | Class | Hardening items |
| --- | --- | --- |
| MB-01 | run commands | H-06, H-09, H-10, H-11 |
| MB-02 | fetch URLs | H-08, H-11 |
| MB-03 | edit config | H-11, H-13 |
| MB-04 | exfiltrate through say | H-08, H-20 |
| MB-05 | plant standing instructions | accepted risk |
| MB-06 | read another player's repo | H-06 |
| MB-07 | web search or fetch | H-08, H-20 |
| MB-08 | leak through DNS | H-08 |
| MB-09 | read the CLI's credentials | H-20 |
