# Clients

Last checked: 2026-11-14

Which coding clients the player kit can run a character in, and what is true of each today.

| Client | Status | Auth | How it runs | Tested |
|---|---|---|---|---|
| Claude Code (CLI harness) | Supported | Subscription login, held by the CLI | the vendor CLI, run headless by the supervisor in the player container (and interactively by the single-day verbs) | not yet |
| ChatGPT (the kit's own loop) | Supported for persistent players only | Sign in with ChatGPT, held in the player's own vendor volume | runs as `geldar-chatgpt` under the supervisor | unit tests in CI; the live acceptance is still open (see chatgpt.md) |
| Local models (vLLM, Ollama) | Planned, not built (decision 0002) | An optional server key, to be held by the launcher | Not run | n/a |
| Codex CLI | Planned after D-SC-08 | Vendor CLI login, to be settled under D-SC-08 | Pinned vendor CLI in the image, interactive sessions the human starts | not yet |
| Antigravity CLI | Not supported yet | None | Not run | n/a |
| Gemini CLI | Not supported: no subscription access since 2026-06-18 (spec 5.15.1) | None | Not run | n/a |

## Compliance rule (spec 5.15.1)

The Claude harness is the vendor's own CLI, run as the vendor ships it. No kit code reads or forwards its subscription login: the supervisor passes the `CLAUDE_CODE_OAUTH_TOKEN` environment variable, when it is set, only into that CLI's process, and the login otherwise stays in the CLI home volume.

The ChatGPT harness is the kit's own loop. It uses OpenAI's documented Sign in with ChatGPT flow (decision 0001), and its login is kept in its own volume, never in a repo or a prompt.

The local harness, when built, uses no vendor credential at all.
