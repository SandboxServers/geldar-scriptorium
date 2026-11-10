# Onboarding

The owner's and developer's view of getting a player running: what you need, the values to set, and the order of the first run. The player-facing guide is [template/README.md](../template/README.md); it is published with the template and does not mention this repository. The launcher's own reference is [launcher/README.md](../launcher/README.md).

## Prerequisites

Per D-SC-09, on the machine that runs `geldar-play`:

- Docker (running), git, and the GitHub CLI `gh`, signed in.
- PowerShell 7 on Windows, or bash with `perl` on Linux and macOS.
- `tar` (Windows ships bsdtar).
- `tmux`, for several players at once on bash only. On PowerShell, several players open as Windows Terminal tabs.

`geldar-play` checks the prerequisites of each verb (`verb_needs` in `launcher/geldar-play`) before it does anything.

## The three world values

The real world's address and its private-only shards are set in [launcher/config/world.conf](../launcher/config/world.conf). The file is read as data (`key=value`), never sourced. Until the owner fills these in (SC-72), the launcher refuses or narrows what it does:

| Key | What it is | While blank |
|---|---|---|
| `mcp_base` | Scheme and host of the world, for example `https://world.example`. No path, no credentials. | `new` refuses with `no_world`: nothing is created. |
| `mcp_port` | The port of the world's MCP: digits only, no leading zero, 1024 to 65535. It must match the port in `mcp_base`. | Only ports 80 and 443 are accepted. |
| `private_only_shards` | Shard names separated by commas. Their player repositories must be private. | `new` cannot check the shard. It needs an explicit `--private` or `--public`. |

A shard name is lowercase letters, digits and dashes. A shard on the list is refused unless the player repository is private (`private_required`).

## Repository visibility

`geldar-play new <id>` makes the player repository public unless `--private` is given, and a player's memory is public with it (geldar decision 0013). `--public` says so explicitly and is required when the private-only list is unset and the world is not a mock. Tell the Patron this before the first `new`.

## Token files

A world token can come from a file given with `--token-file <path>`. The file holds one line, trimmed, with nothing after it; the launcher refuses any other shape (`bad_token`). The token reaches the session through the environment only, never an argument and never a file in the mounted directory. Keep token files out of every repository and out of the player's folder.

## The first run

In this order, for one player:

1. Set `mcp_base` and `mcp_port` in `launcher/config/world.conf` (SC-72 owner inputs), and `private_only_shards` if any shard is private-only.
2. Run `geldar-play new <id> --private` (or `--public` where the launcher asks for it). This creates the player repository from the template and clones it.
3. Run `geldar-play setup <id>` once. It is the birth conversation, and it writes the birth commit.
4. Run `geldar-play play <id>`. One `play` is one in-game day: prepare, session, finish.
5. Run `geldar-play status` to check the state, and `geldar-play resolve <id>` if a session is held.

Start one player and watch a whole day before a second one. Acceptance on Windows and Linux, and the six first players, follow the procedure in SC-72 of the [ledger](analysis/scriptorium/README.md).

## Where things are

- Player-facing guide: [template/README.md](../template/README.md), tested by `tests/template/readme.test.ts`.
- Launcher verbs and flags: [launcher/README.md](../launcher/README.md), and the verb line of `launcher/geldar-play`.
- Launcher messages: `launcher/messages.d/*.tsv`.
- Release and signing: [docs/release.md](release.md).
