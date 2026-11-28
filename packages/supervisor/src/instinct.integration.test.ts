// The supervisor's instinct step against the real `geldar-instinct` child and the fake world on 127.0.0.1 (HC-24). The
// model run is the fixture's fake run. The golden (instinct.integration.golden.json) is the child's environment, argv,
// stdio, files under instinct/ and audit lines for the standard sheet with sanity unset, captured from commit 1a852b3
// (the state before HC-23b). Volatile values are scrubbed: the temp root, the world port and timestamps.
import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { type FakeWorld, startFakeWorld } from '../../instinct/src/fake-world.fixture.ts';
import { createExecSelf, type SpawnFn } from './deps.ts';
import { makeFixture, onPoll } from './fixture.ts';

const CLI = fileURLToPath(new URL('../../instinct/src/cli.ts', import.meta.url));
const GOLDEN = fileURLToPath(new URL('./instinct.integration.golden.json', import.meta.url));
/** The standard sheet: every score 3 (the same sheet as the instinct integration test). */
const SHEET = JSON.stringify({
  version: 1,
  attributes: { curiosity: 3, common_sense: 3, cleverness: 3, aggression: 3 },
  alignment: { law: 3, good: 3 },
  op_modes: { explorer: 3, farmer: 3, miner: 3, builder: 3, crafter: 3, warrior: 3, nitwit: 3 },
});
/** A wait reply with one agent in view that the step has never seen: a forced pass (first_sighting). */
const FIRST_SIGHTING = JSON.stringify({
  snapshot: { surroundings: { agents: [{ name: 'Ann', distance: 3 }] } },
});
/** The five SanityParams keys the chatgpt case hands on descriptor 4, and no other. */
const FIVE_KEYS = ['arm', 'common_sense', 'life', 'rolls', 'v'];

/** One spawn of the real child: the argv the supervisor named, the environment and the stdio array it gave. */
interface Spawned {
  argv: string[];
  env: Record<string, string>;
  stdio: unknown[];
}

/** What one waking did: the child spawns, the world's calls, descriptor 4 of the model run and the folders. */
interface Waking {
  spawned: Spawned[];
  calls: FakeWorld['calls'];
  fd4: string | null;
  root: string;
  port: string;
  stateDir: string;
  modelRuns: number;
}

const worlds: FakeWorld[] = [];

afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close();
});

/**
 * Runs one waking of the supervisor with the instinct step on `env` (the settings), the given sheet in the instinct
 * folder (null for none) and the fake world as the life's address. The child is the real `geldar-instinct`.
 */
async function wake(env: Record<string, string>, sheet: string | null): Promise<Waking> {
  const world = await startFakeWorld({ wait: [FIRST_SIGHTING] });
  worlds.push(world);
  const f = makeFixture({ secs: 60 }, env, {
    GELDAR_MCP_URL: world.url,
    GELDAR_MCP_TOKEN: 'test-token',
  });
  if (sheet !== null) {
    mkdirSync(join(f.stateDir, 'instinct'), { recursive: true });
    writeFileSync(join(f.stateDir, 'instinct', 'sheet.json'), sheet, { mode: 0o600 });
  }
  const spawned: Spawned[] = [];
  // The real spawn, recording what the supervisor passes it; `geldar-instinct` runs as the cli.ts it names.
  const recording = ((file: string, args: string[], options: SpawnOptions): ChildProcess => {
    spawned.push({
      argv: [file, ...args],
      env: { ...(options.env as Record<string, string>) },
      stdio: [...(options.stdio as unknown[])],
    });
    return spawn(process.execPath, [CLI, ...args], options);
  }) as unknown as SpawnFn;
  f.deps.execSelf = createExecSelf(recording);
  let fd4: string | null = null;
  const exec = f.deps.exec;
  f.deps.exec = async (spec) => {
    if (spec.paramsPath !== undefined) fd4 = readFileSync(spec.paramsPath, 'utf8');
    return exec(spec);
  };
  onPoll(f, () => f.supervisor.requestStop());
  await f.supervisor.run();
  return {
    spawned,
    calls: world.calls,
    fd4,
    root: f.root,
    port: new URL(world.url).port,
    stateDir: f.stateDir,
    modelRuns: f.runs().length,
  };
}

