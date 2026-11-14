import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeFixture, onPoll } from './fixture.ts';
import { readSettings, SettingError } from './settings.ts';
import { wrapperLine } from './supervisor.ts';

type Fixture = ReturnType<typeof makeFixture>;

const head = 'This is your waking number';
const limit = { GELDAR_TIDY_BYTES: '1000', GELDAR_RUN_MAX_FAILS: '99' };

function setJournal(f: Fixture, bytes: number, ch = 'x'): void {
  const dir = join(f.root, 'ws/memory/journal');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'current.md'), `# Journal\n${ch.repeat(bytes)}`);
}

const ws = (f: Fixture, name: string) => join(f.root, 'ws', name);
const pending = (f: Fixture) => ws(f, 'memory/journal/pending.md');

/** What a clean tidy leaves behind: a new summary. */
function cleanTidy(f: Fixture): void {
  mkdirSync(ws(f, 'memory'), { recursive: true });
  writeFileSync(ws(f, 'memory/summary.md'), `summary ${Math.random()}\n`);
}

const repo = (name: string) => fileURLToPath(new URL(`../../../${name}`, import.meta.url));

/** Records the prompt file of each child at launch; `after` may change the journal as a tidy would. */
function watch(f: Fixture, after: (turns: string) => void = () => {}) {
  const seen: { prompt: string; turns: string; args: string }[] = [];
  const real = f.deps.exec;
  f.deps.exec = async (spec) => {
    if (spec.file === 'sh') {
      seen.push({
        prompt: readFileSync(spec.promptPath ?? '', 'utf8'),
        turns: spec.env?.GELDAR_RUN_MAX_TURNS ?? '',
        args: spec.args.join(' '),
      });
      after(spec.env?.GELDAR_RUN_MAX_TURNS ?? '');
    }
    return real(spec);
  };
  return seen;
}

