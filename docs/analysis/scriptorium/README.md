# Scriptorium: campaign ledger

**Goal:** a kit release that takes a person from nothing to a living sovereign player. They install the launcher, run `geldar-play new`, `setup` and `play`, and their character lives, reflects and commits its memory against a world server, with nothing in the world able to reach their machine. Spec section 5.15, as changed by geldar decisions 0007–0015.

**What ships (one kit release, decision 0014):**

| Output | Where it comes from | Where it goes |
|---|---|---|
| The template: player-facing files only | `template/` in this repo | published to `SandboxServers/geldar-player-template` |
| The kit image: companion servers, verifier, egress proxy, pinned vendor CLI | `packages/`, `image/` | GHCR, pinned by digest in each `player.json` |
| The launcher `geldar-play` (bash and PowerShell) | `launcher/` | signed assets on this repo's GitHub releases |
| The mock world, a stand-in for the Geldar MCP server | `threshold/mcp-mock/` in the **geldar** repo (0008) | GHCR, used by CI and by people trying the kit |

**End state (owner, 2026-11-08):** a mock world that speaks the real contract, with OAuth stubbed by a per-player bearer token. Pointing a player at the real Threshold MCP server later is a change to `player.json` and the allowlist, not to the kit.

**Exit (system acceptance):**

1. On a clean Windows machine and a clean Linux machine with only the prerequisites (D-SC-09), a person following only the template README:
   - installs and verifies the launcher;
   - runs `geldar-play new`, `setup` and `play`;
   - ends with a player repo on GitHub that has a birth commit and **three reflect/commit cycles**, played against the mock world.