/** The volatile parts replaced by fixed tokens: the temp root, the world port and ISO timestamps; separators are `/`. */
function scrub(value: unknown, w: Waking): unknown {
  if (typeof value === 'string') {
    return value
      .split(w.root)
      .join('<ROOT>')
      .split('\\')
      .join('/')
      .split(`:${w.port}`)
      .join(':<PORT>')
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<TS>');
  }
  if (Array.isArray(value)) return value.map((x) => scrub(x, w));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, scrub(x, w)]));
  }
  return value;
}

/** Every file under the instinct folder, by its path below it (forward slashes), as text. */
function instinctFiles(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of readdirSync(dir, { recursive: true }) as string[]) {
    const path = join(dir, rel);
    if (statSync(path).isFile()) out[rel.split(sep).join('/')] = readFileSync(path, 'utf8');
  }
  return out;
}

/** The audit lines of the waking, with their timestamps removed (the rest is compared as it is). */
function auditLines(stateDir: string): Array<Record<string, unknown>> {
  const file = join(stateDir, 'instinct.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const obj = JSON.parse(line) as Record<string, unknown>;
      delete obj.ts;
      return obj;
    });
}

/** The comparable record of one waking, scrubbed. Stdio descriptors are numbers and read as `<fd>`. */
function recordOf(w: Waking): unknown {
  return scrub(
    {
      child: w.spawned.map((s) => ({
        argv: s.argv,
        env: s.env,
        stdio: s.stdio.map((x) => (typeof x === 'number' ? '<fd>' : x)),
      })),
      instinct: instinctFiles(join(w.stateDir, 'instinct')),
      audit: auditLines(w.stateDir),
      world: w.calls.map((c) => ({ name: c.name, args: c.args })),
    },
    w,
  );
}

describe('the supervisor and the instinct child against the fake world', () => {
  it.each([
    ['unset', {}],
    ['off', { GELDAR_INSTINCT_SANITY: 'off' }],
  ])(
    'case 1, instinct off (sanity %s): no child, no world contact, the model runs',
    async (_, extra) => {
      const w = await wake({ ...extra }, SHEET);
      expect(w.spawned).toEqual([]);
      expect(w.calls).toEqual([]);
      expect(existsSync(join(w.stateDir, 'instinct.jsonl'))).toBe(false);
      expect(w.modelRuns).toBe(1);
      expect(w.fd4).toBeNull();
    },
  );

  it('case 2, sanity unset: the run equals the golden', async () => {
    const w = await wake({ GELDAR_INSTINCT: 'on' }, SHEET);
    expect(w.spawned).toHaveLength(1);
    expect(recordOf(w)).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
  });

  it('case 3, sanity on, chatgpt: descriptor 4 holds the five SanityParams keys only', async () => {
    const w = await wake(
      { GELDAR_INSTINCT: 'on', GELDAR_INSTINCT_SANITY: 'on', GELDAR_HARNESS: 'chatgpt' },
      SHEET,
    );
    expect(w.fd4).not.toBeNull();
    expect(Object.keys(JSON.parse(w.fd4 as string)).sort()).toEqual(FIVE_KEYS);
    expect(existsSync(join(w.stateDir, 'instinct', 'sanity.json'))).toBe(true);
  });

  it('case 4, sanity on, claude: no descriptor 4 and no sanity.json', async () => {
    const w = await wake({ GELDAR_INSTINCT: 'on', GELDAR_INSTINCT_SANITY: 'on' }, SHEET);
    expect(w.spawned).toHaveLength(1);
    expect(w.fd4).toBeNull();
    expect(existsSync(join(w.stateDir, 'instinct', 'sanity.json'))).toBe(false);
  });

  it('case 5, no sheet and no roster: the run equals the run with sanity off', async () => {
    const off = await wake({ GELDAR_INSTINCT: 'on', GELDAR_HARNESS: 'chatgpt' }, null);
    const on = await wake(
      { GELDAR_INSTINCT: 'on', GELDAR_HARNESS: 'chatgpt', GELDAR_INSTINCT_SANITY: 'on' },
      null,
    );
    expect(on.fd4).toBeNull();
    expect(on.calls).toEqual([]);
    // The child's argv, files, audit and world calls are the same as with the switch off (the env differs by the switch).
    const a = recordOf(on) as Record<string, unknown>;
    const b = recordOf(off) as Record<string, unknown>;
    expect(a.instinct).toEqual(b.instinct);
    expect(a.audit).toEqual(b.audit);
    expect(a.world).toEqual(b.world);
    expect(Object.keys(a.instinct as object)).toEqual(['last.json']);
    expect(JSON.parse((a.instinct as Record<string, string>)['last.json'] ?? '{}').reason).toBe(
      'no_sheet',
    );
  });
});
