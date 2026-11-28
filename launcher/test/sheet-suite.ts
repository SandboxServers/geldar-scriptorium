import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  bashPath,
  FIXTURE_MCP_URL,
  git,
  type Launcher,
  makePlayer,
  type RunResult,
  repoRoot,
  run,
} from './harness.ts';
import { filesUnder, ID, MOCK, newRun, type Setup, setupWorld, win } from './new-support.ts';
import {
  CHOWN_STUB,
  composeCalls,
  ID as PS_ID,
  setup as setupPlayer,
  T,
  vol,
} from './player-support.ts';

// HC-26a: new --sheet and sheet-set, with no Docker. Shared by both launchers.
vi.setConfig({ testTimeout: 180_000 });

// A marker that must never reach stdout, stderr, a call log, the clone or the bare repository.
const SENTINEL = 'SHEETSENTINEL-7f3a';
const GOOD = `{"name":"${SENTINEL}","attributes":{"aggression":2}}\n`;
const OTHER = '{"name":"SHEETSENTINEL-9c1e"}\n';

// The text of a message key, straight from the table, with each %s filled in order.
function message(key: string, ...args: string[]): string {
  const tsv = readFileSync(join(repoRoot, 'launcher', 'messages.d', '63-sheet.tsv'), 'utf8');
  const line = tsv.split(/\r?\n/).find((l) => l.startsWith(`${key}\t`));
  if (!line) throw new Error(`no message ${key}`);
  let text = line.slice(key.length + 1);
  for (const a of args) text = text.replace('%s', a);
  return text;
}

function modeOf(p: string): number {
  return statSync(p).mode & 0o777;
}

// The world's base is the mock host, so sheet-set accepts the player's mcp_url (SC-80).
const CONF = `mcp_base=${MOCK}\nprivate_only_shards=\n`;

function passes(r: RunResult): void {
  expect(r.status, r.stderr).toBe(0);
}

// Docker calls that are not work: every verb makes these probes (devworld-suite counts them alike).
function dockerWork(calls: string[][]): string[][] {
  return calls.filter(
    (call) =>
      !(
        call[0] === 'version' ||
        call[0] === 'info' ||
        (call[0] === 'image' && call[1] === 'inspect') ||
        (call[0] === 'compose' && call[1] === 'version')
      ),
  );
}

// The helper's stand-ins (HC-26b): chown as player-support has it, and geldar-instinct, which exits with
// check (0 accepts the staged files). They sit first on the PATH of the docker stand-in, in their own folder.
function instinctBin(l: Launcher, root: string, check: number): string {
  const dir = join(root, `instinct-${check}`);
  mkdirSync(dir, { recursive: true });
  const files: [string, string][] = [
    ['chown', CHOWN_STUB],
    ['geldar-instinct', `#!/bin/sh\nexit ${check}`],
  ];
  for (const [name, body] of files) {
    const file = join(dir, name);
    writeFileSync(file, `${body}\n`);
    chmodSync(file, 0o755);
  }
  return l.name === 'bash' ? bashPath(dir) : dir;
}

// The env of a start or restart in a player-support world: its docker stand-in runs the helper's
// script in place of /vol, and the instinct stand-in stands in for the sheet check.
function startEnv(
  l: Launcher,
  s: ReturnType<typeof setupPlayer>,
  check = 0,
): Record<string, string> {
  return { ...s.env, FAKE_CHOWN_BIN: instinctBin(l, s.w.root, check) };
}

// The env of a sheet-set in the sheet world: the helper goes through a player-support docker stand-in
// (the stand-in is path-only, its fake root comes from this world's env), so its delivery runs.
function sheetDeliverEnv(l: Launcher, s: Setup, check = 0): Record<string, string> {
  const stand = setupPlayer(l);
  const base = l.name === 'bash' ? s.env : s.envPwsh;
  return {
    ...base,
    GELDAR_DOCKER: stand.env.GELDAR_DOCKER,
    FAKE_CHOWN_BIN: instinctBin(l, s.w.root, check),
  };
}

// The values that follow each occurrence of a docker flag, in one run's arguments.
function flagValues(c: string[], flag: string): string[] {
  return c.flatMap((a, i) => (c[i - 1] === flag ? [a] : []));
}

const ROSTER = '{"players":[]}\n';

