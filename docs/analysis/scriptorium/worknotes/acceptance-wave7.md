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
