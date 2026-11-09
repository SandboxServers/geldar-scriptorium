import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect } from 'vitest';
import {
  bashPath,
  git,
  type Launcher,
  makePlayer,
  makeWorld,
  type Player,
  type RunResult,
  repoRoot,
  run,
  type World,
} from '../harness.ts';

// SC-60a: the hostile-session harness. A hostile test runs an attack script as the "session"
// through the FAKE_SESSION seam, then proves the host did not change.

const gitCli = bashPath(join(repoRoot, 'packages', 'git', 'src', 'cli.ts'));
const win = process.platform === 'win32';

export const benign = `mkdir -p memory/journal
echo hello > memory/journal/day-001.md
node ${gitCli} commit --root . --message "day one" --mode play
`;

export interface AttackOptions {
  id?: string;
  mode?: string;
  session: string;
  until?: 'verify' | 'done';
  // False for an attack the launcher should refuse before the session starts.
  expectRun?: boolean;
  env?: Record<string, string>;
  setup?: (world: World, player: Player) => void;
}

export interface Attack {
  world: World;
  player: Player;
  before: HostSnapshot;
  after: HostSnapshot;
  prepare: RunResult;
  session: RunResult;
  finish: RunResult;
  ran: boolean;
  allowlistPath: string;
  // The file existed while the session ran (the launcher removes it afterwards).
  allowlistSeen: boolean;
}

const native = (p: string) => {
  const m = /^\/([a-z])\/(.*)$/.exec(p);
  return win && m ? `${(m[1] ?? '').toUpperCase()}:/${m[2]}` : p;
};

export function attack(launcher: Launcher, o: AttackOptions): Attack {
  const id = o.id ?? 'abc';
  const mode = o.mode ?? 'play';
  const world = makeWorld();
  const player = makePlayer(world, { id });
  plantCanary(world);
  o.setup?.(world, player);
  const mark = join(world.dockerRoot, 'attack.mark');
  const alMark = join(world.dockerRoot, 'allowlist.mark');
  const script = [
    `export GIT_AUTHOR_NAME=player-${id} GIT_AUTHOR_EMAIL=player-${id}@users.noreply.github.com`,
    `export GIT_COMMITTER_NAME=player-${id} GIT_COMMITTER_EMAIL=player-${id}@users.noreply.github.com`,
    `printf '%s' "$GELDAR_WORLD_ALLOWLIST" > "$ALLOWLIST_MARK"`,
    `if [ -f "$GELDAR_WORLD_ALLOWLIST" ]; then : > "$ALLOWLIST_MARK.seen"; fi`,
    o.session,
    ': > "$ATTACK_MARK"',
    '',
  ].join('\n');
  const sf = join(world.root, 'attack-session.sh');
  writeFileSync(sf, script);
  const env = {
    ...(launcher.name === 'bash' ? world.env : world.envPwsh),
    FAKE_SESSION: bashPath(sf),
    ATTACK_MARK: bashPath(mark),
    ALLOWLIST_MARK: bashPath(alMark),
    HOST_CLONE: bashPath(player.clone),
    ...o.env,
  };
  const go = (args: string[]) => run(launcher, args, { env, timeoutMs: 120_000 });
  const before = snapshotHost(world, player);
  const prepare = go(['__prepare', id, mode]);
  const session = go(['__session', id, mode]);
  const finish = go(['__finish', id, ...(o.until === 'verify' ? ['--until', 'verify'] : [])]);
  const after = snapshotHost(world, player);
  const ran = existsSync(mark);
  if (!ran && o.expectRun !== false)
    throw new Error('vacuous attack: the session script did not run');
  const allowlistPath = existsSync(alMark) ? native(readFileSync(alMark, 'utf8')) : '';
  const allowlistSeen = existsSync(`${alMark}.seen`);
  return {
    world,
    player,
    before,
    after,
    prepare,
    session,
    finish,
    ran,
    allowlistPath,
    allowlistSeen,
  };
}

function plantCanary(world: World): void {
  const dir = join(world.root, 'canary');
  mkdirSync(join(dir, '.ssh'), { recursive: true });
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.ssh', 'id_x'), 'fake private key\n');
  writeFileSync(join(dir, '.claude', '.credentials.json'), '{"fake":true}\n');
  writeFileSync(join(dir, 'notes.txt'), 'plain notes\n');
}

function files(dir: string, skip: (rel: string) => boolean = () => false): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const rel = relative(dir, p).replace(/\\/g, '/');
      if (skip(rel)) continue;
      if (e.isDirectory()) walk(p);
      else out.push(rel);
    }
  };
  walk(dir);
  return out.sort();
}

