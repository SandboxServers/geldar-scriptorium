import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bashPath, type Launcher, makeWorld, repoRoot, run } from './harness.ts';

// SC-140: auth-set, auth-status and auth-clear, with no Docker. Shared by both launchers.
const win = process.platform === 'win32';
const TOKEN = 'sk-ant-oat01-Zq8.Lm3~xY7-pR2tVb9KdW4nH6';

// The text of a message key, straight from the table, so a changed text fails the suite.
function message(key: string): string {
  const tsv = readFileSync(join(repoRoot, 'launcher', 'messages.d', '59-auth.tsv'), 'utf8');
  const line = tsv.split('\n').find((l) => l.startsWith(`${key}\t`));
  if (!line) throw new Error(`no message ${key}`);
  return line.slice(key.length + 1);
}

// Every 6-character slice of the token: none may appear in the output.
function slices(t: string): string[] {
  return Array.from({ length: t.length - 5 }, (_, i) => t.slice(i, i + 6));
}

export function authSuite(l: Launcher): void {
  describe(`auth verbs (${l.name})`, () => {
    const setup = () => {
      const w = makeWorld();
      const env = l.name === 'bash' ? w.env : w.envPwsh;
      const p = (f: string) => (l.name === 'bash' ? bashPath(f) : f);
      const file = join(w.state, 'auth', 'claude-oauth-token');
      const tokFile = (body: string) => {
        const f = join(w.root, 'tok.txt');
        writeFileSync(f, body);
        return p(f);
      };
      return {
        w,
        env,
        file,
        tokFile,
        go: (a: string[], input?: string) => run(l, a, { env, input }),
      };
    };

    it('stores a token from --token-file and from a pipe, one line, owner only', () => {
      const s = setup();
      const a = s.go(['auth-set', '--token-file', s.tokFile(`${TOKEN}\r\n`)]);
      expect(a.status, a.stderr).toBe(0);
      expect(a.stderr).toContain(message('auth_set_done'));
      expect(readFileSync(s.file, 'utf8')).toBe(`${TOKEN}\n`);
      expect(a.stdout + a.stderr).not.toContain(TOKEN.slice(0, 12));
      s.go(['auth-clear']);
      const b = s.go(['auth-set'], `${TOKEN}\n`);
      expect(b.status, b.stderr).toBe(0);
      expect(readFileSync(s.file, 'utf8')).toBe(`${TOKEN}\n`);
      if (win) {
        console.info('auth: POSIX modes are not checked on Windows');
      } else {
        expect(statSync(s.file).mode & 0o777).toBe(0o600);
        expect(statSync(join(s.w.state, 'auth')).mode & 0o777).toBe(0o700);
      }
    });

    it.each([
      ['too short', 'abc123\n'],
      ['an equals sign', `${TOKEN}=x\n`],
      ['a space', `${TOKEN} x\n`],
      ['two lines', `${TOKEN}\nsecond\n`],
      ['a blank second line', `${TOKEN}\n\n`],
      ['empty', ''],
      ['too long', `${'a'.repeat(401)}\n`],
    ])('rejects %s', (_name, body) => {
      const s = setup();
      const a = s.go(['auth-set', '--token-file', s.tokFile(body)]);
      expect(a.status).toBe(1);
      expect(a.stderr).toContain(message('auth_bad_token'));
      const b = s.go(['auth-set'], body);
      expect(b.status).toBe(1);
      expect(existsSync(s.file)).toBe(false);
    });

    it('reports the state without ever printing the token, and clear removes it', () => {
      const s = setup();
      const none = s.go(['auth-status']);
      expect(none.status, none.stderr).toBe(0);
      expect(none.stderr).toContain(message('auth_status_not_set'));
      s.go(['auth-set'], `${TOKEN}\n`);
      const set = s.go(['auth-status']);
      expect(set.status, set.stderr).toBe(0);
      const out = set.stdout + set.stderr;
      expect(out).toMatch(/Shared login: set/);
      if (!win) expect(out).toContain(message('auth_status_set'));
      for (const part of slices(TOKEN)) expect(out).not.toContain(part);
      if (!win) {
        // An open file is reported, never ignored.
        mkdirSync(join(s.w.state, 'auth'), { recursive: true });
        s.go(['auth-clear']);
        writeFileSync(s.file, `${TOKEN}\n`, { mode: 0o644 });
        const open = s.go(['auth-status']);
        expect(open.stderr).toContain(message('auth_status_open_mode'));
        for (const part of slices(TOKEN)) expect(open.stderr).not.toContain(part);
      }
      const cleared = s.go(['auth-clear']);
      expect(cleared.status, cleared.stderr).toBe(0);
      expect(cleared.stderr).toContain(message('auth_cleared'));
      expect(existsSync(s.file)).toBe(false);
      expect(s.go(['auth-clear']).status).toBe(0);
    });
  });
}