export function sheetSuite(l: Launcher): void {
  describe(`sheet ${l.name}`, () => {
    const clonePath = (s: Setup) => join(s.w.players, `player-${ID}`);
    const bareRepo = (s: Setup) => join(s.ghRoot, `player-${ID}.git`);
    // A path as the launcher reads it: bash takes a MSYS-style path, pwsh the native one.
    const arg = (p: string) => (l.name === 'bash' ? bashPath(p) : p);
    const write = (dir: string, name: string, body: string | Buffer) => {
      const p = join(dir, name);
      writeFileSync(p, body);
      return p;
    };
    const sheetSet = (s: Setup, args: string[]) =>
      run(l, ['sheet-set', ...args], { env: sheetDeliverEnv(l, s) });
    // A world holding a made player, so sheet-set has a state directory to act on. The host
    // identity signs commits, so the player fixture is committed with a plain identity first.
    const playerSetup = (): Setup => {
      const s = setupWorld(CONF);
      const host = readFileSync(join(s.w.root, 'gitconfig'), 'utf8');
      writeFileSync(
        join(s.w.root, 'gitconfig'),
        '[user]\n\tname = Test\n\temail = test@example.test\n[init]\n\tdefaultBranch = main\n[core]\n\tautocrlf = false\n',
      );
      const made = makePlayer(s.w, { id: ID });
      // The mcp_url new writes for the mock base. read_player reads the committed player.json,
      // so the change is committed in the clone.
      const pj = join(made.clone, 'player.json');
      writeFileSync(pj, readFileSync(pj, 'utf8').replace(FIXTURE_MCP_URL, `${MOCK}/p/${ID}`));
      git(made.clone, ['commit', '-am', 'mock url'], {
        GIT_CONFIG_GLOBAL: join(s.w.root, 'gitconfig'),
      });
      writeFileSync(join(s.w.root, 'gitconfig'), host);
      return s;
    };
    // A stored copy as new --sheet leaves it: 0600 in the state directory.
    const storeDirect = (s: Setup, body: string) =>
      writeFileSync(join(s.w.state, ID, 'sheet.json'), body, { mode: 0o600 });

    it('1. new --sheet stores the sheet 0600 in the state directory, not in the clone', () => {
      const s = setupWorld(CONF);
      const sheet = write(s.w.root, 'sheet.json', GOOD);
      const r = newRun(l, s, [ID, '--mock', MOCK, '--sheet', arg(sheet)]);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout + r.stderr).toContain(message('sheet_stored', ID));
      const stored = join(s.w.state, ID, 'sheet.json');
      expect(readFileSync(stored, 'utf8')).toBe(GOOD);
      expect(existsSync(join(clonePath(s), 'sheet.json'))).toBe(false);
      if (win) {
        console.info('sheet: POSIX modes are not checked on Windows');
      } else {
        expect(modeOf(stored)).toBe(0o600);
        expect(modeOf(join(s.w.state, ID))).toBe(0o700);
      }
    });

    it('2. the new clone lists no sheet file and holds no sheet text, nor does the bare repository', () => {
      const s = setupWorld(CONF);
      const sheet = write(s.w.root, 'sheet.json', GOOD);
      passes(newRun(l, s, [ID, '--mock', MOCK, '--sheet', arg(sheet)]));
      const clone = clonePath(s);
      expect(git(clone, ['ls-files'])).not.toMatch(/sheet/i);
      for (const f of filesUnder(clone)) {
        expect(f).not.toMatch(/sheet/i);
        expect(readFileSync(join(clone, f), 'utf8')).not.toContain(SENTINEL);
      }
      expect(git(clone, ['log', '--all', '-p'])).not.toContain(SENTINEL);
      expect(git(bareRepo(s), ['log', '--all', '-p'])).not.toContain(SENTINEL);
    });

    it('3. a link, a directory, a 5 KB file, a binary file and a non-JSON file are refused before anything is created', () => {
      const cases: {
        name: string;
        reason: string;
        make: (root: string) => string | null;
      }[] = [
        {
          name: 'a link',
          reason: 'link',
          make: (root) => {
            const p = join(root, 'link.json');
            try {
              symlinkSync(join(root, 'good.json'), p);
              return p;
            } catch {
              return null;
            }
          },
        },
        {
          name: 'a directory',
          reason: 'type',
          make: (root) => {
            const p = join(root, 'dir.d');
            mkdirSync(p);
            return p;
          },
        },
        {
          name: 'a 5 KB file',
          reason: 'size',
          make: (root) => write(root, 'big.json', `{"pad":"${'a'.repeat(5 * 1024)}"}`),
        },
        {
          name: 'a binary file',
          reason: 'text',
          make: (root) => write(root, 'bin.json', Buffer.from([0x7b, 0x00, 0xff, 0xfe, 0x7d])),
        },
        {
          name: 'a file that is not a JSON object',
          reason: 'text',
          make: (root) => write(root, 'list.json', '[1,2]\n'),
        },
      ];
      for (const c of cases) {
        const s = setupWorld(CONF);
        const p = c.make(s.w.root);
        if (p === null) {
          console.info(`sheet: cannot create ${c.name} on this host, skipped`);
          continue;
        }
        const r = newRun(l, s, [ID, '--mock', MOCK, '--sheet', arg(p)]);
        expect(r.status, `${c.name}: ${r.stderr}`).toBe(1);
        expect(r.stderr, c.name).toContain(message('sheet_bad', ID, c.reason));
        expect(existsSync(join(s.w.state, ID)), c.name).toBe(false);
        expect(existsSync(clonePath(s)), c.name).toBe(false);
        expect(s.ghCalls(), c.name).toEqual([]);
        expect(dockerWork(s.w.calls()), c.name).toEqual([]);
      }
    });

    it('4. sheet-set replaces the stored copy and keeps its mode; a refused file changes nothing', () => {
      const s = playerSetup();
      storeDirect(s, GOOD);
      const stored = join(s.w.state, ID, 'sheet.json');
      const second = write(s.w.root, 'sheet2.json', OTHER);
      const a = sheetSet(s, [ID, arg(second)]);
      expect(a.status, a.stderr).toBe(0);
      expect(a.stdout + a.stderr).toContain(message('sheet_stored', ID));
      expect(readFileSync(stored, 'utf8')).toBe(OTHER);
      if (!win) expect(modeOf(stored)).toBe(0o600);
      const bad = write(s.w.root, 'bad.json', '[1,2]\n');
      const b = sheetSet(s, [ID, arg(bad)]);
      expect(b.status).toBe(1);
      expect(b.stderr).toContain(message('sheet_bad', ID, 'text'));
      expect(readFileSync(stored, 'utf8')).toBe(OTHER);
      if (!win) expect(modeOf(stored)).toBe(0o600);
    });

    it('5. no docker call is made by new --sheet or by sheet-set', () => {
      const s = setupWorld(CONF);
      const sheet = write(s.w.root, 'sheet.json', GOOD);
      passes(newRun(l, s, [ID, '--mock', MOCK, '--sheet', arg(sheet)]));
      expect(dockerWork(s.w.calls())).toEqual([]);
      // sheet-set makes one docker call, the delivery helper of the stored sheet (HC-26b), and no other.
      const t = playerSetup();
      const again = write(t.w.root, 'sheet2.json', OTHER);
      passes(sheetSet(t, [ID, arg(again)]));
      const work = dockerWork(t.w.calls());
      expect(work).toHaveLength(1);
      expect(work[0]?.[0]).toBe('run');
      expect(work[0]).toContain(`geldar-sheet-${ID}`);
    });

    it('6. the sheet text never appears in stdout, stderr or any call log', () => {
      const s = setupWorld(CONF);
      const sheet = write(s.w.root, 'sheet.json', GOOD);
      const outs: string[] = [];
      const a = newRun(l, s, [ID, '--mock', MOCK, '--sheet', arg(sheet)]);
      outs.push(a.stdout, a.stderr);
      const t = playerSetup();
      // A refused file that holds the marker must not be echoed either.
      const big = write(t.w.root, 'big.json', `{"m":"${SENTINEL}","pad":"${'a'.repeat(5000)}"}`);
      const refused = sheetSet(t, [ID, arg(big)]);
      expect(refused.status).toBe(1);
      outs.push(refused.stdout, refused.stderr);
      const again = write(t.w.root, 'sheet2.json', OTHER);
      const b = sheetSet(t, [ID, arg(again)]);
      outs.push(b.stdout, b.stderr);
      for (const o of outs) expect(o).not.toContain(SENTINEL);
      const logs = [
        ...s.w.calls(),
        ...s.w.gitCalls(),
        ...s.ghCalls(),
        ...t.w.calls(),
        ...t.w.gitCalls(),
        ...t.ghCalls(),
      ]
        .map((argv) => argv.join(' '))
        .join('\n');
      expect(logs).not.toContain(SENTINEL);
    });

    // HC-26b: start and restart deliver the stored sheet and roster before compose (player-support stand-in).
    describe(`sheet delivery at start ${l.name}`, () => {
      const helperRuns = (s: ReturnType<typeof setupPlayer>) =>
        s.w.calls().filter((c) => c[0] === 'run' && c.includes(`geldar-sheet-${PS_ID}`));
      const supplied = (s: ReturnType<typeof setupPlayer>, name: string) =>
        join(vol(s.w, `geldar-sup-${PS_ID}`), 'instinct', name);

      it('start with a stored sheet runs one delivery helper before compose up, with --network none, a read-only mount of the staged files, the supervisor volume, and no /player mount', {
        timeout: T,
      }, () => {
        const s = setupPlayer(l);
        writeFileSync(join(s.p.stateDir, 'sheet.json'), GOOD, { mode: 0o600 });
        const r = run(l, ['start', PS_ID], { env: startEnv(l, s) });
        expect(r.status, r.stderr).toBe(0);
        const runs = helperRuns(s);
        expect(runs).toHaveLength(1);
        const [helper] = runs;
        expect(flagValues(helper ?? [], '--network')).toEqual(['none']);
        const mounts = flagValues(helper ?? [], '-v');
        expect(mounts).toHaveLength(2);
        expect(mounts[0]).toMatch(/:\/in:ro$/);
        expect(mounts[1]).toBe(`geldar-sup-${PS_ID}:/vol:rw`);
        // The host side of the read-only mount is a state path, so only a container destination of /player counts.
        expect(mounts.join(' ')).not.toMatch(/geldar-ws-|:\/player(:|$)/);
        const calls = s.w.calls();
        const up = calls.findIndex((c) => c[0] === 'compose' && c.includes('up'));
        expect(calls.indexOf(helper ?? [])).toBeLessThan(up);
        expect(readFileSync(supplied(s, 'sheet.json'), 'utf8')).toBe(GOOD);
      });

      it('no stored sheet and no roster: no helper', { timeout: T }, () => {
        const s = setupPlayer(l);
        const r = run(l, ['start', PS_ID], { env: startEnv(l, s) });
        expect(r.status, r.stderr).toBe(0);
        expect(helperRuns(s)).toEqual([]);
        expect(composeCalls(s.w, 'up')).toHaveLength(1);
      });

      it('a roster alone is delivered', { timeout: T }, () => {
        const s = setupPlayer(l);
        writeFileSync(join(s.p.stateDir, 'roster.json'), ROSTER, { mode: 0o600 });
        const r = run(l, ['start', PS_ID], { env: startEnv(l, s) });
        expect(r.status, r.stderr).toBe(0);
        expect(helperRuns(s)).toHaveLength(1);
        expect(readFileSync(supplied(s, 'roster.json'), 'utf8')).toBe(ROSTER);
        expect(existsSync(supplied(s, 'sheet.json'))).toBe(false);
      });

      it('an invalid sheet (the fake check exits 2) refuses start with sheet_bad, and compose is never called', {
        timeout: T,
      }, () => {
        const s = setupPlayer(l);
        writeFileSync(join(s.p.stateDir, 'sheet.json'), GOOD, { mode: 0o600 });
        const r = run(l, ['start', PS_ID], { env: startEnv(l, s, 2) });
        expect(r.status).toBe(1);
        expect(r.stderr).toContain(message('sheet_bad', PS_ID, 'check'));
        expect(composeCalls(s.w, 'up')).toEqual([]);
      });

      it('a roster over 16 KiB is refused with sheet_bad', { timeout: T }, () => {
        const s = setupPlayer(l);
        writeFileSync(join(s.p.stateDir, 'roster.json'), 'r'.repeat(16 * 1024 + 1), {
          mode: 0o600,
        });
        const r = run(l, ['start', PS_ID], { env: startEnv(l, s) });
        expect(r.status).toBe(1);
        expect(r.stderr).toContain(message('sheet_bad', PS_ID, 'roster'));
        expect(composeCalls(s.w, 'up')).toEqual([]);
      });

      it('the roster and the sheet are both mode 0600 owner 1001 in the volume', {
        timeout: T,
      }, () => {
        const s = setupPlayer(l);
        writeFileSync(join(s.p.stateDir, 'sheet.json'), GOOD, { mode: 0o600 });
        writeFileSync(join(s.p.stateDir, 'roster.json'), ROSTER, { mode: 0o600 });
        const r = run(l, ['start', PS_ID], { env: startEnv(l, s) });
        expect(r.status, r.stderr).toBe(0);
        // The helper script gives each staged file owner 1001 and mode 0600 before the move into the volume.
        const [helper] = helperRuns(s);
        const script = helper?.at(-1) ?? '';
        expect(script).toContain('chown 1001:1001 /vol/instinct/.sheet.tmp');
        expect(script).toContain('chmod 0600 /vol/instinct/.sheet.tmp');
        expect(script).toContain('chmod 0600 /vol/instinct/.roster.tmp');
        expect(readFileSync(join(s.w.dockerRoot, 'chown-calls.log'), 'utf8')).toContain(
          '1001:1001 ',
        );
        if (win) {
          console.info('sheet: POSIX modes are not checked on Windows');
        } else {
          expect(modeOf(supplied(s, 'sheet.json'))).toBe(0o600);
          expect(modeOf(supplied(s, 'roster.json'))).toBe(0o600);
        }
      });
    });
  });
}
