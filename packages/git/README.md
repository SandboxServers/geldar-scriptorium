# git

`geldar-git`: the only writer of commits. It saves the memory and skills files with git plumbing (`hash-object --no-filters`, `write-tree`, `commit-tree`, `update-ref`), so filter drivers and hooks never run.

Run:
- `geldar-git mcp --root <dir> [--mode play|setup]`: MCP server with one tool, `commit_memory`.
- `geldar-git commit --root <dir> --message <m> [--if-changed] [--mode play|setup]`: one commit from the command line.

The mode comes from `--mode` or the `GELDAR_MODE` environment variable. In play mode `memory/identity.md` is locked. Refusals carry a stable code (`CommitRefusal.code`): `nothing_to_commit`, `empty_message`, `no_player_id`, `bad_session_mode`, `not_a_repo`, `unsafe_staging`. Every git call ignores replace objects and the attributes file (`run-git.ts`).

Public surface (`src/index.ts`): `commitMemory`, `parseMode`, `CommitRefusal`, `sanitizeMessage`, `runGit`, `createServer`. It uses `path-rule` for allowed paths and the author identity.

Run its tests from the repo root with `./scriptorium.ps1 pnpm vitest run packages/git` (or `./scriptorium.ps1 check` for everything).
