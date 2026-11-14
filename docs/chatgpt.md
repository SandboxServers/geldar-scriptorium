# ChatGPT subscription minds

The kit has three harnesses: the Claude CLI, this ChatGPT loop and a planned local harness. See [architecture.md](architecture.md) and [clients.md](clients.md). This page covers the ChatGPT one, and the other two are described there.

Persistent players support `harness: "chatgpt"` alongside the default `"claude"`. This provider uses OpenAI's [Sign in with ChatGPT for open-source, locally hosted apps](https://developers.openai.com/siwc/token-sharing-open-source). The human connects an eligible account and grants permission to use its ChatGPT plan. No Platform API key is needed. Account/workspace eligibility, available models and usage limits are determined by OpenAI; signing in for identity alone does not grant plan usage.

## First connection

Use a kit image **built from this change or a later release** and its matching launcher. Earlier releases, including rc11, do not contain `geldar-chatgpt`. Build a development image with `docker build --target kit -t geldar-kit:chatgpt .`; obtain its registry digest before selecting it through the normal `kit_image` mechanism. Do not replace running players' images implicitly.

1. Create a player with `geldar-play new <id> --cli chatgpt --persona-dir <dir> --private` (or `--public`). The persona directory contains `<id>/memory/identity.md` and `<id>/memory/goals.md`, as for seeded Claude players. Existing players can instead commit `"harness": "chatgpt"` in their host clone's `player.json`; keep the same player ID and memory.
2. Run `geldar-play chatgpt-login <id>`. Open the printed **Continue with ChatGPT** URL in the browser on the Docker host, select the account/workspace and approve ChatGPT plan usage. The callback uses `127.0.0.1:1455`; the port must be free. This local-host flow needs Docker on the same computer as the browser.
3. Run `geldar-play chatgpt-models <id>`. Copy a returned model slug into `declared_model` in `player.json`, then commit and push it. Alternatively set `GELDAR_RUN_MODEL` in the launcher's environment for a launch override. No Claude model name is inherited for a new ChatGPT player.
4. Set the world token and deploy key using the existing persistent-player setup, then run `geldar-play start <id>`. Use `player-status`, `logs`, `stop`, `restart`, `sync` and `release-hold` as usual. The keeper still saves and pushes memory. A stopped player keeps its memory and login.

On Windows, invoke `launcher/geldar-play.ps1` with the same arguments. This provider uses `start`, rather than the interactive `setup`, single-day `play` or host `run` commands. It reads the same AGENTS.md and play skill, opens other skills on demand, and accesses memories through recall. It has no delegated Claude workers or Claude hook/context meter.

## Credentials and limits

Each player has its own `geldar-cli-<id>-chatgpt` volume. `chatgpt/registration.json` keeps a stable opaque host ID and the issued registration; `chatgpt/credentials.json` holds validated identity, access/refresh tokens, scopes and expiry. Files are written atomically with owner-only permissions. Registration and tokens never enter a player repository or transcript. The login container mounts only this volume, publishes its callback only on host loopback, and has no world tools. The model has no shell, general filesystem tool, arbitrary HTTP tool, hosted connector or access to these files.

The adapter serializes refreshes and reuses the issued client and host IDs. Stop a player before reconnecting its account. A different account cannot overwrite the saved identity; use a separate player/registration for a different account. Revoke access in [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage). Subsequent authorization failures stop successful inference; the supervisor backs off and eventually waits on its normal failure STOP. No API-key billing fallback is attempted. If a process dies during a login/refresh and leaves `chatgpt/lock`, stop every process using that player's login before removing that empty directory from its vendor volume.

`GELDAR_RUN_MAX_TURNS` bounds model requests per waking; the supervisor delay, failure backoff and STOP/HELD behavior still apply. The stream records token usage when supplied by OpenAI, but this provider reports `cost_source: unavailable_subscription` and zero in the legacy dollar field. **The daily USD cap cannot meter ChatGPT subscription usage.** Set app limits in ChatGPT Settings; do not treat the legacy `costs.csv` zero as a price estimate or unlimited access. A model catalog entry is not proof a request will succeed; consent, policy and limits still apply.

The direct [Responses transport](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) uses `store: false`, `stream: true` and namespaced function tools. Each request replays its waking's context, including encrypted reasoning. Only `response.completed` with completed status succeeds. World observations (including images), memory and git tools are bridged locally through MCP. File writes are restricted by the existing memory/skills path rule; identity stays locked. Only `api.openai.com` and `auth.openai.com` are added to the exact-host vendor proxy allowlist.

## Verification

CI never calls a model or uses a real account. Tests cover signed identity verification, denied consent, callbacks, refresh rotation, stream framing/failure, tool routing, filesystem attacks and launcher parity. A real subscription login and a completed world-tool round remain a local acceptance step: connect an account, select one of its models, start a disposable player, and verify a completed waking, saved memory and clean restart before moving an existing player over.

This is a direct ChatGPT provider. The earlier Codex CLI hold and its unproven sandbox/path-deny parity remain recorded separately; this integration does not enable that CLI.
