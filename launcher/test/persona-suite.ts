import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { bashExe, bashPath, git, type Launcher, makeWorld, repoRoot, run } from './harness.ts';

// The shared persona-dir cases (SC-74a). The bash and PowerShell launchers run the same table
// through personaSuite, so a refusal that one twin forgets fails there.

type Content = { text: string } | { hex: string } | { fill: number };
type FileSpec = 'ok' | 'missing' | 'link' | Content;

export interface PersonaCase {
  name: string;
  files: {
    identity?: FileSpec;
    goals?: FileSpec;
    layout?: 'other-id' | 'no-dir' | 'file-dir' | 'id-link' | 'memory-link';
    extras?: boolean;
  };
  args: '' | 'twice';
  expect: string;
  reason: string;
}

const here = dirname(fileURLToPath(import.meta.url));
export const personaCases = JSON.parse(
  readFileSync(join(here, 'persona-cases.json'), 'utf8'),
) as PersonaCase[];

const ID = 'ag-jason-01';
const MOCK = 'http://world.test';
const GOOD_IDENTITY = '# Identity\n\nI am Jason, the red one.\n';
const GOOD_GOALS = '# Goals\n\nLead the team.\n';
const fakeGh = bashPath(join(repoRoot, 'launcher', 'test', 'fake-gh.sh'));
const win = process.platform === 'win32';

// Message text straight from the tsv, so a renamed text fails the suite.
function message(key: string, ...args: string[]): string {
  const file = join(repoRoot, 'launcher', 'messages.d', '56-persona.tsv');
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const tab = line.indexOf('\t');
    if (tab > 0 && line.slice(0, tab) === key) {
      let i = 0;
      return line.slice(tab + 1).replace(/%s/g, () => args[i++] ?? '');
    }
  }
  throw new Error(`no message ${key}`);
}

function bytesOf(spec: Content): Buffer {
  if ('text' in spec) return Buffer.from(spec.text, 'utf8');
  if ('hex' in spec) return Buffer.from(spec.hex.replace(/\s+/g, ''), 'hex');
  return Buffer.from('a'.repeat(spec.fill), 'utf8');
}

// What the launcher must store: the bytes with CRLF turned into LF.
function normalised(b: Buffer): string {
  return b.toString('utf8').replace(/\r\n/g, '\n');
}

