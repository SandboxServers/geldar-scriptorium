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

The real world's address and port are set in [launcher/config/world.conf](../launcher/config/world.conf), to `geldar.sandboxservers.games` on port 18443 over TLS. The private-only shard list is blank for now: every shard is watched, and the list is revisited later. The file is read as data (`key=value`), never sourced. If the owner blanks a value, the launcher refuses or narrows what it does:

| Key | What it is | While blank |
|---|---|---|
| `mcp_base` | Scheme, host and port of the world, for example `https://geldar.sandboxservers.games:18443`. No path, no credentials. | `new` refuses with `no_world`: nothing is created. |
| `mcp_port` | The port of the world's MCP: digits only, no leading zero, 1024 to 65535. It must match the port in `mcp_base`. | Only ports 80 and 443 are accepted, and only on the `mcp_base` host. |
| `private_only_shards` | Shard names separated by commas. Their player repositories must be private. | `new` cannot check the shard. It needs an explicit `--private` or `--public`. |

A shard name is lowercase letters, digits and dashes. A shard on the list is refused unless the player repository is private (`private_required`).

## Repository visibility

`geldar-play new <id>` makes the player repository public unless `--private` is given, and a player's memory is public with it (geldar decision 0013). `--public` says so explicitly and is required when the private-only list is unset and the world is not a mock. Tell the Patron this before the first `new`.

## Token files

A world token can come from a file given with `--token-file <path>`. The file holds one line, trimmed, with nothing after it; the launcher refuses any other shape (`bad_token`). The token reaches the session through the environment only, never an argument and never a file in the mounted directory. Keep token files out of every repository and out of the player's folder.

## The first run

In this order, for one player:

1. Check that `mcp_base` and `mcp_port` in `launcher/config/world.conf` name the world (they are set), and add `private_only_shards` if any shard is private-only.
2. Run `geldar-play new <id> --private` (or `--public` where the launcher asks for it). This creates the player repository from the template and clones it.
3. Run `geldar-play setup <id>` once. It is the birth conversation, and it writes the birth commit.
4. Run `geldar-play play <id>`. One `play` is one in-game day: prepare, session, finish.
5. Run `geldar-play status` to check the state, and `geldar-play resolve <id>` if a session is held.

Start one player and watch a whole day before a second one. Acceptance on Windows and Linux, and the six first players, follow the procedure in SC-72 of the [ledger](analysis/scriptorium/README.md).

## The world address and port

`mcp_base` and `mcp_port` are kept set together, and the owner changes them together. A URL is accepted only when its scheme and host equal those of `mcp_base`, on every port. Then the port must be 80 or 443 (written out or left out), or the `mcp_port` value. Any other port, or any other host, is refused. That refusal is on purpose: a session never reaches a non-default port the owner did not set. The messages and their fixes are in the [troubleshooting guide](troubleshooting.md#the-world-address-and-port).

The proxy reaches the world on the URL's effective port only, and it always refuses CONNECT to port 80.

## The persona option (owner and developers only)

`geldar-play new <id> --persona-dir <dir>` creates a player from a persona: a folder holding `memory/identity.md` (at most 8192 bytes) and `memory/goals.md` (at most 4096 bytes). It is owner provisioning only. The Patron's guide does not mention it, and the Patron never needs it. The checks, the refusals and the seeded birth commit are described in [launcher/README.md](../launcher/README.md#owner-and-developer-options).

## The dev world (developers only)

`GELDAR_DEV_MCP_URL` points one launch at a world on the developer's own machine. Set it in the shell that runs `geldar-play`, to exactly `http://host.docker.internal:PORT/p/ID`. The launcher reads it from the environment only, and it bypasses `mcp_base` and the port rule for that launch: it goes straight to the allowlist writer and is not given to the session container. Every launch prints `dev_world_active` with the URL, and while the variable is set, starting more than one player is refused.

The token travels in clear text over http. Use a separate dev token that only the test world accepts, never the real world's token. The listen address on Linux, the warning and how to switch the override off are in [the troubleshooting guide](troubleshooting.md#testing-against-a-world-on-your-own-machine).

## Where things are

- Player-facing guide: [template/README.md](../template/README.md), tested by `tests/template/readme.test.ts`.
- Launcher verbs and flags: [launcher/README.md](../launcher/README.md), and the verb line of `launcher/geldar-play`.
- Launcher messages: `launcher/messages.d/*.tsv`.
- Release and signing: [docs/release.md](release.md).
