# SC-78 report

Files: template-src/instructions.md (source), template/AGENTS.md and template/CLAUDE.md (regenerated with `node tests/template/instructions.ts --write`), tests/template/knowledge-boundary.test.ts (new).

Deviation: AGENTS.md is generated ("Do not edit") from template-src/instructions.md, and CLAUDE.md shares the body, so the edit went in the source and both outputs were regenerated. No edits to skills; they do not contradict.

Checks: vitest on the new and instructions tests, 12 passed; biome ci clean.

Tests fail without the change by reasoning: removing or altering the paragraph breaks the exact-paragraph equality count of 1; removing either bullet breaks the toContain on that exact line; any of the audience words in a template markdown file matches the regex. Without the template edit the three per-file tests fail on both files.

Late edit: I first wrote the source edit to the main checkout by mistake (relative path); I reverted it there with git checkout of that one file before redoing it in the worktree.