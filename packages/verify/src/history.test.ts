import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { noreplyIdentity } from '@geldar/scriptorium-path-rule';
import { afterEach, describe, expect, it } from 'vitest';
import type { VerifyInput } from './args.ts';
import { type Fixture, makeFixture } from './fixture.ts';
import { checkHistory, type HistoryContext, parseLog, reasonsFor } from './history.ts';
import { verify } from './verify.ts';

const fixtures: Fixture[] = [];
const HOST = { name: 'Host', email: 'host@example.test' };

function fresh(): Fixture {
  const f = makeFixture();
  fixtures.push(f);
  return f;
}

function run(f: Fixture, mode: VerifyInput['mode']) {
  const bundle = f.bundle(['refs/heads/main']);
  return verify({ bundle, start: f.start, branch: 'main', mode, playerId: f.playerId });
}

afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

describe('verify: history, hostile bundles', () => {
  it('1: a clean day is ok', () => {
    const f = fresh();
    f.write('memory/summary.md', 'updated\n');
    f.write('memory/journal/day-001.md', 'day one\n');
    f.write('memory/people/pike.md', 'pike\n');
    f.write('skills/farm.js', 'export {};\n');
    f.commitAll('day 1');
    expect(run(f, 'play')).toEqual({ ok: true, reasons: [] });
  });

  it('2: a birth in setup mode is ok', () => {
    const f = fresh();
    f.write('memory/identity.md', 'name: Born\n');
    f.write('memory/summary.md', 'born\n');
    f.commitAll('birth');
    expect(run(f, 'setup')).toEqual({ ok: true, reasons: [] });
  });

  it('3: a rename out of CLAUDE.md is path_not_allowed', () => {
    const f = fresh();
    f.git(['mv', 'CLAUDE.md', 'memory/notes.md']);
    f.commitAll('rename');
    expect(run(f, 'play').reasons).toEqual(['path_not_allowed']);
  });

  it('4: a symlink is symlink_not_allowed', () => {
    const f = fresh();
    f.stageEntry('120000', 'memory/link.md', '../CLAUDE.md');
    f.commitStaged('link');
    expect(run(f, 'play').reasons).toEqual(['symlink_not_allowed']);
  });

  it('5: a gitlink is gitlink_not_allowed', () => {
    const f = fresh();
    f.stageEntry('160000', 'memory/mod.md');
    f.commitStaged('mod');
    expect(run(f, 'play').reasons).toEqual(['gitlink_not_allowed']);
  });

  it('6: an executable bit is executable_not_allowed', () => {
    const f = fresh();
    f.stageEntry('100755', 'skills/run.js', 'x');
    f.commitStaged('exec');
    expect(run(f, 'play').reasons).toEqual(['executable_not_allowed']);
  });

  it('7: a nested .gitattributes is path_not_allowed', () => {
    const f = fresh();
    f.write('memory/people/.gitattributes', '* filter=x');
    f.commitAll('attributes');
    expect(run(f, 'play').reasons).toEqual(['path_not_allowed']);
  });

  it('8: a reserved Windows name is path_not_allowed', () => {
    const f = fresh();
    // Built at index level: a Windows work tree cannot hold a file named CON.md.
    // protectNTFS is off only for this index write; the verifier's own checks run as usual.
    const body = join(f.out, 'con-body.txt');
    writeFileSync(body, 'x');
    const sha = f.git(['hash-object', '-w', body]);
    f.git([
      '-c',
      'core.protectNTFS=false',
      'update-index',
      '--add',
      '--cacheinfo',
      `100644,${sha},skills/CON.md`,
    ]);
    f.commitStaged('reserved');
    expect(run(f, 'play').reasons).toEqual(['path_not_allowed']);
  });

  it('9: a forbidden extension is path_not_allowed', () => {
    const f = fresh();
    f.write('memory/run.sh', 'x');
    f.commitAll('script');
    expect(run(f, 'play').reasons).toEqual(['path_not_allowed']);
  });

  it('10: a transient forbidden file is caught by the per-commit pass', () => {
    const f = fresh();
    f.write('CLAUDE.md', 'edited\n');
    f.commitAll('edit');
    f.git(['checkout', f.start, '--', 'CLAUDE.md']);
    f.commitAll('restore');
    expect(run(f, 'play').reasons).toEqual(['path_not_allowed']);
  });

  it('11: an edited identity in play is identity_changed', () => {
    const f = fresh();
    f.write('memory/identity.md', 'name: Other\n');
    f.commitAll('identity');
    expect(run(f, 'play').reasons).toEqual(['identity_changed']);
  });

  it('12: a deleted identity in play is identity_changed', () => {
    const f = fresh();
    f.remove('memory/identity.md');
    f.commitAll('identity gone');
    expect(run(f, 'play').reasons).toEqual(['identity_changed']);
  });

  it('13: the right author name with the wrong author email is identity_mismatch', () => {
    const f = fresh();
    f.write('memory/summary.md', 'x\n');
    f.commitAll('wrong email', {
      author: { name: f.noreply.name, email: 'someone@example.test' },
    });
    expect(run(f, 'play').reasons).toEqual(['identity_mismatch']);
  });

  it('14: the wrong committer name with the right email is identity_mismatch', () => {
    const f = fresh();
    f.write('memory/summary.md', 'x\n');
    f.commitAll('wrong committer', {
      author: f.noreply,
      committer: { name: 'Someone', email: f.noreply.email },
    });
    expect(run(f, 'play').reasons).toEqual(['identity_mismatch']);
  });

  it('15: the host identity on a new commit is identity_mismatch', () => {
    const f = fresh();
    f.write('memory/summary.md', 'x\n');
    f.commitAll('host', { author: HOST, committer: HOST });
    expect(run(f, 'play').reasons).toEqual(['identity_mismatch']);
  });

  it('16: another player identity is identity_mismatch', () => {
    const f = fresh();
    f.write('memory/summary.md', 'x\n');
    const other = noreplyIdentity('other-player');
    f.commitAll('other', { author: other, committer: other });
    expect(run(f, 'play').reasons).toEqual(['identity_mismatch']);
  });

  it('17: several problems at once are all reported, in REASONS order', () => {
    const f = fresh();
    f.write('CLAUDE.md', 'x\n');
    f.git(['add', 'CLAUDE.md']);
    f.stageEntry('120000', 'memory/link.md', 'x');
    f.commitStaged('several');
    expect(run(f, 'play').reasons).toEqual(['path_not_allowed', 'symlink_not_allowed']);
  });

  it('18: a merge plus a forbidden path is merge_commit and path_not_allowed', () => {
    const f = fresh();
    f.git(['checkout', '-q', '-b', 'side']);
    f.write('CLAUDE.md', 'side\n');
    f.commitAll('side');
    f.git(['checkout', '-q', 'main']);
    f.write('memory/goals.md', 'goal\n');
    f.commitAll('goals');
    f.git(['merge', '--no-ff', 'side', '-m', 'merge']);
    expect(run(f, 'play').reasons).toEqual(['merge_commit', 'path_not_allowed']);
  });
});