2. Every item in `docs/launcher-hardening.md` has a passing hostile test, and the host repo is unchanged after each hostile run.
3. The malicious-book CI is green for the pinned Claude Code (spec 8.4b, Phase 2 gate 2), including the 0013 cases (another player's repo, web search, DNS, credential files).
4. A tagged release publishes all three outputs with signatures and an SBOM. The template repo's commit names the image digest and launcher version it expects.
5. `geldar-play upgrade` moves an existing player to the new release through a PR the owner merges.
6. Measured and written in the README: turns and `/usage` per in-game day on Haiku-low, over three in-game days against the mock world (spec 5.15.7).

Packets: [work-packets.md](work-packets.md). Resume card: [RESUME.md](RESUME.md). Process: the [campaign-packet skill](../../../.claude/skills/campaign-packet/SKILL.md) (from SC-03; until then the geldar repo's copy).

## Decisions

Spec-level decisions are records in the **geldar** repo (`docs/decisions/`). This table also holds campaign-level choices that don't change the spec.

| ID | Decision | Status | Needed by | Record |
|---|---|---|---|---|
| D-SC-01 | Model access for the live malicious-book check: no API key in CI (owner, 2026-11-08: no API credits on CI runs). The live check is local only, run by the owner with a subscription login; CI never calls a model (spec 5.15.1). | **Accepted (local only)** | SC-62 | — |
| D-SC-02 | Credential the release job uses to publish `template/` to `geldar-player-template`: the GitHub App `geldar-bot`, installed on that repo only (contents write, metadata read); its key and app ID are Key Vault secrets read through Azure OIDC | Accepted (owner, 2026-11-08) | SC-63 | geldar-infra `docs/release-identity.md` |
| D-SC-03 | Container runtime for v1: Docker Desktop (Windows, macOS) and Docker Engine (Linux). Podman later. | Proposed (orchestrator) | SC-40b | — |
| D-SC-04 | Egress proxy: Squid, pinned by digest, with a hostname allowlist and `http_access deny all`. The session container sits on an internal network with no DNS; Squid resolves names. | Proposed (orchestrator) | SC-41a, SC-41b | — |
| D-SC-05 | License for this repo and the template: an open license (owner, 2026-11-09). Orchestrator chose **Apache-2.0** (patent grant, widely understood); `LICENSE` added at the repo root. Owner may swap it. The template folder carries no license file of its own; player repos choose theirs. | **Accepted (owner: open license; orchestrator: Apache-2.0)** | SC-02 | — |
| D-SC-06 | GHCR visibility for the kit image and the mock world image: **public** (owner, 2026-11-09). | **Accepted** | SC-33, SC-63 | — |
| D-SC-07 | Exact current Claude Code syntax for settings, permissions, hooks and skills; the CLI version itself is pinned in SC-40 (at least 2.1.257) | Accepted | SC-12 | geldar [0016](https://github.com/SandboxServers/geldar/blob/main/docs/decisions/0016-claude-code-settings-errata.md), work-packets.md § Claude Code syntax |
| D-SC-08 | Codex CLI. Owner direction (2026-11-09): parity with Claude where possible. Research: worknotes/codex-parity.md. Orchestrator ruling: build CLI-neutral now; Codex ships (SC-71) only after owner calls C1 (terms) and C3 (credential exposure) are answered, and never claims parity without a local live proof of the path denies. | **Gated (owner calls C1, C3)** | SC-71 | geldar 0010 |
| D-SC-09 | Prerequisites on the human's machine: Docker (D-SC-03), git, GitHub CLI `gh` (for `new` and `upgrade`), PowerShell 7 on Windows, `tar` (bsdtar ships with Windows), `tmux` (bash multi-player only) | Proposed (orchestrator) | SC-50 | — |
| D-SC-10 | A scripted **stub CLI** (`packages/stub-cli`) stands in for the vendor CLI in deterministic CI. Real models run only in the live malicious-book job. | Accepted (orchestrator) | SC-24a | — |
| D-SC-11 | The post-session gate is TypeScript (`geldar-verify`) running in a network-less container from the pinned image. The launcher's bash and PowerShell shims stay thin and re-check only the cheap invariants on the host. | Accepted (orchestrator) | SC-23, SC-51 | geldar 0011 |
| D-SC-12 | Mock world auth: a static bearer token per player. The real OAuth flow and its loopback callback wait for Threshold. | Accepted (owner) | SC-31a | — |
| D-SC-13 | Package names: `@geldar/scriptorium-<name>`; binaries `geldar-memory`, `geldar-git`, `geldar-verify` | Accepted (orchestrator) | SC-20 | — |
| D-SC-14 | Mode reaches `geldar-git` through a `GELDAR_MODE` environment variable (`play` or `setup`; unset means `play`), set by the launcher; whether the pinned CLI passes it on to MCP servers is checked in SC-42b and a failure is safe (play mode is the stricter one for identity). | Accepted (orchestrator) | SC-22a, SC-22b | work-packets.md § Wave 2 |

## Packets

Status: Ready / BlockedDependency / BlockedDecision / Writing / Review / Done. Repo: **S** = this repo, **G** = geldar. Each packet is sized for one Haiku `packet-coder` session under 75k tokens. Waves 3 and 4 are written out in full ([work-packets-wave3.md](work-packets-wave3.md), [work-packets-wave4.md](work-packets-wave4.md)); wave 5 is in [work-packets-wave5.md](work-packets-wave5.md); waves 6 and 7 are scope cards until the wave before them closes.

| Packet | Wave | Repo | Title | Implementer | Status | Depends on |
|---|---|---|---|---|---|---|
| SC-01 | 0 | S | Workspace, toolchain, repo checks, `scriptorium.ps1` | packet-coder | Done (merged into wave0) | — |
| SC-02 | 0 | S | CI with `ci gate`, Dependabot, PR template, SECURITY.md | packet-coder | Done (LICENSE added after D-SC-05 was accepted) | SC-01 |
| SC-03 | 0 | S | Developer agent setup: CLAUDE.md, AGENTS.md, agents, skills, memory | packet-coder | Done (merged into wave0) | SC-01 |
| SC-04 | 0 | S | Docs: architecture, clients matrix, releases, decisions index | packet-coder | Done (merged into wave0) | SC-01 |
| SC-05 | 0 | S | Kit threat model and launcher hardening checklist | Sonnet (general-purpose) | Done (merged into wave0) | SC-01 |
| SC-10 | 1 | S | Template skeleton, `player.json` schema, boundary test | packet-coder | Done (merged into wave1) | wave 0 |
| SC-11 | 1 | S | One instructions source, generated `CLAUDE.md` and `AGENTS.md`, drift check | packet-coder | Done (merged into wave1) | SC-10 |
| SC-12 | 1 | S | Play-mode `.claude/settings.json`, `.mcp.json`, policy test | packet-coder | Done (merged into wave1) | SC-10 |
| SC-13 | 1 | S | Skills: `play`, `reflect` | packet-coder | Done (merged into wave1) | SC-10 |
| SC-14 | 1 | S | Skills: `trade`, `author`, `moot` | packet-coder | Done (merged into wave1) | SC-10 |
| SC-15 | 1 | S | `setup` skill and setup-mode settings | packet-coder | Done (merged into wave1) | SC-12 |
| SC-16 | 1 | S | Hooks with the container guard, and their tests | packet-coder | Done (merged into wave1) | SC-10 |
| SC-20 | 2 | S | `path-rule` package: allowed paths, modes, write-once identity | packet-coder | Done (merged into wave2) | wave 1 |
| SC-21 | 2 | S | `geldar-memory` MCP server (`recall`) | packet-coder | Done (merged into wave2) | SC-20 |
| SC-22a | 2 | S | `geldar-git`: runner, filter-safe `commitMemory`, message, fixture and tests | packet-coder | Done (merged into wave2) | SC-20 |
| SC-22b | 2 | S | `geldar-git`: MCP server and CLI (`commit_memory`) | packet-coder | Done (merged into wave2)| SC-22a |
| SC-23a | 2 | S | `geldar-verify`: bundle intake, caps and verdict | packet-coder | Done (merged into wave2) | SC-20 |
| SC-23b | 2 | S | `geldar-verify`: history, path, mode and identity checks, CLI, hostile bundles | packet-coder | Done (merged into wave2) | SC-23a |
| SC-24a | 2 | S | `stub-cli`: scripted stand-in for the vendor CLI (scenario runner; large, budget a retry) | packet-coder | Done (merged into wave2) | SC-21 |
| SC-24b | 2 | S | `stub-cli`: birth and reflect scenarios | packet-coder | Done (merged into wave2) | SC-24a, SC-22b |
| SC-30a | 3 | G | Contract: generator support, shared MCP types, schemas for look, wait, act, say; bundled tool definitions | packet-coder (Sonnet) | Done (geldar PR #5, 1865821) | geldar main |
| SC-30b | 3 | G | Contract: schemas for the other ten tools | packet-coder | Done (geldar PR #7, 587b5db) | SC-30a |
| SC-31a | 3 | G | `threshold/mcp-mock` package: bearer auth, HTTP sessions, supersede | packet-coder (Sonnet) | Done (geldar PR #6, d5a52c1) | — |
| SC-31b | 3 | G | `mcp-mock`: contract-validated tool registry, ids, snapshot builder, fake world | packet-coder (Sonnet) | Done (geldar PR #8, c764f8c) | SC-30b, SC-31a |
| SC-31c | 3 | G | `mcp-mock`: resources, prompts, app, command line | packet-coder | Done (geldar PR #10, 9d9d337) | SC-31b |
| SC-32a | 3 | G | Mock world: clock, scenario file, pure wake policy | packet-coder (Sonnet) | Done (geldar PR #9, 7da2abc) | SC-31a |
| SC-32b | 3 | G | Mock world: event log, scripted intent executor, eat reflex, player sim | packet-coder (Sonnet) | Done (geldar PR #11, 6d179c6) | SC-32a, SC-31b |
| SC-32c | 3 | G | Mock world: hub, `wait` long-poll with wake policy, look, status, sleep, journal | packet-coder (Sonnet) | Done (geldar PR #12, 8e32ee2) | SC-32b, SC-31b |
| SC-32d | 3 | G | Mock world: act and say with budget, books and skills, sim world, CLI scenario flags, real-time end-to-end | packet-coder (Sonnet) | Done (geldar PR #14, 19a4678) | SC-32c, SC-31c |
| SC-33 | 3 | G | Mock world image, published to GHCR from `main` (public, D-SC-06) | packet-coder (Sonnet) | Done (geldar PR #15, 608d7f3; image digest sha256:fa442113...e1e9d; package PRIVATE until an org admin makes it public) | SC-32d |
| SC-40a | 4 | S | Managed and play settings (CLI-home denies), Docker test support | packet-coder | Done | wave 2 |
| SC-40b | 4 | S | Kit image Dockerfile: pinned CLI, companions, marker, non-root; build test; CI Docker step | packet-coder | Done | SC-40a |
| SC-41a | 4 | S | Squid proxy config and allowlist, with config tests | packet-coder | Done | SC-40a |
| SC-41b | 4 | S | Session compose (internal network, no external DNS) and egress allow/deny tests | packet-coder | Done | SC-40b, SC-41a |
| SC-42a | 4 | S | Image contract tests: marker, hooks guard, read-only kit paths, uid and git | packet-coder | Done | SC-40b |
| SC-42b | 4 | S | Pinned-CLI tests: managed path, tool denies, GELDAR_MODE (D-SC-14) | packet-coder | Done | SC-40a, SC-40b |
| SC-50a | 5 | S | Launcher (bash): dispatcher, message table, test harness, fake docker | Sonnet (general-purpose) | Done | wave 4 |
| SC-50b | 5 | S | Launcher (bash): pre-session (clean clone, START, export, isolated workspace; H-01 to H-05) | Sonnet (general-purpose) | Done | SC-50a |
| SC-50c | 5 | S | Launcher (bash): session start (compose override, allowlist, CLI volume; H-06 to H-08, H-19) | Sonnet (general-purpose) | Done | SC-50b |
| SC-50d | 5 | S | Steering text: durable intents, sleep and wait, no polling (template) | packet-coder | Done | wave 1 |
| SC-51a | 5 | S | Launcher (bash): bundle, verify, host re-check (H-09 to H-11, H-13, H-16) | Sonnet (general-purpose) | Done | SC-50c |
| SC-51b | 5 | S | Launcher (bash): fetch, push, fast-forward, hold, crash recovery (H-12, H-14, H-15, H-17); Sonnet | Sonnet (general-purpose) | Done | SC-51a |
| SC-52a | 5 | S | Launcher (bash): `new` and `setup` | Sonnet (general-purpose) | Done | SC-51b |
| SC-52b | 5 | S | Launcher (bash): `resolve`, `archive`, `status`, multi-player `play` | Sonnet (general-purpose) | Done | SC-52a |
| SC-53a | 5 | S | Launcher (PowerShell): dispatcher and common functions | packet-coder | Done | SC-50a |
| SC-53b | 5 | S | Launcher (PowerShell): pre-session parity | packet-coder | Done | SC-50b, SC-53a |
| SC-53c | 5 | S | Launcher (PowerShell): session start parity | packet-coder | Done | SC-50c, SC-53b |
| SC-53d | 5 | S | Launcher (PowerShell): bundle, verify, host re-check parity | packet-coder | Done | SC-51a, SC-53c |
| SC-53e | 5 | S | Launcher (PowerShell): fetch, push, hold, recovery parity; Sonnet | Sonnet (general-purpose) | Done | SC-51b, SC-53d |
| SC-54a | 5 | S | Launcher (PowerShell): `new` and `setup` parity | packet-coder | Done | SC-52a, SC-53e |
| SC-54b | 5 | S | Launcher (PowerShell): `resolve`, `archive`, `status`, Windows Terminal tabs; Sonnet | Sonnet (general-purpose) | Done | SC-52b, SC-54a |
| SC-55a | 5 | S | Stub CLI over HTTP, stub image variant, in-test world | Sonnet (general-purpose) | Done | wave 4 |
| SC-55b | 5 | S | End-to-end CI on the in-test world: `new` → `setup` → three `play` days → push, both launchers; Sonnet | Sonnet (general-purpose) | BlockedDependency | SC-52b, SC-54b, SC-55a |
| SC-55c | 5 | S | End-to-end CI against the mock world image | packet-coder | BlockedDependency (Wave 3) | SC-55b, SC-33 |
| SC-60 | 6 | S | Hostile workspace tests, one per hardening item | packet-coder | BlockedDependency | SC-55b |
| SC-61 | 6 | S+G | Malicious-book corpus as mock world scenarios | packet-coder | BlockedDependency | SC-32d |
| SC-62 | 6 | S | Live malicious-book check, local only (script plus documented procedure; never in CI) with pinned Claude Code | packet-coder | Planned | SC-61 |
| SC-63 | 6 | S | Release workflow: image, cosign, SBOM, scan, launcher assets, template publish | packet-coder | BlockedDependency (SC-60; D-SC-02 and D-SC-06 are Accepted) | SC-60 |
| SC-64 | 6 | S | `geldar-play upgrade`: kit bump as a PR | packet-coder | BlockedDependency | SC-63 |
| SC-70 | 7 | S | Template README (the Patron guide), onboarding and troubleshooting docs | packet-coder | BlockedDependency | wave 6 |
| SC-71 | 7 | S | Codex CLI support | packet-coder | BlockedDecision | D-SC-08 |
| SC-72 | 7 | S | Acceptance runs on Windows and Linux; measure Haiku-low turns; owner inputs: the real MCP host (`launcher/config/world.conf` mcp_base) and the private-only shard list | owner + main session | BlockedDependency | SC-70 |
| SC-73 | 7 | S | Campaign review | packet-reviewer | BlockedDependency | SC-72 |

**Cross-campaign dependency:** wave 3 needs `@geldar/contract` from geldar Phase 0 packet P0-01. Waves 0–2 and 4 don't need wave 3. Only SC-55c (not SC-55b) needs wave 3.

<!-- legacy-ids: SC-23, SC-40, SC-50, SC-51 -->
