# stub-cli

A scripted stand-in for the `claude` CLI, for deterministic CI. **CI only: it is never shipped** in the kit image or the template.

Run: `claude --scenario <file.jsonl>` or set `GELDAR_STUB_SCENARIO`; other arguments (such as `--settings`) are ignored. The working directory is the workspace root. Each scenario line is a step: `call` (server, tool, args, expect), `write`, `append` or `delete`. It starts the `geldar-memory` and `geldar-git` servers as the session would. Exit 0 if every step passed, 1 on a failure, 2 with no scenario. Scenarios live in `src/scenarios/` (`birth`, `reflect`).

Public surface (`src/index.ts`): `runScenario`, `parseScenario`, `Step`, the MCP config helpers. `GELDAR_MODE` set in the run options reaches the servers.

Run its tests from the repo root with `./scriptorium.ps1 pnpm vitest run packages/stub-cli` (or `./scriptorium.ps1 check` for everything).
