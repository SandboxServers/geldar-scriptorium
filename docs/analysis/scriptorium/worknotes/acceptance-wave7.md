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

## Mock-world run on the owner's Windows PC (SC-72a, partial; not a clean machine)

2026-11-10. rc2 launcher from the release, the pinned mock image (`1bf80fac...`) on a loopback port, the rc2 kit image pulled anonymously from GHCR, real `gh` (private repo `player-mock-ash`), a real Claude login (Google sign-in in the owner's browser, then the CLI's code step, done by the main session at the owner's direction; credentials are in the player's CLI volume only). The world was reached through `GELDAR_DEV_MCP_URL`, because `--mock` refuses `host.docker.internal`.

| Step | Result |
|---|---|
| Install: checksum, unpack, `--version` | Works. Prints `0.1.0` (finding 1). |
| `new mock-ash --private --mock <name> --token-file` | Needed `perl` on PATH (finding 3 of the campaign review). Then created the repo and the clone. Printed `private_list_unset` despite `--private`. |
| Claude login | Needed an interactive login (README silent, finding 2 above). |
| `setup` | First run: the CLI refused the workspace's 21 allow entries ("workspace has not been trusted") until `hasTrustDialogAccepted` was set for `/player` in the CLI home. After that, a one-turn interview per run; with all answers in one message it wrote identity, summary and goals and saved one commit, "birth: Ash". |
| `play` (non-TTY, one run, 64 s) | The player met two characters, took damage, and ended its reply with "I'm stopping here until you tell me to continue". It never slept or reflected, so the launcher saved a fallback commit "session end: unsaved memory". One cycle pair, not a day. No `act` or `eat` tool was available to it. |
| Three in-game days, host-clone-unchanged check, `upgrade` | Not done (see below). |
| Usage and turn counts (SC-70c) | Not measured. |

Findings from this run:

3. **block (new, for the first real run):** with a fresh CLI home the workspace is untrusted, so the CLI ignores the player's whole `permissions.allow` list. Under `defaultMode: dontAsk` the player would be refused its tools. Nothing in the kit seeds `hasTrustDialogAccepted`, and the end-to-end tests use a stub CLI, so CI cannot see it. In a TTY a Patron might get the trust dialog and accept it; the README does not mention it. Fix: seed the trust entry for `/player` in the CLI home (the launcher owns that volume), and test it with the real CLI.
4. **fix:** the CLI prints a "Write(...) is not matched ... use Edit" warning for each Write rule in the player settings and in managed policy. The matching Edit rules exist, so there is no gap, but every session starts with a screenful of warnings. Drop the Write rules.
5. **fix:** `setup` and `play` are written for a person at a terminal. Without a TTY, `setup` takes one answer per run, and `play` ends with the player asking the human what to do. The three-day acceptance needs a TTY, or a session mode that keeps going until `sleep`.
6. **note:** the setup commit reported three hook files as unsaved (`.claude/hooks/*.sh`); the player said it did not touch them. Check that the files are tracked with the right mode in the template.
7. **note:** the mock offered no `act` or `eat` tool to the player on the `dawn` scenario. Confirm with geldar whether the mock is meant to.

Why the run stops here: a meaningful three-day run needs an interactive terminal and a decision on findings 3 and 5. The mock container and its project were removed; the repo `player-mock-ash` and the clone remain for the next attempt.
