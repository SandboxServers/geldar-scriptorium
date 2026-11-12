# Launcher hardening checklist

Each requirement is one line. Tests are written in SC-60.

## Before the session

- H-01: The host clone is clean (`git status --porcelain --untracked-files=all` is empty), or stop. Test: `launcher/test/hostile/h01-clean.test.ts`
- H-02: Run `git pull --ff-only`, or stop with the reason. Test: `launcher/test/hostile/h02-pull.test.ts`
- H-03: START is stored in the launcher state folder (`<state>/<player_id>/start`), never read from a workspace. Test: `launcher/test/hostile/h03-start.test.ts`
  Note (case collision): the host re-check refuses a session path whose case-folded form equals a different spelling of a START-tree path, as a file or as a directory prefix (for example `memory/Host-Note.md/x.md` over START's `memory/host-note.md`), because a case-insensitive host would turn the file into a directory. Tests: `launcher/test/hostile/collision.bash.test.ts`, `collision.pwsh.test.ts`; reason `recheck_case_collision`.
- H-04: The kit export is `git archive START` of the kit paths into a launcher temp folder, never the working tree. Test: `launcher/test/hostile/h04-export.test.ts`
  Residual risk (REAL, not fixed): `git archive` honours `export-ignore` and `export-subst` from START's own `.gitattributes`, so a kit file can be silently missing or rewritten in the export (reproduced: `CLAUDE.md` missing). The case is marked `it.fails`. Proposed fix: write blobs from `ls-tree` and `cat-file`, or verify blob ids after extraction, in `launcher/lib/prepare.sh` and `prepare.ps1`.
- H-05: The workspace is `git clone --no-local --no-hardlinks -c core.autocrlf=false`, then `git remote remove origin`. Never use `--shared` or alternates. Assert that no host path is left in the workspace's `.git/config`. Test: `launcher/test/hostile/h05-clone.test.ts`

  Note (N4): state layout under `<state>/<id>`: directories 0700, files 0600 or 0700; `pub/` is 0755 and holds only `allowlist-world.txt` and `allowlist-world-ports.txt` (both 0644); `export/` is world readable (`a+rX`) because the session container reads the kit overlays as uid 1000. Tests: `launcher/test/hostile/statedir.bash.test.ts`, `statedir.pwsh.test.ts`. Permission cases run only on POSIX; on Windows the state is under `%LOCALAPPDATA%` with a user-private ACL and they are skipped.
  Residual risk (open): the helper container (`workspace-init`) mounts `<state>/<id>/session` (0700, `start.bundle` 0600) as uid 1000 with all capabilities dropped; on a Linux host whose uid is not 1000 it may not be able to read them. The card was followed; the owner decision is open (follow-up 11). Not verified locally; CI decides.
## During the session

- H-06: The session container mounts the workspace, with the kit paths overlaid read-only from the export. No other host folders, except that the run mode (SC-121) mounts ONE host file read-only at `/run-input/prompt.txt` (the prompt), whose path is validated like the other mount paths; no Docker socket, no git or cloud credentials. Test: `launcher/test/hostile/h06-mounts.test.ts`
- H-07: The CLI home is a volume per player and vendor, with auto memory off. Test: `launcher/test/hostile/h07-clivolume.test.ts`
- H-08: The session container is on an internal network with no DNS. Egress goes only through the proxy allowlist, which is one host and exactly one port: the URL's effective port (the explicit port, else 80 for http and 443 for https). Test: `launcher/test/hostile/h08-allowlist.test.ts`
  Implemented in: image/compose/session.yml, image/proxy/squid.conf. Guarded by tests/image/proxy-config.test.ts and tests/image/egress.test.ts. Those run only where Docker is available.

## After the session

- H-09: The bundle is made by a separate `--rm --network none` container, started after the session container stopped, with no CLI volume. Test: `launcher/test/hostile/h09-bundle.test.ts`
- H-10: The bundle is at most 50 MiB and is copied to launcher state before verification. Test: `launcher/test/hostile/h10-size.test.ts`
  Implemented in: verify/src/verify.ts (`MAX_BUNDLE_BYTES`, reason `bundle_too_large`). The copy to launcher state is launcher work.
  Per-blob cap: `MAX_BLOB_BYTES` (2 MiB) in verify/src/verify.ts, checked from object headers without inflating; an oversize blob gives `bundle_too_large`. Guarded by verify.test.ts and the h10 case.
- H-11: `geldar-verify` (network none) accepts only if all of these hold. Test: `launcher/test/hostile/h11-gate.test.ts`
  - exactly one ref, `refs/heads/<branch>`;
  - a fast-forward from START, with no merge commits;
  - each commit's diff and the net diff, both with `--no-renames`, touch only allowed paths;
  - only mode `100644` blobs;
  - every path matches `^(memory|skills)/[A-Za-z0-9._/-]+\.(md|js|json)$` with no path component starting with `.`, plus `memory/people/.gitkeep` and `memory/journal/current.md`;
  - no Windows-reserved names;
  - author and committer equal the player's noreply identity;
  - `memory/identity.md` is unchanged in play mode.
  Implemented in: verify/src/verify.ts, verify/src/history.ts, verify/src/reasons.ts, verify/src/args.ts, with the rule from path-rule/src/path-rule.ts and path-rule/src/identity.ts. Guarded by the tests beside them (verify.test.ts, history.test.ts, reasons.test.ts, cli.test.ts).
- H-12: The host fetches with `git -c fetch.fsckObjects=true -c transfer.fsckObjects=true fetch --no-tags <bundle> refs/heads/<branch>:refs/launcher/incoming`. Test: `launcher/test/hostile/h12-fsck.test.ts`
- H-13: The host independently re-checks the ancestry and the net `--no-renames` path list. Test: `launcher/test/hostile/h13-recheck.test.ts`
  Implemented in: verify/src/history.ts (the same per-commit and net checks; not exported from the package yet, so the host re-check cannot import it). The host-side call is launcher work.
- H-14: The verified private ref is pushed to origin by its verified SHA (`git push origin <sha>:refs/heads/<branch>`, never `--force`); only after the push succeeds is the host branch updated, and only with `merge --ff-only` (geldar 0011: on any failure the human's branch stays where it was). Test: `launcher/test/hostile/h14-push.test.ts`
- H-15: The workspace and bundle are deleted only after a successful push. On failure, keep both, leave the host branch as it is, and report. Test: `launcher/test/hostile/h15-cleanup.test.ts`
- H-16: Control characters are stripped from any bundle-derived text before printing. Test: `launcher/test/hostile/h16-print.test.ts`
  Residual risk (REAL, low, not fixed): `sanitize` strips C0, DEL and C1 only; bidi overrides such as `U+202E` and zero-width format characters pass. The committed case asserts today's survival. Fix owner: `launcher/lib/common.sh`, `common.ps1`.
- H-17: Crash recovery uses the stored START only. Test: `launcher/test/hostile/h17-recovery.test.ts`

## Anywhere

- H-18: Hooks exit at once without the kit marker. Test: `tests/hostile/h18-hooks.test.ts`
- H-19: The image is pinned by digest from `player.json`. The launcher never reads container settings from the repo. Test: `launcher/test/hostile/h19-image.test.ts`. Implemented in: SC-50b and SC-50c; documented deviation: a digest-pinned `GELDAR_KIT_IMAGE` (any registry) overrides `player.json`, and a tag form needs two internal variables and prints `UNSAFE:` (wave 5 decision 5).
- H-20: Reads of the CLI home and credentials are denied (managed settings) and tested. Test: `tests/hostile/h20-denies.test.ts`
  Implemented in: image/settings/managed.json (installed at the CLI managed path by image/Dockerfile). Guarded by tests/image/settings.test.ts (rules present) and tests/image/cli.test.ts (the pinned CLI accepts them). Whether a deny blocks a model read is not tested in CI (D-SC-01); it is the local-only live check in SC-62. See image/README.md.
  - Known gap: a background process of the agent can swap an allowed path for a symlink to a readable file between the commit tool's path check and its hashing step; T-20 either tests the mitigation or records the residual risk.

  The settings contain deny rules for the CLI home and `.credentials.json`; every other spelling of a credential path is covered only by `blockReadsOutsideWorkingDirectories` plus the live check in SC-62, which has not run yet.
  Symlink swap (the known gap above): closed in `packages/git` by SC-60j (`O_NOFOLLOW` open, `fstat` regular file, device and inode compared, 1 MiB cap); its Linux-only cases run in CI.
- The adopt path (`new --repo`) writes only into a repository it verified: it exists, has the requested visibility, and holds only README.md, LICENSE and .gitignore at the top level. It never force-pushes. The existing repository is checked twice: by name through gh, and by `git ls-tree` in its clone (plain files named README.md, LICENSE or .gitignore only, so a link cannot carry the copy outside the clone); each destination is removed before it is written. The template is the newest non-prerelease `kit-v*` tag, found as `upgrade` finds it, cloned shallow with hooks off and object checks on, with no checkout until its file list is checked (modes 100644 or 100755, at most 2000 files and 20 MB, no `..`, `.` or `.git` path part in any letter case). With no kit tag the adopt is refused (`template_unpinned`). Any failure after the clone says `adopt_failed`, because a cut-off push may already have reached the remote. Test: `launcher/test/new.test.ts`

## Test seams

Every `GELDAR_*` name the launchers read is classified in `launcher/test/hostile/seams.json` (sorted, unique; `seams.test.ts` scans the sources and fails on an unclassified name).

- Gate: `GELDAR_INTERNAL`. Without it, gated variables have no effect.
- Gated (read through `gp_env` or `Get-GatedEnv`): `GELDAR_EXTRA_COMPOSE`, `GELDAR_HELPER_TIMEOUT_SEC`, `GELDAR_KEEP_PROXY_LOG`, `GELDAR_PRIVATE_SHARDS_TEST`, `GELDAR_RUN_DRY` (a fake cycle with no container), `GELDAR_RUN_DRY_CMD`, `GELDAR_RUN_NOW`, `GELDAR_RUN_SLEEP`, `GELDAR_RUN_SUMMARY_CMD`, `GELDAR_SLEEP`, `GELDAR_STUB_*`, `GELDAR_TEMPLATE_URL`, `GELDAR_TEST_FORCE_FF_FAIL`, `GELDAR_TEST_HOOK_AFTER_CLEAN`, `GELDAR_TMUX`, `GELDAR_TOOL_PATH`, `GELDAR_UNSAFE_IMAGE`, `GELDAR_WT`.
- Human-environment seams (ungated by design): `GELDAR_DOCKER`, `GELDAR_GH`, `GELDAR_GIT`, `GELDAR_KIT_IMAGE` (digest-pinned only), `GELDAR_PLAYERS_DIR`, `GELDAR_RUN_DAILY_CAP_USD`, `GELDAR_RUN_DELAY`, `GELDAR_RUN_FAST_SEC`, `GELDAR_RUN_MAX_DELAY`, `GELDAR_RUN_MAX_FAILS`, `GELDAR_RUN_MAX_TURNS`, `GELDAR_RUN_MODEL`, `GELDAR_RUN_PROMPT_FILE`, `GELDAR_SHARE`, `GELDAR_STATE_DIR`. `GELDAR_SHARE` selects the compose files, so whoever controls the human's environment controls them; that is the human's own machine and is accepted (N8).
- Container variables (set by the launcher, not read from the host): `GELDAR_BRANCH`, `GELDAR_CLI_HOME`, `GELDAR_GID`, `GELDAR_MCP_TOKEN`, `GELDAR_MCP_URL`, `GELDAR_MODE`, `GELDAR_UID`, `GELDAR_WORKSPACE`, `GELDAR_WORLD_ALLOWLIST`, `GELDAR_WORLD_PORTS`.

## Notes by area

- N3 (MCP URL): the world URL is refused when its host is a single label, a private or local name (`localhost`, `host.docker.internal`, and suffixes such as `.local`, `.internal`, `.lan`, `.home.arpa`, `.invalid`), or has an empty label. Tests: `launcher/test/hostile/mcpurl.bash.test.ts`, `mcpurl.pwsh.test.ts`. Open: the bash coder also refused a `..` path segment, but the shared table has no row for it and the PowerShell side was flagged for the same refusal; confirm both launchers agree.
- N6 (`.cmd` shims, Windows): `.cmd` and `.bat` shims start through a quoting helper for cmd.exe, not `ArgumentList`, so `& % ^ | < > !` in an argument are not interpreted. Tests: `launcher/test/hostile/cmdshim.test.ts`, `cmdshim-git.test.ts` (win32 only). Residual: one late edit to `common.ps1` was not re-run, and `Invoke-Docker` through a shim is buffered, not streamed; CI decides.
- N9 (run mode, SC-121 and SC-122): the continuation text carries the character's own earlier output as untrusted text. The supervisor takes it from the summary of the previous stream, removes control characters (C0, DEL, C1, so no ESC), replaces double quotes with single quotes, cuts it to 1500 characters, and puts it inside quotes in one sentence; it is never an instruction line. Test: `launcher/test/run.bash.test.ts` ("builds the continuation text from the last words, quoted, cut and cleaned": an instruction line, ESC bytes, a 10 KB tail and double quotes). The run state directory `<state>/<id>/run` is 0700 (a symlink there is refused) and its files are 0600. `run/STOP` (first line `manual` or `auto:`) and the lock folder `run/lock` (a pid file) are the only control files; a lock whose pid does not exist is cleared, and a start with an `auto:` STOP refuses. The daily cap (`GELDAR_RUN_DAILY_CAP_USD`) is a cost control, not a security boundary. The supervisor never skips the post-session gate or the commit, and a held session writes an `auto:` STOP.
- Cases that run only in CI: Linux-only permission and symlink cases, the 11 H-18 cases that need `jq`, and heavy cases (2001 commits, 10 000 refs) that timed out locally under load.

## Implemented in (bash launcher)

- H-01 to H-05: launcher/lib/prepare.sh. H-06 to H-08, H-19: launcher/lib/session.sh, launcher/lib/player.sh.
- H-09, H-10, H-11 (gate call), H-16: launcher/lib/bundle.sh. H-10 and H-13 on the launcher side: launcher/lib/bundle.sh and launcher/lib/recheck.sh.
- H-12, H-14, H-15, H-17: launcher/lib/finish.sh (`finish_session`), with `play` in launcher/geldar-play. Guarded by launcher/test/finish.test.ts.
