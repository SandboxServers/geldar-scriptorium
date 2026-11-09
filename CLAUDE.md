# geldar-scriptorium: the kit that makes Geldar sovereign players

This repo produces the three outputs for Geldar sovereign players: the player-facing template (published to `geldar-player-template`, never edited there), the kit container image (companion MCP servers) and the `geldar-play` launcher. The plan is [docs/analysis/scriptorium/README.md](docs/analysis/scriptorium/README.md); read its `RESUME.md` first. This file is the core every session loads; [AGENTS.md](AGENTS.md) has the same rules for every harness plus the campaign procedure.

## The rule above all

`template/` is the player's mind. It is published as-is to every player, so never put anything for developers there: no notes about this repo, packets, CI or how the kit is built. Its files follow the voice rule in the packet's dispatch rules (geldar decision 0014).

## Repo rules

- **The spec is frozen.** It lives in the geldar repo. Build what the spec and the current packet say. Every departure from the spec is a record in the geldar repo's `docs/decisions/` (0007), and the PR says so. Ideas outside the spec go in the geldar repo's `docs/ideas.md`.
- **Pin exact versions**: npm packages (`saveExact` is on), Docker images (by digest), GitHub Actions (by commit SHA), Node (`.nvmrc`). Only versions at least two weeks old.
- **A behavior change needs a test that fails when the change is reverted.** Check that it does before you call it done.
- **Files: soft cap 500 lines, hard cap 700.** Split along natural seams. No `utils.ts` or `helpers.ts` dumping grounds. `pnpm check:repo` enforces the hard cap.
- **LF line endings everywhere** (`.gitattributes`), except `*.bat`/`*.cmd`.
- **No secrets, account names, or public or private-network IPs in the repo** (`127.0.0.1` is fine). It is public. `.env` files are gitignored; commit a `.env.example`.
- **Principle 1 holds in code too:** nothing we build lets a human act inside the world (spec section 2).

## Commands

```powershell
./scriptorium.ps1 setup            # pnpm install with the pinned pnpm
./scriptorium.ps1 pnpm <args>      # pnpm with the pinned version on PATH
./scriptorium.ps1 check            # everything CI runs: biome, typecheck, vitest, repo checks
```

pnpm workspace, Node 22 (`.nvmrc`), TypeScript, Biome, Vitest. Windows with PowerShell 7 is the main dev platform; CI runs on Linux.

## Skills and agents

- Skills in `.claude/skills/`: `ship-pr` (branch to merged PR, worktree removed) and `campaign-packet` (run a campaign as work packets). Load the matching one before that kind of work.
- Agents in `.claude/agents/`: `packet-coder` implements one packet, `packet-reviewer` reviews it read-only. These copies override the global ones of the same name.

## Memory

Project memory is committed in `.claude/agent-memory/main-session/`. Grep it before researching a topic, and add what you learn with the change that taught it.
