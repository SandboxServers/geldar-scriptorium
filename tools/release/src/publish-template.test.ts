import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TOOL = join(ROOT, 'tools', 'release', 'src', 'publish-template.ts');
const TEMPLATE = join(ROOT, 'template');
const SHA = 'a'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;
const IMAGE = `ghcr.io/sandboxservers/geldar-kit@${DIGEST}`;
const TOKEN = 'tok-SECRET-4f9c2d71';
const TOKEN_B64 = Buffer.from(`x-access-token:${TOKEN}`).toString('base64');
const T = 60_000;

let scratch: string;
let tmpRoot: string;
let bare: string;

const fwd = (p: string): string => p.replaceAll('\\', '/');

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function run(args: string[], extra: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GELDAR_INTERNAL: '1',
    TEMP: tmpRoot,
    TMP: tmpRoot,
    TMPDIR: tmpRoot,
    ...extra,
  };
  const r = spawnSync(process.execPath, [TOOL, ...args], { env, encoding: 'utf8' });
  return { code: r.status, out: String(r.stdout), err: String(r.stderr) };
}

const pub = (version: string, extra: string[] = [], env: Record<string, string> = {}) =>
  run(['--version', version, '--source-sha', SHA, '--remote', bare, ...extra], env);

const refs = (): string => git(bare, ['for-each-ref']);

function checkout(): string {
  const dir = join(scratch, `co-${Math.random().toString(36).slice(2)}`);
  git(scratch, ['clone', '--quiet', bare, dir]);
  return dir;
}

function files(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const n of readdirSync(join(root, rel))) {
      if (n === '.git' && rel === '') continue;
      const r = rel === '' ? n : `${rel}/${n}`;
      if (
        readdirSync(join(root, rel), { withFileTypes: true })
          .find((d) => d.name === n)
          ?.isDirectory()
      ) {
        walk(r);
      } else out.push(r);
    }
  };
  walk('');
  return out.sort();
}

function templateCopy(): string {
  const dir = join(scratch, `tpl-${Math.random().toString(36).slice(2)}`);
  cpSync(TEMPLATE, dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'sc63b-'));
  tmpRoot = join(scratch, 'tmp');
  mkdirSync(tmpRoot);
  bare = join(scratch, 'remote.git');
  git(scratch, ['init', '--bare', '--quiet', '-b', 'main', bare]);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const noLeftovers = (): void => expect(readdirSync(tmpRoot)).toEqual([]);