describe('the memory tidy', () => {
  it('reads its settings with the defaults', () => {
    const s = readSettings({});
    expect([s.tidyBytes, s.tidyMaxTurns]).toEqual([30000, 40]);
    expect(() => readSettings({ GELDAR_TIDY_MAX_TURNS: '0' })).toThrow(SettingError);
    expect(() => readSettings({ GELDAR_TIDY_BYTES: 'big' })).toThrow(SettingError);
  });

  it('runs one tidy first when the journal is over the limit, the prompt on fd 3 only', async () => {
    const f = makeFixture({ tools: 3, last: 'tidy done' }, limit);
    setJournal(f, 2000);
    const atLaunch: (boolean | string)[] = [];
    const seen = watch(f, (turns) => {
      if (turns === '40') {
        atLaunch.push(
          existsSync(pending(f)),
          readFileSync(ws(f, 'memory/journal/current.md'), 'utf8'),
        );
        cleanTidy(f);
      }
    });
    onPoll(f, (poll) => {
      if (poll === 2) f.supervisor.requestStop();
    });
    expect(await f.supervisor.run()).toBe(0);
    expect(seen[0]?.turns).toBe('40');
    expect(seen[0]?.prompt).toContain('memory/journal/current.md');
    expect(seen[0]?.prompt).not.toContain(head);
    // The prompt never appears in the command line, only in the file handed over as descriptor 3.
    expect(seen[0]?.args).not.toContain('memory/journal');
    expect(f.runs()[0]?.promptPath).toBeDefined();
    // The journal was moved before the run: pending.md held the old text, current.md only the heading.
    expect(atLaunch).toEqual([true, '# Journal\n']);
    // A clean tidy removed pending.md and left the fresh page.
    expect(existsSync(pending(f))).toBe(false);
    expect(readFileSync(ws(f, 'memory/journal/current.md'), 'utf8')).toBe('# Journal\n');
    expect(f.read('supervisor.log')).toContain('emptied=true');
    // The next run is an ordinary one and does not carry the tidy's last words.
    expect(seen[1]?.turns).toBe('300');
    expect(seen[1]?.prompt).toContain(head);
    expect(seen[1]?.prompt).not.toContain('tidy done');
  });

  it('gives the fresh journal and pending.md mode 0666 under a restrictive umask', async () => {
    const old = process.umask(0o027);
    try {
      const f = makeFixture({ tools: 3 }, limit);
      setJournal(f, 2000);
      const modes: number[] = [];
      watch(f, () => {
        modes.push(
          statSync(ws(f, 'memory/journal/current.md')).mode & 0o777,
          statSync(pending(f)).mode & 0o777,
        );
      });
      onPoll(f, () => f.supervisor.requestStop());
      await f.supervisor.run();
      // POSIX only: Windows does not keep these bits.
      if (process.platform !== 'win32') expect(modes).toEqual([0o666, 0o666]);
      else expect(modes).toHaveLength(2);
    } finally {
      process.umask(old);
    }
  });

  it('does not tidy under the limit, with the limit at 0, or without a journal', async () => {
    for (const [bytes, env] of [
      [900, limit],
      [5000, { GELDAR_TIDY_BYTES: '0' }],
      [-1, limit],
    ] as const) {
      const f = makeFixture({ tools: 3 }, env);
      if (bytes >= 0) setJournal(f, bytes);
      const seen = watch(f);
      onPoll(f, () => f.supervisor.requestStop());
      await f.supervisor.run();
      expect(seen.map((s) => s.turns)).toEqual(['300']);
    }
  });

  it('does not run a tidy while HELD', async () => {
    const f = makeFixture({ tools: 3 }, limit);
    setJournal(f, 5000);
    writeFileSync(join(f.keeperDir, 'HELD'), 'rejected\n');
    onPoll(f, () => f.supervisor.requestStop());
    await f.supervisor.run();
    expect(f.runs()).toHaveLength(0);
  });

  it('holds back after a failed tidy until half the limit more was written', async () => {
    const f = makeFixture({ tools: 3 }, limit);
    setJournal(f, 2000);
    const seen = watch(f);
    onPoll(f, (poll) => {
      // The tidy never shrinks the journal, so it counts as failed.
      if (poll === 3) setJournal(f, 100, 'z');
      if (poll === 5) setJournal(f, 600, 'y');
      if (poll === 6) f.supervisor.requestStop();
    });
    await f.supervisor.run();
    expect(seen.map((s) => s.turns)).toEqual(['40', '300', '300', '300', '300', '40']);
    expect(f.read('supervisor.log')).toContain('emptied=false');
    // The failed tidy kept pending.md and the retry appended to it, never overwriting.
    const text = readFileSync(pending(f), 'utf8');
    expect(text).toContain('xxxx');
    expect(text).toContain('yyyy');
  });

  it('removes pending.md only after a tidy that changed the summary or a day file', async () => {
    const f = makeFixture({ tools: 3 }, limit);
    setJournal(f, 2000);
    watch(f);
    onPoll(f, (poll) => {
      if (poll === 1) f.supervisor.requestStop();
    });
    await f.supervisor.run();
    expect(existsSync(pending(f))).toBe(true);
  });

  it('gives the tidy a settings overlay and agent with no world tool', () => {
    const f = makeFixture();
    const tidy = JSON.parse(readFileSync(repo('image/settings/tidy.json'), 'utf8'));
    expect(tidy.agent).toBe('tidier');
    expect(tidy.permissions.deny).toContain('mcp__geldar__*');
    expect(tidy.enabledMcpjsonServers).not.toContain('geldar');
    const agent = readFileSync(repo('template/.claude/agents/tidier.md'), 'utf8');
    expect(agent).not.toContain('mcp__geldar__');
    expect(agent).not.toMatch(/initialPrompt/);
    expect(wrapperLine(f.settings, true)).toContain('/settings/tidy.json');
    expect(wrapperLine(f.settings)).toContain('/settings/play.json');
  });

  it('holds back after a failed tidy for ten normal runs at most', async () => {
    const f = makeFixture({ tools: 3 }, limit);
    setJournal(f, 2000);
    const seen = watch(f);
    onPoll(f, (poll) => {
      if (poll === 12) f.supervisor.requestStop();
    });
    await f.supervisor.run();
    expect(seen.map((s) => s.turns)).toEqual(['40', ...Array(10).fill('300'), '40']);
  });
});
