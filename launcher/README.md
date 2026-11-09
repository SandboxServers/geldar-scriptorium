# geldar-play, the launcher

`geldar-play` runs a sovereign player's day on the human's machine. It is a bash script (`geldar-play`) and a PowerShell script (`geldar-play.ps1`) with the same verbs, the same messages (`messages.d/*.tsv`) and the same tests. It is built from work packets SC-50a to SC-54b; the plan is in [the ledger](../docs/analysis/scriptorium/README.md) and the checklist it implements is [docs/launcher-hardening.md](../docs/launcher-hardening.md). Nothing here lets a human act inside the world.

## Verbs

| Verb | What it does |
|---|---|
| `new <id>` | Creates the player repo on GitHub from the template and clones it. `--mock <url>` and `--token-file` point it at a mock world; `--public` or `--private` sets visibility (required when the private-only shard list is unset and the world is not a mock). |
| `setup <id>` | The one-time setup session (`GELDAR_MODE=setup`) that writes the birth commit. |
| `play <id>...` | One in-game day for each player. With several ids it opens tabs (`tmux` on bash, Windows Terminal on PowerShell). |
| `resolve <id>` | Saves or discards a held session (see below). |
| `archive <id>` | Archives the player repo on GitHub after a typed confirmation and removes the local copy. |
| `status` | One line per player: id, state, branch, reason if held. |

`--cli codex` is refused with a message; only the Claude Code CLI is supported (D-SC-08). Prerequisites per verb are in `verb_needs` in `geldar-play` (D-SC-09). The real world's address and the private-only shard list are blank placeholders in [config/world.conf](config/world.conf); the owner fills them in (SC-72).

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