describe('parseLog', () => {
  const record = (sha: string, fields: string[]) => [sha, '', ...fields].join('\x1f');
  const good = (sha: string) =>
    record(sha, [
      noreplyIdentity('mmpr-red').name,
      noreplyIdentity('mmpr-red').email,
      noreplyIdentity('mmpr-red').name,
      noreplyIdentity('mmpr-red').email,
    ]);

  it('returns one record per NUL-terminated commit', () => {
    const records = parseLog(`${good('a'.repeat(40))}\0${good('b'.repeat(40))}\0`);
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.complete)).toBe(true);
  });

  it('returns [] for empty output', () => {
    expect(parseLog('')).toEqual([]);
  });

  it('keeps a 5-field record as incomplete', () => {
    const records = parseLog(`${record('a'.repeat(40), ['n', 'e', 'n'])}\0`);
    expect(records).toHaveLength(1);
    expect(records[0]?.complete).toBe(false);
  });
});

describe('reasonsFor', () => {
  const entry = (path: string, newMode: string, oldMode = '000000') => ({
    oldMode,
    newMode,
    path,
  });

  it.each([
    ['a clean file', entry('memory/a.md', '100644'), 'play', []],
    ['a deletion of a clean file', entry('memory/a.md', '000000', '100644'), 'play', []],
    ['CLAUDE.md', entry('CLAUDE.md', '100644'), 'play', ['path_not_allowed']],
    ['identity in play', entry('memory/identity.md', '100644'), 'play', ['identity_changed']],
    ['identity in setup', entry('memory/identity.md', '100644'), 'setup', []],
    ['a symlink', entry('memory/a.md', '120000'), 'play', ['symlink_not_allowed']],
    ['a gitlink', entry('memory/a.md', '160000'), 'play', ['gitlink_not_allowed']],
    ['an executable', entry('memory/a.md', '100755'), 'play', ['executable_not_allowed']],
    ['a group-writable mode', entry('memory/a.md', '100664'), 'play', ['bad_mode']],
    [
      'a symlink at CLAUDE.md',
      entry('CLAUDE.md', '120000'),
      'play',
      ['path_not_allowed', 'symlink_not_allowed'],
    ],
  ] as const)('%s', (_name, e, mode, expected) => {
    expect(reasonsFor(e, mode)).toEqual(expected);
  });
});

