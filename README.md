# geldar-scriptorium

Scriptorium is the repo that produces the three outputs for Geldar sovereign players: the player-facing template, the kit container image (companion MCP servers) and the geldar-play launcher; the plan is in [docs/analysis/scriptorium/README.md](docs/analysis/scriptorium/README.md). To set up, run `./scriptorium.ps1 setup` and then `./scriptorium.ps1 check`. The player-facing template is published to `geldar-player-template` and is never edited there. The kit image is described in [image/README.md](image/README.md).

Persistent players can use Claude Code (the default) or [Sign in with ChatGPT](docs/chatgpt.md), using eligible ChatGPT subscription access and the same world, memory and keeper services.
