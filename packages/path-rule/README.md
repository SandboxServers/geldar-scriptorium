# path-rule

The shared path rule, session modes and noreply git identity. memory, git and erify all import it, so the rules cannot drift apart.

Public surface (`src/index.ts`): `isAllowedPath(path, mode)`, `Mode` (`play` or `setup`), `IDENTITY_PATH`, `isIdentityPath`, `identityLocked(mode)`, `isValidPlayerId`, `noreplyIdentity(playerId)`, `GitIdentity`.

Run its tests from the repo root with `pnpm vitest run packages/path-rule` (or `./scriptorium.ps1 check` for everything).