describe('checkHistory with an injected runner', () => {
  const SHA = 'a'.repeat(40);
  const START = 'b'.repeat(40);
  const TIP = 'c'.repeat(40);
  const NOREPLY = noreplyIdentity('mmpr-red');
  const LOG = [SHA, '', NOREPLY.name, NOREPLY.email, NOREPLY.name, NOREPLY.email].join('\x1f');
  const CTX: HistoryContext = {
    repo: '/unused',
    start: START,
    tip: TIP,
    mode: 'play',
    playerId: 'mmpr-red',
  };

  function fake(opts: { log: string; perCommit: string; net: string }) {
    const calls: string[][] = [];
    const runner = (_repo: string, args: readonly string[]) => {
      calls.push([...args]);
      let stdout = opts.net;
      if (args[0] === 'log') stdout = opts.log;
      else if (args.includes('--no-commit-id')) stdout = opts.perCommit;
      return { status: 0, stdout };
    };
    return { calls, runner };
  }

  it('calls the per-commit and the net diff with the expected arguments, and the net pass alone finds CLAUDE.md', () => {
    const net = `:100644 100644 ${'d'.repeat(40)} ${'e'.repeat(40)} M\0CLAUDE.md\0`;
    const { calls, runner } = fake({ log: `${LOG}\0`, perCommit: '', net });
    expect(checkHistory(CTX, runner)).toEqual(['path_not_allowed']);
    expect(calls).toContainEqual([
      'diff-tree',
      '-r',
      '--raw',
      '--no-renames',
      '--no-abbrev',
      '-z',
      '--no-commit-id',
      '--root',
      SHA,
    ]);
    expect(calls).toContainEqual([
      'diff-tree',
      '-r',
      '--raw',
      '--no-renames',
      '--no-abbrev',
      '-z',
      START,
      TIP,
    ]);
  });

  it('reports identity_mismatch for a short log record', () => {
    const short = ['a'.repeat(40), '', 'n', 'e', 'n'].join('\x1f');
    const { runner } = fake({ log: `${short}\0`, perCommit: '', net: '' });
    expect(checkHistory(CTX, runner)).toEqual(['identity_mismatch']);
  });

  it('reports nothing for a valid, empty range', () => {
    const { runner } = fake({ log: `${LOG}\0`, perCommit: '', net: '' });
    expect(checkHistory(CTX, runner)).toEqual([]);
  });
});
