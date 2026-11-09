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
| D-SC-01 | Model access for the live malicious-book CI: an Anthropic API key as a repo secret with a monthly spend cap. A subscription login can't be used for automation (spec 5.15.1). | **Open (owner)** | SC-62 | — |
| D-SC-02 | Credential the release job uses to publish `template/` to `geldar-player-template`: the GitHub App `geldar-bot`, installed on that repo only (contents write, metadata read); its key and app ID are Key Vault secrets read through Azure OIDC | Accepted (owner, 2026-11-08) | SC-63 | geldar-infra `docs/release-identity.md` |
| D-SC-03 | Container runtime for v1: Docker Desktop (Windows, macOS) and Docker Engine (Linux). Podman later. | Proposed (orchestrator) | SC-40 | — |
| D-SC-04 | Egress proxy: Squid, pinned by digest, with a hostname allowlist and `http_access deny all`. The session container sits on an internal network with no DNS; Squid resolves names. | Proposed (orchestrator) | SC-41 | — |
| D-SC-05 | License for this repo and the template | **Open (owner)** | SC-02 | — |
| D-SC-06 | GHCR visibility for the kit image and the mock world image (this repo is now public, so public images are the straightforward answer) | **Open (owner to confirm)** | SC-33, SC-63 | — |
| D-SC-07 | Exact current Claude Code syntax for settings, permissions, hooks and skills; the CLI version itself is pinned in SC-40 (at least 2.1.257) | Accepted | SC-12 | geldar [0016](https://github.com/SandboxServers/geldar/blob/main/docs/decisions/0016-claude-code-settings-errata.md), work-packets.md § Claude Code syntax |
| D-SC-08 | Codex CLI: current terms and MCP support (the Codex half of spec open decision 2g) | **Open (owner)** | SC-71 | geldar 0010 |
| D-SC-09 | Prerequisites on the human's machine: Docker (D-SC-03), git, GitHub CLI `gh` (for `new` and `upgrade`), PowerShell 7 on Windows | Proposed (orchestrator) | SC-50 | — |
| D-SC-10 | A scripted **stub CLI** (`packages/stub-cli`) stands in for the vendor CLI in deterministic CI. Real models run only in the live malicious-book job. | Accepted (orchestrator) | SC-24a | — |
| D-SC-11 | The post-session gate is TypeScript (`geldar-verify`) running in a network-less container from the pinned image. The launcher's bash and PowerShell shims stay thin and re-check only the cheap invariants on the host. | Accepted (orchestrator) | SC-23, SC-51 | geldar 0011 |
| D-SC-12 | Mock world auth: a static bearer token per player. The real OAuth flow and its loopback callback wait for Threshold. | Accepted (owner) | SC-31 | — |
| D-SC-13 | Package names: `@geldar/scriptorium-<name>`; binaries `geldar-memory`, `geldar-git`, `geldar-verify` | Accepted (orchestrator) | SC-20 | — |
| D-SC-14 | Mode reaches `geldar-git` through a `GELDAR_MODE` environment variable (`play` or `setup`; unset means `play`), set by the launcher; whether the pinned CLI passes it on to MCP servers is checked in SC-42 and a failure is safe (play mode is the stricter one for identity). | Accepted (orchestrator) | SC-22a, SC-22b | work-packets.md § Wave 2 |

## Packets

Status: Ready / BlockedDependency / BlockedDecision / Writing / Review / Done. Repo: **S** = this repo, **G** = geldar. Each packet is sized for one Haiku `packet-coder` session under 75k tokens. Waves 3–7 are scope cards until the wave before them closes, then they're written out in full.

| Packet | Wave | Repo | Title | Implementer | Status | Depends on |
|---|---|---|---|---|---|---|
| SC-01 | 0 | S | Workspace, toolchain, repo checks, `scriptorium.ps1` | packet-coder | Done (merged into wave0) | — |
| SC-02 | 0 | S | CI with `ci gate`, Dependabot, PR template, SECURITY.md | packet-coder | Done (merged into wave0; LICENSE waits on D-SC-05) | SC-01 |
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
| SC-22a | 2 | S | `geldar-git`: runner, filter-safe `commitMemory`, message, fixture and tests | packet-coder | Writing | SC-20 |
| SC-22b | 2 | S | `geldar-git`: MCP server and CLI (`commit_memory`) | packet-coder | BlockedDependency | SC-22a |
| SC-23a | 2 | S | `geldar-verify`: bundle intake, caps and verdict | packet-coder | Done (merged into wave2) | SC-20 |
| SC-23b | 2 | S | `geldar-verify`: history, path, mode and identity checks, CLI, hostile bundles | packet-coder | Writing | SC-23a |
| SC-24a | 2 | S | `stub-cli`: scripted stand-in for the vendor CLI (scenario runner; large, budget a retry) | packet-coder | BlockedDependency | SC-21 |
| SC-24b | 2 | S | `stub-cli`: birth and reflect scenarios | packet-coder | BlockedDependency | SC-24a, SC-22b |
| SC-30 | 3 | G | Contract: MCP tool and result schemas (5.15.3, Appendix K as fixed by 0009) | packet-coder | BlockedDependency | geldar P0-01 |
| SC-31 | 3 | G | `threshold/mcp-mock`: Streamable HTTP per player, bearer auth, tools, resources, prompts | packet-coder | BlockedDependency | SC-30 |
| SC-32 | 3 | G | Mock world: day clock, events, `wait` cursor, `act` validation, `sleep` digest, books | packet-coder | BlockedDependency | SC-31 |
| SC-33 | 3 | G | Mock world image, published to GHCR from `main` | packet-coder | BlockedDecision | SC-32, D-SC-06 |
| SC-40 | 4 | S | Kit image: Dockerfile, pinned CLI, companions, marker, non-root | packet-coder | BlockedDependency | wave 2 |
| SC-41 | 4 | S | Egress proxy and session networking, with allow and deny tests | packet-coder | BlockedDependency | SC-40 |
| SC-42 | 4 | S | Image tests: marker, mounts, settings, hooks guard | packet-coder | BlockedDependency | SC-40 |
| SC-50 | 5 | S | Launcher (bash): pre-session (state, export, workspace) | packet-coder | BlockedDependency | wave 4 |
| SC-51 | 5 | S | Launcher (bash): post-session (bundle, verify, fetch, push, failure paths) | packet-coder | BlockedDependency | SC-50 |
| SC-52 | 5 | S | Launcher (bash): `new`, `setup`, `archive`, `status`, multi-player | packet-coder | BlockedDependency | SC-51 |
| SC-53 | 5 | S | Launcher (PowerShell): pre- and post-session parity | packet-coder | BlockedDependency | SC-51 |
| SC-54 | 5 | S | Launcher (PowerShell): commands parity, Windows Terminal tabs | packet-coder | BlockedDependency | SC-52, SC-53 |
| SC-55 | 5 | S | End-to-end CI: `new` → `setup` → `play` → push, stub CLI against the mock world | packet-coder | BlockedDependency | SC-52, SC-33 |
| SC-60 | 6 | S | Hostile workspace tests, one per hardening item | packet-coder | BlockedDependency | SC-55 |
| SC-61 | 6 | S+G | Malicious-book corpus as mock world scenarios | packet-coder | BlockedDependency | SC-32 |
| SC-62 | 6 | S | Live malicious-book CI with pinned Claude Code | packet-coder | BlockedDecision | SC-61, D-SC-01 |
| SC-63 | 6 | S | Release workflow: image, cosign, SBOM, scan, launcher assets, template publish | packet-coder | BlockedDecision (D-SC-06 only; D-SC-02 is Accepted) | SC-60, D-SC-06 |
| SC-64 | 6 | S | `geldar-play upgrade`: kit bump as a PR | packet-coder | BlockedDependency | SC-63 |
| SC-70 | 7 | S | Template README (the Patron guide), onboarding and troubleshooting docs | packet-coder | BlockedDependency | wave 6 |
| SC-71 | 7 | S | Codex CLI support | packet-coder | BlockedDecision | D-SC-08 |
| SC-72 | 7 | S | Acceptance runs on Windows and Linux; measure Haiku-low turns | owner + main session | BlockedDependency | SC-70 |
| SC-73 | 7 | S | Campaign review | packet-reviewer | BlockedDependency | SC-72 |

**Cross-campaign dependency:** wave 3 needs `@geldar/contract` from geldar Phase 0 packet P0-01. Waves 0–2 and 4 don't need wave 3. Wave 5's end-to-end test (SC-55) does.