describe('publish-template', () => {
  it(
    'publishes template/ plus the two player.json edits as one commit and one tag',
    () => {
      const r = pub('kit-v0.1.0', ['--image', IMAGE]);
      expect(r.code, r.err).toBe(0);
      const co = checkout();
      expect(git(co, ['rev-list', '--count', 'HEAD']).trim()).toBe('1');
      const msg = git(co, ['log', '-1', '--format=%B']).trim().split('\n');
      expect(msg).toEqual([
        'release kit-v0.1.0',
        '',
        `template: ${SHA}`,
        `image: ${DIGEST}`,
        'launcher: kit-v0.1.0',
      ]);
      expect(git(co, ['log', '-1', '--format=%an <%ae>|%cn <%ce>']).trim()).toBe(
        'geldar-bot <geldar-bot@users.noreply.github.com>|geldar-bot <geldar-bot@users.noreply.github.com>',
      );
      expect(git(co, ['cat-file', '-t', 'kit-v0.1.0']).trim()).toBe('tag');
      expect(files(co)).toEqual(files(TEMPLATE));
      for (const f of files(TEMPLATE)) {
        if (f === 'player.json') continue;
        expect(readFileSync(join(co, f)).equals(readFileSync(join(TEMPLATE, f))), f).toBe(true);
      }
      const mine = JSON.parse(readFileSync(join(co, 'player.json'), 'utf8'));
      const orig = JSON.parse(readFileSync(join(TEMPLATE, 'player.json'), 'utf8'));
      expect(mine).toEqual({ ...orig, kit_version: '0.1.0', kit_image: IMAGE });
      noLeftovers();
    },
    T,
  );

  it(
    'keeps the empty kit_image without --image and publishes a prerelease',
    () => {
      const r = pub('kit-v0.1.0-rc1');
      expect(r.code, r.err).toBe(0);
      const co = checkout();
      const p = JSON.parse(readFileSync(join(co, 'player.json'), 'utf8'));
      expect(p.kit_version).toBe('0.1.0-rc1');
      expect(p.kit_image).toBe('');
      expect(git(co, ['log', '-1', '--format=%B']).split('\n')).toContain('image: none');
    },
    T,
  );

  it(
    'a second version on an identical template is a fast-forward child commit',
    () => {
      expect(pub('kit-v0.1.0').code).toBe(0);
      const r = pub('kit-v0.1.1');
      expect(r.code, r.err).toBe(0);
      const co = checkout();
      expect(git(co, ['rev-list', '--count', 'HEAD']).trim()).toBe('2');
      expect(git(co, ['tag']).split('\n').filter(Boolean).sort()).toEqual([
        'kit-v0.1.0',
        'kit-v0.1.1',
      ]);
    },
    T,
  );

  it(
    'the same version twice is already published and changes nothing',
    () => {
      expect(pub('kit-v0.1.0').code).toBe(0);
      const before = refs();
      const r = pub('kit-v0.1.0');
      expect(r.code, r.err).toBe(0);
      expect(r.out).toContain('already published');
      expect(refs()).toBe(before);
      noLeftovers();
    },
    T,
  );

  it(
    'the same tag with a different tree is refused',
    () => {
      expect(pub('kit-v0.1.0').code).toBe(0);
      const before = refs();
      const tpl = templateCopy();
      writeFileSync(join(tpl, 'extra.md'), 'changed\n');
      const r = pub('kit-v0.1.0', ['--template', tpl]);
      expect(r.code).toBe(1);
      expect(r.err).toContain('never moved');
      expect(refs()).toBe(before);
      noLeftovers();
    },
    T,
  );

  it(
    '--dry-run leaves the remote untouched and prints the stat',
    () => {
      expect(pub('kit-v0.1.0').code).toBe(0);
      const before = refs();
      const r = pub('kit-v0.1.1', ['--dry-run']);
      expect(r.code, r.err).toBe(0);
      expect(refs()).toBe(before);
      expect(r.out).toContain('release kit-v0.1.1');
      expect(r.out).toContain('planned push');
      noLeftovers();
    },
    T,
  );

  it(
    '--dry-run with a URL remote never contacts it and shows the whole tree',
    () => {
      const r = run([
        '--version',
        'kit-v0.1.0',
        '--source-sha',
        SHA,
        '--remote',
        'https://127.0.0.1:1/x.git',
        '--dry-run',
      ]);
      expect(r.code, r.err).toBe(0);
      expect(r.out).toContain('player.json');
      noLeftovers();
    },
    T,
  );

  it.each([
    [
      'an image in tag form',
      ['--version', 'kit-v0.1.0', '--source-sha', SHA, '--image', 'repo/x:latest'],
    ],
    ['a bad version', ['--version', 'v0.1.0', '--source-sha', SHA]],
    ['a leading-zero version', ['--version', 'kit-v01.1.0', '--source-sha', SHA]],
    ['a bad source sha', ['--version', 'kit-v0.1.0', '--source-sha', 'ABC']],
  ])(
    'refuses %s with nothing created',
    (_n, args) => {
      const r = run([...args, '--remote', bare]);
      expect(r.code).toBe(1);
      expect(refs()).toBe('');
      noLeftovers();
    },
    T,
  );

  it(
    'refuses a non-default remote without GELDAR_INTERNAL',
    () => {
      const r = pub('kit-v0.1.0', [], { GELDAR_INTERNAL: '' });
      expect(r.code).toBe(1);
      expect(refs()).toBe('');
    },
    T,
  );

  it(
    'refuses a token for a non-https remote',
    () => {
      const r = pub('kit-v0.1.0', [], { GELDAR_PUBLISH_TOKEN: TOKEN });
      expect(r.code).toBe(1);
      expect(r.err).not.toContain(TOKEN);
      expect(refs()).toBe('');
    },
    T,
  );

  describe('hostile templates', () => {
    const refuse = (tpl: string): void => {
      const r = pub('kit-v0.1.0', ['--template', tpl]);
      expect(r.code).toBe(1);
      expect(refs()).toBe('');
      noLeftovers();
    };
    it(
      'a .git/config file',
      () => {
        const tpl = templateCopy();
        mkdirSync(join(tpl, '.git'));
        writeFileSync(join(tpl, '.git', 'config'), '[core]\n');
        refuse(tpl);
      },
      T,
    );
    it(
      'a 2 MiB file',
      () => {
        const tpl = templateCopy();
        writeFileSync(join(tpl, 'big.bin'), Buffer.alloc(2 * 1024 * 1024, 65));
        refuse(tpl);
      },
      T,
    );
    it(
      'a CRLF file',
      () => {
        const tpl = templateCopy();
        writeFileSync(join(tpl, 'crlf.md'), 'a\r\nb\r\n');
        refuse(tpl);
      },
      T,
    );
    it(
      '201 files',
      () => {
        const tpl = templateCopy();
        for (let i = 0; i < 201; i++) writeFileSync(join(tpl, `f${i}.md`), 'x\n');
        refuse(tpl);
      },
      T,
    );
    it(
      'a symlink',
      (ctx) => {
        const tpl = templateCopy();
        try {
          symlinkSync(join(tpl, 'player.json'), join(tpl, 'link.json'));
        } catch {
          ctx.skip();
        }
        refuse(tpl);
      },
      T,
    );
  });

  it(
    'a rejected push exits 1 with the moved line and never forces',
    () => {
      const hook = join(bare, 'hooks', 'pre-receive');
      writeFileSync(hook, '#!/bin/sh\necho "moved" >&2\nexit 1\n', { mode: 0o755 });
      const trace = join(scratch, 'trace.log');
      const r = pub('kit-v0.1.0', [], { GIT_TRACE: trace });
      expect(r.code).toBe(1);
      expect(r.err.trim()).toBe('the template repository moved; nobody edits it by hand');
      expect(refs()).toBe('');
      const log = readFileSync(trace, 'utf8');
      expect(log).toMatch(/git push/);
      expect(log).not.toMatch(/--force|-f\b| \+/);
      noLeftovers();
    },
    T,
  );

  it(
    'keeps the token out of every output, argv, URL and config',
    () => {
      // A global config rewrites the https URL to the local bare repo, so a real https push runs.
      const cfg = join(scratch, 'gitconfig');
      writeFileSync(cfg, `[url "${fwd(bare)}"]\n\tinsteadOf = https://127.0.0.1/repo.git\n`);
      const trace = join(scratch, 'trace.log');
      const r = run(
        ['--version', 'kit-v0.1.0', '--source-sha', SHA, '--remote', 'https://127.0.0.1/repo.git'],
        {
          GELDAR_PUBLISH_TOKEN: TOKEN,
          GITHUB_ACTIONS: 'true',
          GIT_CONFIG_GLOBAL: cfg,
          GIT_TRACE: trace,
        },
      );
      expect(r.code, r.err).toBe(0);
      expect(r.out).toContain(`::add-mask::${TOKEN}`);
      expect(r.out).toContain(`::add-mask::${TOKEN_B64}`);
      // The masks are the first lines, before any git call.
      expect(r.out.split('\n')[0]).toContain('::add-mask::');
      const clean = (s: string): void => {
        expect(s).not.toContain(TOKEN);
        expect(s).not.toContain(TOKEN_B64);
      };
      const bareOut = r.out
        .replaceAll(`::add-mask::${TOKEN}`, '')
        .replaceAll(`::add-mask::${TOKEN_B64}`, '');
      clean(bareOut);
      clean(r.err);
      clean(readFileSync(trace, 'utf8'));
      clean(readFileSync(join(bare, 'config'), 'utf8'));
      expect(refs()).toContain('refs/tags/kit-v0.1.0');
      noLeftovers();
      expect(existsSync(tmpRoot)).toBe(true);
    },
    T,
  );
});
