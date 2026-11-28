# Acceptance notes, wave 7

## Smoke check of the published rc2 launcher (not SC-72a)

Done by the main session on the owner's Windows PC, not a clean machine (decision 49 dropped that requirement; tester feedback replaces it). It only shows the release is usable.

- Downloaded `geldar-play-0.1.0-rc2.tar.gz` and `SHA256SUMS` from the `kit-v0.1.0-rc2` release into an empty folder.
- The archive hash matched the line in `SHA256SUMS`.
- `tar -xzf` unpacked it to `geldar-play-0.1.0-rc2/`.
- `geldar-play.ps1 --version` printed `geldar-play 0.1.0`.

Findings:

1. **fix (next release):** `--version` prints `0.1.0`, not `0.1.0-rc2`. A Patron cannot tell a candidate from the final release. The README tells them to run `geldar-play --version` to check the install.
2. **fix (next release):** the template README and `docs/onboarding.md` never say that the player's Claude Code needs a login. The launcher unsets `ANTHROPIC_API_KEY` and passes no token, and keeps the CLI's login in the per-player volume `geldar-cli-<id>-claude`, so the first `setup` must be an interactive login by the Patron. A Patron following only the README would not know to expect it, what it grants (their own Claude subscription, inside the player's container) or how to revoke it. Needs a README step and a troubleshooting entry. Not verified by a run; read from `launcher/lib/session.sh`.

Not done, and why: SC-72a/b need the mock world, a GitHub repo created by `new`, and an interactive Claude login in the player's container for `setup` and `play`. The login is a consent on the owner's own account and needs a terminal session, so the main session did not do it (decision 51). Those are owner-run (D6). SC-72c needs the geldar token files and persona export.

## First ranger, first real session (ag-jason-01, 2026-11-10)

rc3 launcher from the template repo's release page, the rc3 kit image, the real MCP built from geldar `main` on the owner's desktop through the dev seam, a real Claude Code CLI (2.1.310, Haiku, low effort) in a real terminal window (a TTY), real `gh`, the owner's Claude login done through the browser at the owner's direction. The repo `player-ag-jason-01` is public with the approved persona.

Result: the world connection works end to end. `recall` and `status` answered, the Body woke on the first call, `wait` ran long polls, the player wrote a journal line and the launcher saved and pushed it. He could not act: no `act` tool (see finding 11).

Findings:

8. **block:** the project's three MCP servers (`.mcp.json`) sit at "Pending approval" in every session, and a dialog asks for approval. The player's workspace volume is recreated each session, so an approval cannot persist; in a TTY a Patron would have to approve at every start, and a headless session never loads the tools. Fix: pre-enable them in the kit's own settings (`enabledMcpjsonServers` in the settings file the launcher passes, or `enableAllProjectMcpServers`). The kit's config, not the player's, must carry it.
9. **block:** logging in with a claude.ai account loads that account's connectors (Gmail, Calendar, Drive, Docs) into the player's session. The egress proxy stopped them (403), but the player saw them in its tool list and mentioned one. Fix: `ENABLE_CLAUDEAI_MCP_SERVERS=false` in the session environment, with a test.
10. **block:** the CLI defers MCP tools behind a tool-search step once the combined list is large; the player twice searched and found only unrelated tools (the harness's own `SendMessage` and `RemoteTrigger`). Fix: `ENABLE_TOOL_SEARCH=false` for sessions. Also check why the player can see those unrelated tools at all.
11. **block (geldar side):** `act` and `write_book` never reach the CLI. The server advertises 14 tools, but only `act` (top-level `anyOf`) and `write_book` (top-level `oneOf`) have a combinator at the top of their input schema, and Claude Code drops such tools silently. `/mcp` shows 12. Reported to geldar; the fix is a plain object at the top level of those two schemas, plus a contract test.
12. **fix:** a fresh CLI home shows first-run screens (theme picker, security notes) before the player can start. The kit entrypoint (trust seeding) should also set `hasCompletedOnboarding` and a theme.
13. **fix:** `new` can clone an empty repository: `gh repo create --template` returns before GitHub has filled the repo, and the retry loop accepts any clone with a `.git` folder. Jason's first `new` left a public repo with a template commit and an empty local clone, and the next `new` refused (`repo_exists`). Fix: retry until the clone has a commit; keep the `repo_exists` message but say how to recover.
14. **note (geldar side):** the first `status` calls after a Body wake return `body_unavailable` for 2 to 3 seconds; the player gave up after two tries. A friendlier tool message was queued by geldar.
15. **note:** `claude --resume` hints print at the end of every session; harmless.

Recovery used: the launcher reads its `gh` command from `GELDAR_GH`; a shim that skips only `repo create` let `new` finish its own steps (persona, commit, token) against the existing repo.
