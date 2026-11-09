/** `files <group>` prints the group's test files for `vitest run`; `list` prints file and group; `check` verifies the split. */
import { existsSync } from 'node:fs';
import { assign, GROUPS, listTestFiles } from './ci-groups.ts';

const [command, name] = process.argv.slice(2);
const files = listTestFiles().filter((file) => existsSync(file));
const groups = assign(files);

if (command === 'files' && name !== undefined && groups.has(name)) {
  console.log((groups.get(name) ?? []).join('\n'));
} else if (command === 'list') {
  for (const [group, members] of groups)
    for (const file of members) console.log(`${group}\t${file}`);
} else if (command === 'check') {
  const empty = GROUPS.filter((group) => (groups.get(group.name) ?? []).length === 0);
  const total = [...groups.values()].reduce((sum, members) => sum + members.length, 0);
  for (const group of empty) console.log(`error: ci group ${group.name} has no test files`);
  if (total !== files.length) console.log('error: a test file is in no group or in two');
  console.log(`ci groups: ${files.length} test files in ${groups.size} groups`);
  process.exitCode = empty.length > 0 || total !== files.length ? 1 : 0;
} else {
  console.error(
    `usage: ci-groups-cli.ts files <${GROUPS.map((group) => group.name).join('|')}> | list | check`,
  );
  process.exitCode = 2;
}
