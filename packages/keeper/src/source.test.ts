import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { fetchUpstream } from './upstream.ts';

const here = dirname(fileURLToPath(import.meta.url));
const shipped = readdirSync(here).filter(
  (name) => name.endsWith('.ts') && !name.includes('.test.') && !name.includes('.fixture.'),
);

test('the shipped source has no force, mirror or delete flag and no plus refspec', () => {
  const forbidden = ['--force', '--force-with-lease', '+refs', '--mirror', '--delete', ' -f '];
  for (const name of shipped) {
    const text = readFileSync(join(here, name), 'utf8');
    for (const word of forbidden) expect(text, `${name} has ${word}`).not.toContain(word);
  }
});

test('protocol.file.allow=user appears once, for the workspace fetch', () => {
  const count = shipped
    .map(
      (name) => readFileSync(join(here, name), 'utf8').split('protocol.file.allow=user').length - 1,
    )
    .reduce((a, b) => a + b, 0);
  expect(count).toBe(1);
});

test('the upstream hook point does nothing yet (SC-167)', async () => {
  expect(await fetchUpstream()).toBeNull();
});
