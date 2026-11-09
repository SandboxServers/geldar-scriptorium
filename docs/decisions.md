# Decisions

One line per geldar record that shapes this kit (0007 to 0016). The records live in the geldar repo; the spec stays the design.

- [0007](https://github.com/SandboxServers/geldar/blob/main/docs/decisions/0007-spec-frozen-at-v0.8.md): The spec is frozen at v0.8; changes are recorded here (Process, Accepted)
- [0008](https://github.com/SandboxServers/geldar/blob/main/docs/decisions/0008-companion-servers-own-repo.md): The player kit's companion servers live in their own repo and ship in the kit's container image (Changes, Accepted)
- [0009](https://github.com/SandboxServers/geldar/blob/main/docs/decisions/0009-scriptorium-spec-errata.md): Errata for the player kit (Scriptorium) sections (Fixes, Accepted)
- [0010](https://github.com/SandboxServers/geldar/blob/main/docs/decisions/0010-player-kit-harnesses-v1.md): The player kit supports Claude Code, then Codex CLI; no Google harness in v1 (Changes, Accepted)
- [0011](https://github.com/SandboxServers/geldar/blob/main/docs/decisions/0011-player-repo-push-from-host.md): Player memory is pushed from the human's machine; the container never sees the real repo (Changes, Accepted)
- [0012](https://github.com/SandboxServers/geldar/blob/main/docs/decisions/0012-launcher-in-geldar-scriptorium.md): The `geldar-play` launcher lives in `geldar-scriptorium` and is installed once per machine (Changes, Accepted)
- [0013](https://github.com/SandboxServers/geldar/blob/main/docs/decisions/0013-public-player-repos.md): Living player repos may be public; the agent is confined to its own repo, enforced and tested (Changes, Accepted)
- [0014](https://github.com/SandboxServers/geldar/blob/main/docs/decisions/0014-template-source-in-geldar-scriptorium.md): The template is player-facing only; it is developed in `geldar-scriptorium` and published from there (Changes, Accepted)
- [0015](https://github.com/SandboxServers/geldar/blob/main/docs/decisions/0015-player-birth-and-setup-session.md): Until the Allocator exists, a player is born through the launcher and a one-time setup session (Changes, Accepted)
- [0016](https://github.com/SandboxServers/geldar/blob/main/docs/decisions/0016-claude-code-settings-errata.md): Appendix J's Claude Code settings, corrected against Claude Code 2.1 (`effortLevel`, per-server MCP timeout, read blocking, settings layers).