export function personaSuite(l: Launcher): void {
  vi.setConfig({ testTimeout: 180_000 });

  describe(`persona-dir cases (${l.name})`, () => {
    it.each(personaCases.map((c) => [c.name, c] as const))('%s', (_n, c) => {
      const w = makeWorld();
      const ghRoot = join(w.root, 'gh');
      const shareDir = join(w.root, 'share');
      mkdirSync(join(shareDir, 'config'), { recursive: true });
      writeFileSync(join(shareDir, 'config', 'world.conf'), 'mcp_base=\nprivate_only_shards=\n');
      writeFileSync(join(w.fakeDir, 'gh'), `#!/bin/sh\nexec sh "${fakeGh}" "$@"\n`);
      chmodSync(join(w.fakeDir, 'gh'), 0o755);
      if (win && bashExe)
        writeFileSync(join(w.fakeDir, 'gh.cmd'), `@"${bashExe}" "${fakeGh}" %*\r\n`);
      writeFileSync(
        join(w.root, 'gitconfig'),
        '[user]\n\tname = Host\n\temail = host@example.test\n[init]\n\tdefaultBranch = main\n',
      );
      const env = {
        ...w.env,
        GELDAR_GH: bashPath(join(w.fakeDir, 'gh')),
        GELDAR_SHARE: bashPath(shareDir),
        GELDAR_SLEEP: '0',
        FAKE_GH_ROOT: bashPath(ghRoot),
        FAKE_GH_TEMPLATE: bashPath(join(repoRoot, 'template')),
        GIT_AUTHOR_NAME: 'Host',
        GIT_AUTHOR_EMAIL: 'host@example.test',
        GIT_COMMITTER_NAME: 'Host',
        GIT_COMMITTER_EMAIL: 'host@example.test',
      };
      const envPwsh = {
        ...env,
        ...w.envPwsh,
        GELDAR_GH: join(w.fakeDir, win ? 'gh.cmd' : 'gh'),
        GELDAR_SHARE: shareDir,
      };

      // Build the persona directory for this row.
      const dir = join(w.root, 'persona');
      const layout = c.files.layout;
      const idDir = join(dir, ID);
      const mem = join(idDir, 'memory');
      const outside = join(w.root, 'outside');
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, 'real.md'), GOOD_IDENTITY);
      const link = (target: string, at: string, type: 'file' | 'dir') => {
        try {
          symlinkSync(target, at, type === 'dir' && win ? 'junction' : type);
        } catch (e) {
          return String(e);
        }
        return '';
      };
      let skip = '';
      if (layout === 'file-dir') {
        writeFileSync(dir, 'not a directory');
      } else if (layout === 'other-id') {
        mkdirSync(join(dir, 'ag-zack-01', 'memory'), { recursive: true });
        writeFileSync(join(dir, 'ag-zack-01', 'memory', 'identity.md'), GOOD_IDENTITY);
        writeFileSync(join(dir, 'ag-zack-01', 'memory', 'goals.md'), GOOD_GOALS);
      } else if (layout !== 'no-dir') {
        const files: [string, FileSpec | undefined, string][] = [
          ['identity.md', c.files.identity, GOOD_IDENTITY],
          ['goals.md', c.files.goals, GOOD_GOALS],
        ];
        if (layout === 'id-link' || layout === 'memory-link') {
          const real = join(outside, 'real-tree');
          const realMem = layout === 'id-link' ? join(real, 'memory') : real;
          mkdirSync(realMem, { recursive: true });
          writeFileSync(join(realMem, 'identity.md'), GOOD_IDENTITY);
          writeFileSync(join(realMem, 'goals.md'), GOOD_GOALS);
          if (layout === 'id-link') {
            mkdirSync(dir, { recursive: true });
            skip = link(real, idDir, 'dir');
          } else {
            mkdirSync(idDir, { recursive: true });
            skip = link(real, mem, 'dir');
          }
        } else {
          mkdirSync(mem, { recursive: true });
          for (const [file, spec, good] of files) {
            const at = join(mem, file);
            const s = spec ?? 'ok';
            if (s === 'missing') continue;
            if (s === 'link') skip = link(join(outside, 'real.md'), at, 'file');
            else writeFileSync(at, s === 'ok' ? good : bytesOf(s));
          }
          if (c.files.extras) {
            writeFileSync(join(mem, 'notes.md'), 'never read\n');
            mkdirSync(join(idDir, 'skills'), { recursive: true });
            writeFileSync(join(idDir, 'skills', 'x.md'), 'never read\n');
          }
        }
      } else {
        mkdirSync(dir, { recursive: true });
      }
      if (skip) {
        // Windows without the symlink privilege cannot build a link row.
        console.warn(`skipped: ${c.name}: the platform refused a symlink (${skip})`);
        return;
      }

      const given = l.name === 'bash' ? bashPath(dir) : dir;
      const args = [ID, '--mock', MOCK, '--persona-dir', given];
      if (c.args === 'twice') args.push('--persona-dir', given);
      const r = run(l, ['new', ...args], {
        env: l.name === 'bash' ? env : envPwsh,
        timeoutMs: 120_000,
      });
      const clone = join(w.players, `player-${ID}`);

      if (c.expect === 'ok') {
        expect(r.status, r.stderr).toBe(0);
        expect(r.stderr).toContain(message('created_seeded', ID, ID));
        const changed = git(clone, ['diff', '--name-only', 'HEAD~1', 'HEAD'])
          .split(/\r?\n/)
          .filter(Boolean)
          .sort();
        expect(changed).toEqual(['memory/goals.md', 'memory/identity.md', 'player.json']);
        const idSpec = c.files.identity ?? 'ok';
        const goalSpec = c.files.goals ?? 'ok';
        const want = (s: FileSpec, good: string) =>
          s === 'ok' ? good : typeof s === 'object' ? normalised(bytesOf(s)) : good;
        expect(readFileSync(join(clone, 'memory', 'identity.md'), 'utf8')).toBe(
          want(idSpec, GOOD_IDENTITY),
        );
        expect(readFileSync(join(clone, 'memory', 'goals.md'), 'utf8')).toBe(
          want(goalSpec, GOOD_GOALS),
        );
        const setup = run(l, ['setup', ID], {
          env: l.name === 'bash' ? env : envPwsh,
          timeoutMs: 120_000,
        });
        expect(setup.status, setup.stderr).toBe(1);
        expect(setup.stderr).toContain('already has an identity');
        return;
      }

      const text =
        c.expect === 'persona_missing'
          ? message('persona_missing', given, ID)
          : message('persona_bad', ID, c.reason);
      expect(r.status, r.stderr).toBe(1);
      expect(r.stderr).toContain(text);
      if (c.reason) expect(r.stderr).toContain(`(${c.reason})`);
      const calls = join(ghRoot, 'calls.log');
      const log = existsSync(calls) ? readFileSync(calls, 'utf8') : '';
      expect(log).not.toContain('repo\tcreate');
      expect(existsSync(clone)).toBe(false);
      expect(existsSync(join(w.state, ID))).toBe(false);
    });
  });
}
