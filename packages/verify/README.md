# verify

`geldar-verify`: the host's gate on a session bundle. It runs with no network and decides whether the launcher may fetch the bundle.

Run: `geldar-verify --bundle <file> --start <40-hex sha> --branch <name> --mode play|setup --player-id <id>`. Stdout is one JSON line `{"ok":bool,"reasons":[...]}`. Exit 0 accepted, 1 rejected, 2 bad arguments.

Checks: size cap `MAX_BUNDLE_BYTES` (50 MiB), exactly one ref `refs/heads/<branch>`, at most `MAX_COMMITS` (2000), fast-forward from START with no merges, per-commit and net diffs (`--no-renames`) against `path-rule`, regular `100644` blobs only, author and committer equal to the noreply identity, identity file unchanged in play mode. Git runs with `--no-replace-objects` and no attributes file (`run-git.ts`).

Stable reason ids (`REASONS`): `bad_arguments`, `verify_error`, `bundle_too_large`, `bundle_unreadable`, `bundle_refs_unexpected`, `bundle_fetch_failed`, `too_many_commits`, `not_fast_forward`, `merge_commit`, `identity_mismatch`, `identity_changed`, `path_not_allowed`, `symlink_not_allowed`, `gitlink_not_allowed`, `executable_not_allowed`, `bad_mode`.

Public surface (`src/index.ts`): `verify`, `parseVerifyArgs`, `VerifyInput`, `REASONS`, `Reason`, `Verdict`, `verdict`, `MAX_BUNDLE_BYTES`, `MAX_COMMITS`.

Run `geldar-verify run-summary` with a `claude -p --output-format stream-json --verbose` transcript on stdin: stdout is one JSON line `{cost, turns, is_error, last_text, result_seen, tools}` (no tool inputs or results). Exit 0 always, 2 for any option.

Run its tests from the repo root with `./scriptorium.ps1 pnpm vitest run packages/verify` (or `./scriptorium.ps1 check` for everything).
