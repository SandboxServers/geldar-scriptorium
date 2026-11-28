import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { sshTransport } from './transport.ts';
import { makeWorld } from './world.fixture.ts';

// GitHub's published SSH key fingerprints (SHA256).
const PUBLISHED: Record<string, string> = {
  'ssh-ed25519': 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU',
  'ecdsa-sha2-nistp256': 'SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM',
  'ssh-rsa': 'SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s',
};

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'known_hosts');
const entries = readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .filter((line) => line !== '' && !line.startsWith('#'))
  .map((line) => line.split(' '));

function fingerprint(base64: string): string {
  const digest = createHash('sha256').update(Buffer.from(base64, 'base64')).digest('base64');
  return `SHA256:${digest.replace(/=+$/, '')}`;
}

for (const type of ['ssh-ed25519', 'ecdsa-sha2-nistp256']) {
  test(`the pinned ${type} key matches GitHub's published fingerprint`, () => {
    const entry = entries.find((parts) => parts[1] === type);
    expect(entry?.[0]).toBe('[ssh.github.com]:443');
    expect(fingerprint(entry?.[2] ?? '')).toBe(PUBLISHED[type]);
  });
}

test("the pinned ssh-rsa key matches GitHub's published fingerprint", () => {
  const entry = entries.find((parts) => parts[1] === 'ssh-rsa');
  expect(fingerprint(entry?.[2] ?? '')).toBe(PUBLISHED['ssh-rsa']);
});

test('the SSH command pins the key, the host file and the CONNECT helper, and holds no key text', () => {
  const w = makeWorld();
  try {
    const command = sshTransport(w.cfg).env.GIT_SSH_COMMAND ?? '';
    expect(command).toContain(`-i '${w.cfg.key}'`);
    for (const option of ['IdentitiesOnly=yes', 'StrictHostKeyChecking=yes', 'BatchMode=yes']) {
      expect(command).toContain(`-o ${option}`);
    }
    expect(command).toContain(`UserKnownHostsFile=${w.cfg.knownHosts}`);
    expect(command).toContain('ProxyCommand=geldar-keeper-connect %h %p');
    expect(sshTransport(w.cfg).config).toEqual(['protocol.file.allow=never']);
  } finally {
    w.cleanup();
  }
});
