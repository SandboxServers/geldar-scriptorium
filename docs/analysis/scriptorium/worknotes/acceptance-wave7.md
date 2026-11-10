# Acceptance notes, wave 7

## Smoke check of the published rc2 launcher (not SC-72a)

Done by the main session on the owner's Windows PC, not a clean machine, so it does not count for exit item 4. It only shows the release is usable.

- Downloaded `geldar-play-0.1.0-rc2.tar.gz` and `SHA256SUMS` from the `kit-v0.1.0-rc2` release into an empty folder.
- The archive hash matched the line in `SHA256SUMS`.
- `tar -xzf` unpacked it to `geldar-play-0.1.0-rc2/`.
- `geldar-play.ps1 --version` printed `geldar-play 0.1.0`.

Findings:

1. **fix (next release):** `--version` prints `0.1.0`, not `0.1.0-rc2`. A Patron cannot tell a candidate from the final release. The README tells them to run `geldar-play --version` to check the install.

Not done, and why: SC-72a/b need a clean machine, the mock world, a GitHub repo created by `new`, and Claude subscription use for `play`. Those are owner-run (D6). SC-72c needs the geldar token files and persona export.
