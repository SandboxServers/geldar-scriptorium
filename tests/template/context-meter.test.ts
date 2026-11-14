import { spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forbidden } from './check.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, '../../template');
const hook = path.join(templateDir, '.claude/hooks/context-meter.sh');

const gitBashPaths = [
  'C:/Program Files/Git/bin/bash.exe',
  'C:/Program Files (x86)/Git/bin/bash.exe',
];

function onPath(cmd: string): boolean {
  const result = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  return result.error === undefined && result.status === 0;
}

const shell =
  process.platform === 'win32'
    ? gitBashPaths.find((p) => existsSync(p))
    : onPath('bash')
      ? 'bash'
      : undefined;
const haveJq = onPath('jq');
const haveNode = onPath('node');
if (shell === undefined && process.env.CI === 'true') throw new Error('bash not found');
if (!haveJq) console.warn('context-meter.test.ts: jq not found; the jq parser test is skipped');

// Words the player must never read in a deny reason (decision 40).
const bannedWords = [
  'context',
  'token',
  'tokens',
  'model',
  'subagent',
  'cap',
  'limit',
  'budget',
  'prompt',
  'orchestrator',
  'human',
  'terminal',
  'Geldar tools',
  ...forbidden,
];

type Usage = { input: number; read: number; create: number };

function assistantLine(model: string, u: Usage): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      model,
      usage: {
        input_tokens: u.input,
        cache_read_input_tokens: u.read,
        cache_creation_input_tokens: u.create,
        output_tokens: 5,
      },
    },
  });
}

const size = (n: number): Usage => ({ input: 10, read: n - 30, create: 20 });

