# memory

`geldar-memory`: a read-only MCP server that lets the character recall its own memory files by section.

Run: `geldar-memory --root <dir>` (stdio). One tool, `recall`. A result is cut at `MAX_BYTES` (16384) and says so.

Public surface (`src/index.ts`): `recall`, `MAX_BYTES`, `RecallResult`, `SECTION_FORMS`, `resolveSection`, `createServer`. It uses `path-rule` for the path rule.

Run its tests from the repo root with `./scriptorium.ps1 pnpm vitest run packages/memory` (or `./scriptorium.ps1 check` for everything).
