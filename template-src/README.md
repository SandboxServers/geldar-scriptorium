# template-src

This folder is for developers and is not shipped. The publish step copies only `template/` (see `tools/release/src/publish-template.ts`).

`template/CLAUDE.md` and `template/AGENTS.md` are generated. Edit `template-src/instructions.md`, then run `node tests/template/instructions.ts --write`. `node tests/template/check.ts` fails if either file differs from the generator output.