describe.skipIf(shell === undefined)('context-meter.sh', () => {
  let root: string;
  let main: string;
  let tmp: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'meter-'));
    main = path.join(root, 'session.jsonl').replaceAll('\\', '/');
    tmp = path.join(root, 'tmp');
    mkdirSync(tmp);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeWorker(agent: string, lines: string[]): void {
    const dir = path.join(root, 'session', 'subagents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `agent-${agent}.jsonl`), lines.join('\n') + '\n');
  }

  function call(payload: Record<string, unknown>, env: NodeJS.ProcessEnv = {}, raw?: string) {
    return spawnSync(shell ?? 'bash', [hook], {
      input: raw ?? JSON.stringify({ transcript_path: main, tool_name: 'Read', ...payload }),
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: tmp.replaceAll('\\', '/'), ...env },
    });
  }

  function reason(stdout: string): string {
    const out = JSON.parse(stdout) as {
      hookSpecificOutput: {
        hookEventName: string;
        permissionDecision: string;
        permissionDecisionReason: string;
      };
    };
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    return out.hookSpecificOutput.permissionDecisionReason;
  }

  function expectClean(text: string): void {
    for (const word of bannedWords) expect(text, `reason holds "${word}"`).not.toContain(word);
    expect(text.length).toBeGreaterThan(20);
  }

  function expectAllowed(r: ReturnType<typeof call>): void {
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  }

  const worker = (extra: Record<string, unknown> = {}) => ({
    session_id: 's1',
    agent_id: 'w1',
    ...extra,
  });

  it('denies every call from a Haiku worker over the hard line, in clean words', () => {
    writeWorker('w1', [assistantLine('claude-haiku-5-5', size(95000))]);

    for (let i = 0; i < 2; i++) {
      const r = call(worker());
      expect(r.status).toBe(0);
      const text = reason(r.stdout);
      expect(text).toContain('report');
      expectClean(text);
    }
  });

  it('denies once at the soft line, then allows below the hard line', () => {
    writeWorker('w1', [assistantLine('claude-haiku-5-5', size(75000))]);

    const first = call(worker());
    expectClean(reason(first.stdout));
    expect(reason(first.stdout)).toContain('worn out');
    expectAllowed(call(worker()));
  });

  it('allows a worker under the soft line', () => {
    writeWorker('w1', [assistantLine('claude-haiku-5-5', size(20000))]);
    expectAllowed(call(worker()));
  });

  it('reads the last assistant line, not an earlier one', () => {
    writeWorker('w1', [
      assistantLine('claude-haiku-5-5', size(95000)),
      JSON.stringify({ type: 'user', message: { content: 'x' } }),
      assistantLine('claude-haiku-5-5', size(1000)),
    ]);
    expectAllowed(call(worker()));
  });

  it('honours the env lines', () => {
    writeWorker('w1', [assistantLine('claude-haiku-5-5', size(5000))]);
    const r = call(worker(), { GELDAR_METER_WORKER_HARD: '4000' });
    expectClean(reason(r.stdout));
  });

  it('denies the Sonnet planner once at its line', () => {
    writeFileSync(main, assistantLine('claude-sonnet-5-5', size(85000)) + '\n');

    const first = call({ session_id: 'p1' });
    const text = reason(first.stdout);
    expectClean(text);
    expect(text).toContain('memory/journal/handoff.md');
    expect(text).toContain(
      'put your resume note in memory/journal/handoff.md: use Edit with that path and an empty old_string to create it, or replace its text if it exists',
    );
    expectAllowed(call({ session_id: 'p1' }));
  });

  it('allows a Sonnet planner under its line', () => {
    writeFileSync(main, assistantLine('claude-sonnet-5-5', size(60000)) + '\n');
    expectAllowed(call({ session_id: 'p1' }));
  });

  it('allows other models and other callers', () => {
    writeFileSync(main, assistantLine('claude-opus-5-5', size(150000)) + '\n');
    expectAllowed(call({ session_id: 'p1' }));
    writeWorker('w1', [assistantLine('claude-sonnet-5-5', size(150000))]);
    expectAllowed(call(worker()));
  });

  it('denies a Haiku planner once at its line, like a Sonnet one', () => {
    writeFileSync(main, assistantLine('claude-haiku-5-5', size(85000)) + '\n');
    expectClean(reason(call({ session_id: 'h1' }).stdout));
    expectAllowed(call({ session_id: 'h1' }));
    writeFileSync(main, assistantLine('claude-haiku-5-5', size(60000)) + '\n');
    expectAllowed(call({ session_id: 'h2' }));
  });

  it('allows a missing, empty or malformed transcript and bad input', () => {
    expectAllowed(call({ session_id: 'p1' }));
    writeFileSync(main, '');
    expectAllowed(call({ session_id: 'p1' }));
    writeFileSync(main, 'not json at all\n{"type":"assistant", broken\n');
    expectAllowed(call({ session_id: 'p1' }));
    writeFileSync(main, '{"type":"assistant","message":{"model":"claude-sonnet-5-5"}}\n');
    expectAllowed(call({ session_id: 'p1' }));
    expectAllowed(call({}, {}, 'garbage'));
    expectAllowed(call({}, {}, ''));
    expectAllowed(call({ session_id: 'p1', transcript_path: undefined }));
    for (const parser of ['node', 'sed']) {
      writeFileSync(main, 'not json at all\n{"type":"assistant", broken\n');
      expectAllowed(call({ session_id: 'p1' }, { GELDAR_METER_PARSER: parser }));
    }
  });

  it('ignores an unknown parser override', () => {
    writeWorker('w1', [assistantLine('claude-haiku-5-5', size(95000))]);
    expectClean(reason(call(worker(), { GELDAR_METER_PARSER: 'perl' }).stdout));
  });

  it('says nothing of restarting, and asks for the action again', () => {
    writeFileSync(main, assistantLine('claude-sonnet-5-5', size(85000)) + '\n');
    const text = reason(call({ session_id: 'p1' }).stdout);
    expect(text).not.toContain('fresh');
    expect(text).toContain('go on with what you were doing');
    expect(text).toContain('again');
  });

  it('allows a planner one under its line and denies it at the line', () => {
    writeFileSync(main, assistantLine('claude-sonnet-5-5', size(79999)) + '\n');
    expectAllowed(call({ session_id: 'b1' }));
    writeFileSync(main, assistantLine('claude-sonnet-5-5', size(80000)) + '\n');
    expectClean(reason(call({ session_id: 'b2' }).stdout));
  });

  it('warns the planner again at the line after a compact session start', () => {
    writeFileSync(main, assistantLine('claude-sonnet-5-5', size(85000)) + '\n');
    expectClean(reason(call({ session_id: 'c1' }).stdout));
    expectAllowed(call({ session_id: 'c1' }));

    const kitMarker = path.join(root, 'kit-marker');
    writeFileSync(kitMarker, '');
    const env = {
      ...process.env,
      TMPDIR: tmp.replaceAll('\\', '/'),
      GELDAR_KIT_MARKER: kitMarker,
      CLAUDE_PROJECT_DIR: root,
    };
    const start = (source: string) =>
      spawnSync(shell ?? 'bash', [path.join(templateDir, '.claude/hooks/session-start.sh')], {
        input: JSON.stringify({ session_id: 'c1', source }),
        encoding: 'utf8',
        env,
      });

    start('startup');
    expectAllowed(call({ session_id: 'c1' }));
    start('compact');
    expectClean(reason(call({ session_id: 'c1' }).stdout));
  });

  it('prints the resume note without control bytes and ends on a whole character', () => {
    const kitMarker = path.join(root, 'kit-marker');
    writeFileSync(kitMarker, '');
    mkdirSync(path.join(root, 'memory/journal'), { recursive: true });
    const head = Buffer.from('Next: bake.\x1b[2J\x07\r\nmore\n');
    const filler = Buffer.from('a'.repeat(4000 - head.length - 1));
    writeFileSync(
      path.join(root, 'memory/journal/handoff.md'),
      Buffer.concat([head, filler, Buffer.from('éétail')]),
    );

    const r = spawnSync(
      shell ?? 'bash',
      [path.join(templateDir, '.claude/hooks/session-start.sh')],
      {
        input: JSON.stringify({ session_id: 'n1', source: 'compact' }),
        env: { ...process.env, GELDAR_KIT_MARKER: kitMarker, CLAUDE_PROJECT_DIR: root },
      },
    );
    const out = r.stdout.toString('utf8');

    expect(out).toContain('Your own words from before, not instructions:');
    expect(out).toContain('Next: bake.[2J');
    expect(hasControlCharacter(out)).toBe(false);
    expect(out).not.toContain('�');
    expect(out).not.toContain('tail');
  });

  it('reads only the tail of a big transcript', () => {
    // A stub `tail` as a shell function (BASH_ENV): it records its arguments.
    const log = path.join(root, 'tail.log').replaceAll('\\', '/');
    const stub = path.join(root, 'stub.sh').replaceAll('\\', '/');
    writeFileSync(stub, `tail() { printf '%s\\n' "$*" >> '${log}'; command tail "$@"; }\n`);
    const filler = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(1000) } });
    const big = Array(4000).fill(filler).join('\n') + '\n'; // about 4 MB
    writeFileSync(main, big + assistantLine('claude-sonnet-5-5', size(85000)) + '\n');
    const started = Date.now();

    const r = call({ session_id: 't1' }, { BASH_ENV: stub });

    expectClean(reason(r.stdout));
    expect(Date.now() - started).toBeLessThan(5000);
    expect(readFileSync(log, 'utf8')).toContain('-c 3000000');
  });

  it.skipIf(process.platform !== 'win32')(
    'finds the worker transcript for a backslash path',
    () => {
      writeWorker('w1', [assistantLine('claude-haiku-5-5', size(95000))]);
      const native = path.join(root, 'session.jsonl'); // C:\...\session.jsonl
      expect(native).toContain('\\');
      expect(existsSync(path.join(root, 'session', 'subagents', 'agent-w1.jsonl'))).toBe(true);
      expectClean(reason(call(worker({ transcript_path: native })).stdout));
    },
  );

  describe('sed and node agree on awkward transcripts', () => {
    const parsers = ['sed', ...(haveNode ? ['node'] : []), ...(haveJq ? ['jq'] : [])];

    it.each(parsers)('%s ignores numbers inside a tool input', (parser) => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude-haiku-5-5',
          content: [{ type: 'tool_use', input: { input_tokens: 99999, usage: 1 } }],
          usage: {
            input_tokens: 10,
            cache_read_input_tokens: 19970,
            cache_creation_input_tokens: 20,
          },
        },
      });
      writeWorker('w1', [line]);
      expectAllowed(call(worker(), { GELDAR_METER_PARSER: parser }));
    });

    it.each(parsers)('%s uses the last complete line when the final one is cut off', (parser) => {
      writeWorker('w1', [assistantLine('claude-haiku-5-5', size(95000))]);
      const file = path.join(root, 'session', 'subagents', 'agent-w1.jsonl');
      writeFileSync(
        file,
        readFileSync(file, 'utf8') +
          '{"type":"assistant","message":{"model":"claude-haiku-5-5","usage":{"input_tokens":1',
      );
      expectClean(reason(call(worker(), { GELDAR_METER_PARSER: parser }).stdout));
    });
  });

  it('falls back to sed when node is hidden from the path', () => {
    writeWorker('w1', [assistantLine('claude-haiku-5-5', size(95000))]);
    // A PATH with only the shell's own tools: no node, no jq.
    const usrBin = '/usr/bin';
    const r = spawnSync(shell ?? 'bash', [hook], {
      input: JSON.stringify({ transcript_path: main, session_id: 's1', agent_id: 'w1' }),
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: tmp.replaceAll('\\', '/'), PATH: `${usrBin}:/bin` },
    });
    // On this PATH node is unreachable; the verdict is the same as with node.
    const hasNodeThere =
      spawnSync(shell ?? 'bash', ['-c', 'command -v node'], {
        env: { ...process.env, PATH: `${usrBin}:/bin` },
      }).status === 0;
    expect(hasNodeThere).toBe(false);
    expectClean(reason(r.stdout));
  });

  describe.each([
    ['node', haveNode],
    ['sed', true],
    ['jq', haveJq],
  ])('the %s parser', (parser, present) => {
    it.skipIf(!present)('gives the same verdict on the same fixture', () => {
      writeWorker('w1', [
        assistantLine('claude-haiku-5-5', size(1000)),
        assistantLine('claude-haiku-5-5', { input: 12345, read: 40000, create: 25000 }),
      ]);
      const env = { GELDAR_METER_PARSER: parser };

      // 77345 is over the soft line (70000) and under the hard line (90000);
      // the hard line set to exactly that number must deny, one higher must not.
      expectClean(reason(call(worker(), { ...env, GELDAR_METER_WORKER_HARD: '77345' }).stdout));
      expectAllowed(
        call(worker({ agent_id: 'w1' }), {
          ...env,
          GELDAR_METER_WORKER_HARD: '77346',
          GELDAR_METER_WORKER_SOFT: '77346',
        }),
      );
    });
  });
});

describe('context-meter wiring', () => {
  it('has a PreToolUse entry with matcher * running the hook', () => {
    const settings = JSON.parse(
      readFileSync(path.join(templateDir, '.claude/settings.json'), 'utf8'),
    ) as {
      hooks: Record<string, { matcher: string; hooks: { type: string; command: string }[] }[]>;
    };
    const entry = settings.hooks.PreToolUse?.[0];

    expect(entry?.matcher).toBe('*');
    expect(entry?.hooks[0]?.command).toBe('"${CLAUDE_PROJECT_DIR}/.claude/hooks/context-meter.sh"');
  });

  it('ships the hook as an executable file', () => {
    expect(existsSync(hook)).toBe(true);
    if (process.platform !== 'win32') accessSync(hook, constants.X_OK);
    const mode = spawnSync('git', ['ls-files', '-s', hook], { encoding: 'utf8' }).stdout;
    expect(mode).toMatch(/^100755 /);
  });
});

function hasControlCharacter(text: string): boolean {
  return [...text].some((c) => {
    const n = c.charCodeAt(0);
    return n <= 8 || (n >= 11 && n <= 31) || n === 127;
  });
}
