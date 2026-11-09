# Launcher hardening checklist

Each requirement is one line. Tests are written in SC-60.

## Before the session

- H-01: The host clone is clean (`git status --porcelain --untracked-files=all` is empty), or stop. Test: T-01
- H-02: Run `git pull --ff-only`, or stop with the reason. Test: T-02
- H-03: START is stored in the launcher state folder (`<state>/<player_id>/start`), never read from a workspace. Test: T-03
- H-04: The kit export is `git archive START` of the kit paths into a launcher temp folder, never the working tree. Test: T-04
- H-05: The workspace is `git clone --no-local --no-hardlinks -c core.autocrlf=false`, then `git remote remove origin`. Never use `--shared` or alternates. Assert that no host path is left in the workspace's `.git/config`. Test: T-05

## During the session

- H-06: The session container mounts the workspace, with the kit paths overlaid read-only from the export. No other host folders, no Docker socket, no git or cloud credentials. Test: T-06
- H-07: The CLI home is a volume per player and vendor, with auto memory off. Test: T-07
- H-08: The session container is on an internal network with no DNS. Egress goes only through the proxy allowlist. Test: T-08
  Implemented in: image/compose/session.yml, image/proxy/squid.conf. Guarded by tests/image/proxy-config.test.ts and tests/image/egress.test.ts. Those run only where Docker is available.

## After the session

- H-09: The bundle is made by a separate `--rm --network none` container, started after the session container stopped, with no CLI volume. Test: T-09
- H-10: The bundle is at most 50 MiB and is copied to launcher state before verification. Test: T-10
  Implemented in: verify/src/verify.ts (`MAX_BUNDLE_BYTES`, reason `bundle_too_large`). The copy to launcher state is launcher work.
- H-11: `geldar-verify` (network none) accepts only if all of these hold. Test: T-11
  - exactly one ref, `refs/heads/<branch>`;
  - a fast-forward from START, with no merge commits;
  - each commit's diff and the net diff, both with `--no-renames`, touch only allowed paths;
  - only mode `100644` blobs;
  - every path matches `^(memory|skills)/[A-Za-z0-9._/-]+\.(md|js|json)$` with no path component starting with `.`, plus `memory/people/.gitkeep` and `memory/journal/current.md`;
  - no Windows-reserved names;
  - author and committer equal the player's noreply identity;
  - `memory/identity.md` is unchanged in play mode.
  Implemented in: verify/src/verify.ts, verify/src/history.ts, verify/src/reasons.ts, verify/src/args.ts, with the rule from path-rule/src/path-rule.ts and path-rule/src/identity.ts. Guarded by the tests beside them (verify.test.ts, history.test.ts, reasons.test.ts, cli.test.ts).
- H-12: The host fetches with `git -c fetch.fsckObjects=true -c transfer.fsckObjects=true fetch --no-tags <bundle> refs/heads/<branch>:refs/launcher/incoming`. Test: T-12
- H-13: The host independently re-checks the ancestry and the net `--no-renames` path list. Test: T-13
  Implemented in: verify/src/history.ts (the same per-commit and net checks; not exported from the package yet, so the host re-check cannot import it). The host-side call is launcher work.
- H-14: The verified private ref is pushed to origin by its verified SHA (`git push origin <sha>:refs/heads/<branch>`, never `--force`); only after the push succeeds is the host branch updated, and only with `merge --ff-only` (geldar 0011: on any failure the human's branch stays where it was). Test: T-14
- H-15: The workspace and bundle are deleted only after a successful push. On failure, keep both, leave the host branch as it is, and report. Test: T-15
- H-16: Control characters are stripped from any bundle-derived text before printing. Test: T-16
- H-17: Crash recovery uses the stored START only. Test: T-17

## Anywhere

- H-18: Hooks exit at once without the kit marker. Test: T-18
- H-19: The image is pinned by digest from `player.json`. The launcher never reads container settings from the repo. Test: T-19
- H-20: Reads of the CLI home and credentials are denied (managed settings) and tested. Test: T-20
  Implemented in: image/settings/managed.json (installed at the CLI managed path by image/Dockerfile). Guarded by tests/image/settings.test.ts (rules present) and tests/image/cli.test.ts (the pinned CLI accepts them). Whether a deny blocks a model read is not tested in CI (D-SC-01); it is the local-only live check in SC-62. See image/README.md.
  - Known gap: a background process of the agent can swap an allowed path for a symlink to a readable file between the commit tool's path check and its hashing step; T-20 either tests the mitigation or records the residual risk.
