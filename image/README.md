# The kit image

The container a player's session runs in: the three companion servers (`geldar-memory`, `geldar-git`, `geldar-verify`), the pinned Claude Code CLI, the kit marker and the managed settings. It is published to GHCR and pinned by digest in each `player.json` (H-19). Nothing here lets a human act inside the world.

## Files

| Path | What |
|---|---|
| `Dockerfile` | Stages `deps`, `kit` (the shipped image, non-root user `player`) and `nettest` (test only; never shipped) |
| `settings/managed.json` | Managed settings, installed at `/etc/claude-code/managed-settings.json` (the CLI's managed path) |
| `settings/play.json`, `setup.json` | Per-mode settings the launcher passes with `--settings`; managed still wins |
| `geldar-entrypoint.sh` | The image entrypoint (`/usr/local/bin`). It seeds the workspace trust for `/player` in `/cli-home/.claude.json` when `GELDAR_MODE` is set, then runs the base image's `docker-entrypoint.sh`; see below |
| `proxy/` | Squid config and the vendor allowlist; see [proxy/README.md](proxy/README.md) |
| `compose/session.yml` | The session network: the proxy sits on `inside` and `outside`, the session on the internal network behind it |
| `compose/session.test.yml` | Test overlay used by the egress tests |

## Pins and where each is checked

| Pin | Where it lives | Checked by |
|---|---|---|
| Node base image, by digest | `Dockerfile` `FROM` lines | `tests/image/build.test.ts` (every `FROM` has a digest, no `:latest`; `node -v` matches `.nvmrc`) |
| Claude Code CLI, exact version | `Dockerfile` `ARG CLAUDE_CODE_VERSION` | `tests/image/build.test.ts` (`claude --version` matches the ARG) |
| Squid, by digest | `compose/session.yml` | `tests/image/settings.test.ts`, `tests/image/proxy-config.test.ts`, `tests/image/egress.test.ts` |
| Auto-update off | `Dockerfile` `ENV DISABLE_AUTOUPDATER=1` | `tests/image/build.test.ts` |
| No account connectors, no tool search | `compose/session.yml` `session` environment and `Dockerfile` `ENV`: `ENABLE_CLAUDEAI_MCP_SERVERS=false`, `ENABLE_TOOL_SEARCH=false` | `tests/image/session-env.test.ts` |

## Build and test locally

Docker is needed for the image tests; without it they skip.

```powershell
./scriptorium.ps1 check                           # everything CI runs
./scriptorium.ps1 pnpm vitest run tests/image     # only the image tests
$env:KIT_IMAGE = 'geldar-kit:mytag'               # isolated tag when you work in parallel
```

The kit image is built once per vitest run by `tests/image/global-setup.ts`; each test file's `buildKit()` then does nothing. Packets that touch Docker use their own tag through `KIT_IMAGE` so concurrent runs do not share or race on one tag (dispatch rules 16 and 17 in `docs/analysis/scriptorium/work-packets.md`).

## What the tests cover

- `tests/image/contract.test.ts`: the kit marker is root-owned and unwritable; the image's entrypoint is the kit script and CMD is `node`; settings are byte-equal to the repo files and unwritable; hooks act only with the marker and do not run as root; the workspace is writable for the process uid.
- `tests/image/entrypoint.test.ts`: no Docker needed. The entrypoint seeds the CLI home in an absent file, keeps the other keys of an existing one, keeps an existing theme, leaves invalid JSON alone, does nothing without `GELDAR_MODE`, and gives the same bytes on a second run.
- `tests/image/session-env.test.ts`: no Docker needed. The session service and the image both set `ENABLE_CLAUDEAI_MCP_SERVERS=false` and `ENABLE_TOOL_SEARCH=false`.
- `tests/image/cli.test.ts`: against the pinned CLI, managed settings are read from the managed path; the shipped settings are valid; an empty managed file lifts the denies (so the deny case is not vacuous); play and setup settings are accepted; the companions start and connect; `GELDAR_MODE` reaches the servers only when set and changes whether the commit tool refuses.
- `tests/image/settings.test.ts`: the deny rules for the CLI home and credentials are present and nothing widens permissions with an allow list.
- `tests/image/proxy-config.test.ts` and `tests/image/egress.test.ts`: the Squid policy structure, `squid -k parse` on the pinned image, and allow or refuse through the proxy on the internal network (see the file for the exact cases).

## Startup: workspace trust

Claude Code ignores a workspace's `permissions.allow` list until the workspace is trusted, and under `defaultMode: dontAsk` it then refuses every tool. A fresh CLI home has no trust, so `geldar-entrypoint.sh` sets `projects["/player"].hasTrustDialogAccepted` to `true` in `/cli-home/.claude.json` before it starts the CLI. It runs only when `GELDAR_MODE` is set (the launcher sets it for `setup` and `play`) and `/cli-home` is writable. It keeps every other key, including a logged-in session's; it writes through a temp file and a rename, with mode 0600; it leaves a file that is not valid JSON untouched; and it never fails the container. It makes no network calls and never prints the file. The agent cannot read or write `/cli-home` (managed settings deny it), so the seeding widens nothing.

The same run sets three more first-run keys, so no human answers a screen: `hasCompletedOnboarding` true and `theme` `"dark"` (only when no theme is set) in `.claude.json`. It also adds the kit's MCP servers (`geldar`, `geldar_memory`, `geldar_git`) to `enabledMcpjsonServers` in `/cli-home/settings.json` (and deliberately does not set `enableAllProjectMcpServers`, so a server added to `.mcp.json` later is not approved automatically), because the player's workspace is recreated each session and an approval could never persist. `play.json` and `setup.json` carry the same two MCP keys.

## H-20: structural only in CI

The Read and Edit denies for the CLI home and credentials are tested for what can be tested without a model: the rules exist (`settings.test.ts`) and the pinned CLI accepts the managed file from the managed path (`cli.test.ts`). Whether a path deny actually blocks a model's read is **not** tested in CI. D-SC-01 settled that CI never calls a model, so that live check is local only, run by the owner with a subscription login (SC-62, not built yet; Wave 6). Until SC-62 runs, treat H-20 as structurally covered, not behavior-verified.

## Stub image variant (Wave 5)

`stub.Dockerfile` builds the kit image with the scripted `stub-cli` in place of the real CLI, for the end-to-end tests only (`tests/e2e/`, run through [the launcher](../launcher/README.md)). It needs `--build-arg KIT_BASE=<kit image>`, is never published and is never a release target.
