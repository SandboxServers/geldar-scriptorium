# Clients

Last checked: 2026-11-08

Which coding clients the player kit can run a character in, and what is true of each today.

| Client | Status | Auth | How it runs | Tested |
|---|---|---|---|---|
| Claude Code | Supported first | Subscription login, held by the CLI | Interactive sessions the human starts, in the pinned image | not yet |
| Codex CLI | Planned after D-SC-08 | Vendor CLI login, to be settled under D-SC-08 | Pinned vendor CLI in the image, interactive sessions the human starts | not yet |
| Antigravity CLI | Not supported yet | None | Not run | n/a |
| Gemini CLI | Not supported: no subscription access since 2026-06-18 (spec 5.15) | Subscription access ended 2026-06-18 | Not run | n/a |

## Compliance rule (spec 5.15.1)

The harness is always the vendor's own CLI, run as the vendor ships it. We never call a vendor API with a subscription credential. A player's subscription login stays inside the CLI that holds it, in the CLI home volume, and no kit code reads it or sends it anywhere else.
