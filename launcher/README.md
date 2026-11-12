# geldar-play, the launcher

`geldar-play` runs a sovereign player's day on the human's machine. It is a bash script (`geldar-play`) and a PowerShell script (`geldar-play.ps1`) with the same verbs, the same messages (`messages.d/*.tsv`) and the same tests. It is built from work packets SC-50a to SC-54b; the plan is in [the ledger](../docs/analysis/scriptorium/README.md) and the checklist it implements is [docs/launcher-hardening.md](../docs/launcher-hardening.md). Nothing here lets a human act inside the world.

## Verbs

| Verb | What it does |
|---|---|
| `new <id>` | Creates the player repo on GitHub from the template and clones it. `--mock <url>` and `--token-file` point it at a mock world; `--public` or `--private` sets visibility (required when the private-only shard list is unset and the world is not a mock). `--repo <owner/name>` is for owner provisioning only, not for Patrons (see below). |
| `setup <id>` | The one-time setup session (`GELDAR_MODE=setup`) that writes the birth commit. |
| `play <id>...` | One in-game day for each player. With several ids it opens tabs (`tmux` on bash, Windows Terminal on PowerShell). |
| `resolve <id>` | Saves or discards a held session (see below). |
| `archive <id>` | Archives the player repo on GitHub after a typed confirmation and removes the local copy. It needs the clone's origin URL to end in `player-<id>`, so a player made with `--repo` under another name cannot be archived by the launcher. |
| `status` | One line per player: id, state, branch, reason if held. |

`--cli codex` is refused with a message; only the Claude Code CLI is supported (D-SC-08). Prerequisites per verb are in `verb_needs` in `geldar-play` (D-SC-09). The real world's address and port are set in [config/world.conf](config/world.conf); the private-only shard list is blank for now, and is revisited later.

## Owner and developer options

These options are not in the Patron's guide ([template/README.md](../template/README.md)). Give them to the owner and to developers only.

