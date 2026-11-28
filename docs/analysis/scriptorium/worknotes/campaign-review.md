# Campaign review (SC-73), 2026-11-10

By a fresh read-only `packet-reviewer`, given the code and the packet but not earlier reviews. Findings are readings plus the checks named; only finding 6 was run. The main session confirmed finding 1 itself earlier (the rc2 release is in this repo; `geldar-player-template` has the tag and no release). Grades: block (fix before the first real tag), fix (next release), note.

## Block

1. **The README's download page has no launcher.** `template/README.md:22-24` sends the Patron to the releases page of `geldar-player-template` and says each release has two files. `release.yml` creates the release in this repo; `publish-template.ts` only commits, tags and pushes. `gh api`: the template repo has the tag `kit-v0.1.0-rc2` and zero releases; this repo has the release with six assets. `tests/template/readme.test.ts:95-99` checks only that the URL is allowed. Fix: attach the launcher to a release of the template repo (decision 44) or change the README link; test the link target.
2. **The README never shows how a player gets its token.** The only route is `--token-file` at `new`; `session.sh:149` reads the token only from that file. The README mentions "token" once, as something not to send, and never mentions `--mock`. Shipped `world.conf` points `new` at the real world, which has no upstream yet (decision 50). **Owner call:** how does a Patron get a token and the exact `new` command? Until the README says so, exit item 1 cannot be met from the README alone.
3. **Windows needs `perl` for no reason.** `geldar-play.ps1:26-28` lists `perl` as needed for five verbs; no PowerShell file uses it (`grep perl launcher/lib/*.ps1` finds only the hint). Git for Windows keeps it off PATH. The README lists no `perl`; `docs/onboarding.md:10` implies Windows does not need it. `core.test.ts:292-296` locks the table in. Confirmed by the main session's run (the launcher stopped with "perl is needed"). Fix: drop it from the PowerShell needs table.
4. **Developer content ships in `template/`.** `template/CLAUDE.md:1` and `template/AGENTS.md:1` start with `<!-- Generated from template-src/instructions.md. Do not edit. -->`. `tests/template/instructions.ts:17,22` requires it; the `forbidden` list in `check.ts:12` cannot catch it. Violates the rule above all (geldar 0014). Fix: emit the header only in `template-src` tooling, add `template-src` and `Do not edit` to `forbidden`.

## Fix (next release)

5. README line 109 ("nothing you run lets you act inside the world") overclaims: `play` leaves the Patron's TTY attached to an interactive session (`session.sh:142`, `session.ps1:162-163`, `session.yml:45-46`); `threat-model.md:43` says "labelled, not prevented". Reword the README.
6. `geldar-play --version` prints `0.1.0`, not `0.1.0-rc2` (hardcoded in both launchers; the archive's `VERSION` is never read; no test ties them). Run by the reviewer in bash and pwsh. Read `VERSION` at runtime or stamp it, and add a release check.
7. The host is bound to `mcp_base` only on non-default ports (decision 42, open): a committed `http://<any public name>/p/<id>` passes `valid_mcp_url` on port 80, `write_allowlist` opens it, and the bearer token goes in clear text. Needs push access to the player repo or a merged upgrade PR. Fix: bind host and scheme to `mcp_base` for every port.
8. `publish-template-workflow.test.ts:57-61` would stay green if the private-key masking were deleted (it finds the first `::add-mask::`, the app id). Assert the key is masked before any use.
9. `SHA256SUMS` lists the archive and `sbom.spdx.json`; the README says download two files and run `shasum -c`, which then fails on the missing SBOM line. Drop the SBOM line or tell the Patron.
10. The Patron's troubleshooting guide (`share/troubleshooting.md`) carries owner and developer options: the `GELDAR_DEV_MCP_URL` recipe, `GELDAR_UNSAFE_IMAGE`, persona rows (P1 says persona stays out of the Patron guide). Split it.

## Note

11. README says the repo is "public by default"; with the shipped blank list `new` refuses without a flag (`private_required`). The example passes `--private`.
12. README says the id limit is 31; the launcher accepts 2 to 39 (31 is the shard limit). A one-letter id is refused and the README does not say so.
13. The README verifies by checksum only (integrity, not origin); the release is cosign-signed but the README never mentions `cosign`.
14. A test fixture has a public-looking IP (`tools/live-check/src/evaluate.test.ts:64`); a repo-rule nit.
15. `ci.yml` checkouts lack `persist-credentials: false` in seven jobs (`contents: read` only; small exposure).
16. `publish-template.yml:81` echoes the multi-line key into an `::add-mask::` line, which is redundant after the per-line masks. The rc2 log has no key, token or header matches. Delete the line.
17. The launcher honours a user-set `GELDAR_SHARE` (a human seam, not an in-world one); undocumented, not sanity-checked beyond existence.

## Checked and clean

All 14 action SHAs exist and match their version comments; Key Vault path (`set +x`, masks before the output write, `az logout`, token via `GIT_CONFIG_*` env); `id-token: write` only on `sign`, `launcher-sign`, the `template` caller and `publish`; `world.conf` read as data and `mcp_port_ok` fails closed; the dev override and persona seed (environment-only, exact shape, one player, unset before the session, links and invisible characters refused); no capped file over 500 lines; no CRLF, symlinks or secret patterns in tracked files; image base and proxy pinned by digest; Squid opens the world host on exactly the owner-set port.

## Revert checks (five, by reading)

Four are real tests (`devworld.bash` two-ids and dev-host cases, `mcpport.bash` host mismatch; `readme.test.ts` owner and developer options, which covers two names only). One is theatre for its claim: the masking test (finding 8).

## Main-session notes

- Findings 1 to 4 should be fixed before the first real tag (`kit-v0.1.0`). Finding 2 needs the owner.
- The mock run's own findings (the `perl` stop confirms finding 3; the missing mention of the Claude login; `--mock` refusing `host.docker.internal`; the `private_list_unset` noise) are in `acceptance-wave7.md`.