export interface HostSnapshot {
  head: string;
  branch: string;
  status: string;
  cloneRefs: string;
  originRefs: string;
  canary: string;
  stateFiles: string;
}

export function snapshotHost(world: World, player: Player): HostSnapshot {
  const c = player.clone;
  const hash = createHash('sha256');
  const canaryDir = join(world.root, 'canary');
  for (const f of files(canaryDir)) hash.update(f).update(readFileSync(join(canaryDir, f)));
  const skip = (rel: string) => /^(session|held)\/.+/.test(rel);
  return {
    head: git(c, ['rev-parse', 'HEAD']),
    branch: git(c, ['rev-parse', '--abbrev-ref', 'HEAD']),
    status: git(c, ['status', '--porcelain', '--untracked-files=all']),
    cloneRefs: git(c, ['for-each-ref']),
    originRefs: git(player.origin, ['for-each-ref']),
    canary: hash.digest('hex'),
    stateFiles: files(player.stateDir, skip).join('\n'),
  };
}

export function expectHostUnchanged(
  before: HostSnapshot,
  after: HostSnapshot,
  opts: { advancedBranch?: boolean } = {},
): void {
  const keys = Object.keys(before) as (keyof HostSnapshot)[];
  for (const k of keys) {
    if (opts.advancedBranch && ['head', 'cloneRefs', 'originRefs'].includes(k)) continue;
    expect(after[k], `host changed: ${k}`).toBe(before[k]);
  }
  if (opts.advancedBranch) {
    expect(after.head, 'host changed: head must advance').not.toBe(before.head);
  }
}

const messageText = (key: string): string => {
  const dir = join(repoRoot, 'launcher', 'messages.d');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsv'))) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      const tab = line.indexOf('\t');
      if (tab > 0 && line.slice(0, tab) === key) return line.slice(tab + 1);
    }
  }
  throw new Error(`message key not found in launcher/messages.d: ${key}`);
};

const hasControl = (s: string) =>
  s.includes(String.fromCharCode(27)) || s.includes(String.fromCharCode(7));

export function expectRefusal(result: RunResult, key: string, opts: { status: number }): void {
  // The text may hold %s: compare the literal pieces around them.
  const pieces = messageText(key)
    .split('%s')
    .filter((s) => s.length > 0);
  expect(result.stderr).toContain('geldar-play: ');
  for (const piece of pieces) expect(result.stderr).toContain(piece);
  expect(result.status).toBe(opts.status);
  expect(hasControl(result.stdout) || hasControl(result.stderr), 'control byte in output').toBe(
    false,
  );
}

// Same filter as dockerCalls in pre.test.ts: the probes every verb makes are not docker calls.
export function expectNoDockerCall(world: World): void {
  const calls = world.calls().filter((c) => {
    if (c[0] === 'compose' || c[0] === 'version' || c[0] === 'info') return false;
    return !(c[0] === 'image' && c[1] === 'inspect');
  });
  expect(calls, 'a docker call was made').toEqual([]);
}

export const modeOf = (path: string): number => statSync(path).mode & 0o777;

// N4: the state under <state>/<id> is private; pub/ and export/ are readable by the container.
export function assertStatePerms(stateDir: string, id: string): 'ok' | 'skipped' {
  if (win) return 'skipped';
  const base = join(stateDir, id);
  const problems: string[] = [];
  const bad = (rel: string, m: number) => problems.push(`${rel} is ${m.toString(8)}`);
  const walk = (dir: string, zone: 'private' | 'pub' | 'export') => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      const rel = relative(base, p).replace(/\\/g, '/');
      const m = modeOf(p);
      const sub = rel === 'pub' ? 'pub' : rel === 'export' ? 'export' : zone;
      if (e.isDirectory()) {
        if (sub === 'pub' && m !== 0o755) bad(rel, m);
        else if (sub === 'export' && (m & 0o005) !== 0o005) bad(rel, m);
        else if (sub === 'private' && m !== 0o700) bad(rel, m);
        walk(p, sub);
      } else if (sub === 'export') {
        if ((m & 0o004) === 0) bad(rel, m);
      } else if (sub === 'pub') {
        if (rel !== 'pub/allowlist-world.txt' || m !== 0o644) bad(rel, m);
      } else if (m !== 0o600 && m !== 0o700) bad(rel, m);
    }
  };
  walk(base, 'private');
  if (problems.length > 0) throw new Error(`state permissions: ${problems.join('; ')}`);
  return 'ok';
}