- **`new <id> --persona-dir <dir>`** (owner provisioning only). The directory holds `memory/identity.md` (at most 8192 bytes) and `memory/goals.md` (at most 4096 bytes). Both are checked before anything is created: no control characters, valid UTF-8, no invisible code points, no links, plain files only, no empty file, and the option given once. A refused file gives `persona_bad` with the reason and creates nothing. A good persona makes a player that is already born, so `setup` is not needed (`created_seeded`).
- **`new <id> --repo <owner/name>`** (owner provisioning only, not for Patrons). Fills an existing repository, which must hold only a first commit of README.md, LICENSE and .gitignore, from the newest released template tag instead of creating `player-<id>`. The visibility must match. A failure after the clone says `adopt_failed`. A token file given to `--token-file` may read `GELDAR_MCP_TOKEN=<value>` or the bare value; a byte-order mark or a NUL byte is refused.
- **`GELDAR_DEV_MCP_URL`** (developer seam, the human's own environment only). Set it, in the shell that runs `geldar-play`, to exactly `http://host.docker.internal:PORT/p/ID`, with PORT from 1024 to 65535 and no leading zero, and ID the player's own id. The launcher reads it from the environment only, never from `player.json` or a file. The one check is that exact shape; a wrong value is refused with `dev_world_bad` before any lock, state or Docker call. The value is not checked against `mcp_base`. It replaces the world URL for that launch only, goes straight to the allowlist writer, and is not given to the session container. Each launch prints `dev_world_active`, and while it is set, starting more than one player is refused (`dev_world_single`). The token travels in clear text over http, so use a separate dev token. Setup and the listen-address rules are in [the troubleshooting guide](../docs/troubleshooting.md#testing-against-a-world-on-your-own-machine).

## Directories

- **State** (`<state>`): `GELDAR_STATE_DIR` if set. Otherwise `$XDG_STATE_HOME/geldar` (default `~/.local/state/geldar`) on bash, and `%LOCALAPPDATA%\geldar` on PowerShell. Each player keeps its files under `<state>/<id>` (see [State layout](#state-layout)).
- **Share** (`share`): the compose file, the proxy configuration and the troubleshooting guide. `GELDAR_SHARE` if set; else the `image/` folder next to `launcher/` when it holds `compose/session.yml` (the repository layout); else `share/` next to the launcher (the packaged layout).
- **Troubleshooting**: every message the launcher prints, what it means and what to do, is in [docs/troubleshooting.md](../docs/troubleshooting.md). The launcher archive ships the same page as `share/troubleshooting.md`, next to `geldar-play`, so a Patron has it without the repository.

## The world values

`launcher/config/world.conf` is read as data, never sourced. Set by the owner (see [onboarding](../docs/onboarding.md)):

- `mcp_base`: scheme, host and port of the world (`https://mcp.geldar.sandboxservers.games` in the shipped file), with no path and no credentials. Blank means `new` refuses with `no_world`.
- `mcp_port`: the world's MCP port, digits only, 1024 to 65535. Blank means only ports 80 and 443 are accepted. On every port the URL's scheme and host must equal those of `mcp_base`, and a non-default port must also equal `mcp_port`.
- `private_only_shards`: shard names separated by commas. Their player repositories must be private. Blank in the shipped file: all shards are currently watched, and the list is revisited later.

Each session writes the world's host and effective port for the proxy (`pub/allowlist-world.txt` and `pub/allowlist-world-ports.txt`). The proxy reaches the world on that port (Squid's `world_port` ACL), and it refuses CONNECT to port 80.

## The session flow

`play` runs three stages, each a function in `lib/`:

1. **Prepare** (`prepare.sh`): clean clone of the player's branch, record START, export the kit files, build an isolated workspace in a named volume (decision 7 in the [overnight decisions](../docs/analysis/scriptorium/worknotes/overnight-decisions.md)).
2. **Session** (`session.sh`): compose project with an internal network and a Squid proxy; the session container runs the pinned CLI. The world token reaches it only through the environment, never an argument or a file in the mounted directory.
3. **Finish** (`bundle.sh`, `recheck.sh`, `finish.sh`): bundle the workspace in a network-less container with a size cap, verify the bundle with `geldar-verify`, fetch it with fsck into a local ref, re-check it on the host, push, fast-forward, clean up.

### Push order (H-14, geldar decision 0011)

Verify gate, fetch with fsck to a local ref, host re-check, push the exact verified SHA (never `--force`), then `merge --ff-only` on the host. Nothing reaches the remote before the gate, and a rejected push never leaves the host branch ahead of the remote.

### Held sessions

If any finish step fails (verify rejected, fetch, re-check, bundle too large, host moved, push or fast-forward failed), the bundle is kept under the player's state directory and the run exits 3 with a reason. `play` refuses to start while a session is held; `resolve <id>` fetches first and decides from the refs (a diverged origin never moves the host branch), and `resolve <id> --discard` drops the held bundle, and `status` lists held players. A crash mid-finish is recovered by the next `play` from the stored START.

## State layout

Under `<state>/<id>`: `start` (the stored START), `session/` (the held bundle and helper input, 0700), `pub/` (0755, holds only `allowlist-world.txt`, which the proxy reads) and `export/` (the kit overlays from `git archive`, world readable so the session container can read them as uid 1000). Everything else is 0700 for directories and 0600 for files. Modes apply on POSIX hosts; on Windows the state is under `%LOCALAPPDATA%` with a user-private ACL. Open question: the helper container's access to `session/` on a host whose uid is not 1000.

## Test-only variables

Every `GELDAR_*` variable that changes behavior for tests is read through `gp_env` (bash) or `Get-GatedEnv` (PowerShell), which return nothing unless `GELDAR_INTERNAL=1`. Ungated by design, as seams for a human's own environment: `GELDAR_DOCKER`, `GELDAR_GIT`, `GELDAR_GH`, `GELDAR_SHARE`, `GELDAR_STATE_DIR`, `GELDAR_PLAYERS_DIR`. `GELDAR_KIT_IMAGE` is accepted only as a digest-pinned reference, unless both `GELDAR_INTERNAL=1` and `GELDAR_UNSAFE_IMAGE=1`. The gated ones include `GELDAR_TOOL_PATH`, `GELDAR_SLEEP`, `GELDAR_HELPER_TIMEOUT_SEC`, `GELDAR_TEST_*` and `GELDAR_UNSAFE_IMAGE`. Grep `gp_env` for the full list; the Wave 5 security review checked that no other test variable is ungated. The `__prepare`, `__session`, `__finish` and `__bounded` verbs also need `GELDAR_INTERNAL=1`.

## Running the tests

Launcher tests live in `test/` and run both launchers through shared test files (`parity.ts` lists which groups each launcher passes). They use a fake `docker` and `gh`.

```powershell
./scriptorium.ps1 pnpm vitest run launcher/test                     # deterministic cases
$env:GELDAR_TIMING_TESTS = '1'; ./scriptorium.ps1 pnpm vitest run launcher/test   # plus the CI-only timing cases
```

- **Timing tests** (wall-clock bounds, process-group kills, polling) run only when `CI` is set or `GELDAR_TIMING_TESTS=1`; locally they are skipped with a visible reason (`test/timing.ts`, dispatch rule 19). Never run two full checks at once.
- **End to end** (`tests/e2e/`): real Docker, the real launchers, the stub CLI image and a world. Heavy, so locally it runs only with `GELDAR_E2E=1`; CI always runs it. `GELDAR_E2E_WORLD=mock` swaps the in-test world for the geldar mock image, pinned by digest. Needs Linux containers and an isolated tag, for example `KIT_IMAGE=geldar-kit:mytag`.
- In CI a missing shell (bash or pwsh) fails the run; locally it logs a skip.
- Known gap: `bundle.test.ts` case 5 (H-16) cannot run on Windows git (the hostile commit never lands in the fixture); Linux CI runs it.
