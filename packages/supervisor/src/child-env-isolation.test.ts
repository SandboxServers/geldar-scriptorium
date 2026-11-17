import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExecSpec } from './deps.ts';
import { makeFixture, onPoll } from './fixture.ts';
import { readSettings } from './settings.ts';
import { childEnv } from './supervisor.ts';
import { GIT_ENV } from './upstream.ts';

// HC-26 extension (unit level): the model child inherits nothing of the supervisor's environment.
// Every canary is fake. The supervisor's environment carries them; no child and no file may.

const CANARY = 'canary-ingest-token-7f3a';

/** The supervisor's environment: telemetry vocabulary, a foreign trace context and ambient secrets. */
const CANARY_ENV: Record<string, string> = {
  PATH: '/usr/bin',
  HOME: '/root',
  GELDAR_INGEST_TOKEN: CANARY,
  OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${CANARY}`,
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://canary.invalid:4318',
  OTEL_SERVICE_NAME: 'canary-service',
  OTEL_RESOURCE_ATTRIBUTES: 'canary.attr=1',
  GELDAR_TELEMETRY_URL: 'http://canary.invalid/ingest',
  GELDAR_PLAYER_ID: 'canary-player',
  TRACEPARENT: '00-canary0000000000000000000000000-0000000000000001-01',
  TRACESTATE: 'canary=1',
  CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: 'canary',
  OTEL_LOG_USER_PROMPTS: 'canary',
  GH_TOKEN: 'canary-github',
  OPENAI_API_KEY: 'canary-openai',
  AWS_SECRET_ACCESS_KEY: 'canary-aws',
  // The model needs these two, so they are passed on purpose (see the first test). Their values
  // carry no canary: they are not the telemetry canary's category.
  CLAUDE_CODE_OAUTH_TOKEN: 'fake-oauth-7f3a',
  GELDAR_MCP_TOKEN: 'fake-mcp-7f3a',
};

/** The names a model child may carry: childEnv's own set and the pass-through names that are set. */
const ALLOWED: readonly string[] = [
  'HOME',
  'CLAUDE_CONFIG_DIR',
  'GELDAR_MODE',
  'PATH',
  'GELDAR_RUN_MAX_TURNS',
  'GELDAR_RUN_MODEL',
  'NODE_USE_ENV_PROXY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'GELDAR_MCP_TOKEN',
];

/** The names the git calls add to the child's environment (upstream.ts GIT_ENV). */
const GIT_NAMES: readonly string[] = Object.keys(GIT_ENV);

/** Telemetry-looking names: none may reach a child unless it is in the allow-list. */
const TELEMETRY_KEY = /otel|telemetry|ingest|trace|monitor|tracestate/i;

/** Asserts one captured environment: no canary, no telemetry-looking name, only allow-listed names. */
function assertIsolated(label: string, env: Record<string, string>, allowed: readonly string[]) {
  const leaked = Object.entries(env)
    .filter(([key, value]) => key.includes('canary') || value.includes('canary'))
    .map(([key]) => key);
  expect(leaked, `${label}: names whose value or name carries the canary`).toEqual([]);
  const telemetry = Object.keys(env).filter(
    (key) => TELEMETRY_KEY.test(key) && !allowed.includes(key),
  );
  expect(telemetry, `${label}: telemetry-looking names`).toEqual([]);
  const outside = Object.keys(env).filter((key) => !allowed.includes(key));
  expect(outside, `${label}: names outside the allow-list`).toEqual([]);
}

/** Every child the supervisor started: the allow-list of a git call adds GIT_ENV, nothing else does. */
function assertSpecs(specs: ExecSpec[]): void {
  expect(specs.length).toBeGreaterThan(0);
  for (const spec of specs) {
    const allowed = spec.file === 'git' ? [...ALLOWED, ...GIT_NAMES] : ALLOWED;
    assertIsolated(`${spec.file} ${spec.args.join(' ')}`, spec.env, allowed);
  }
}

/** A play run with one stop: the run, the save step and the idle wait all happen in the fixture. */
function playRun() {
  const f = makeFixture({ last: 'done', stopAt: 1 }, {}, CANARY_ENV);
  onPoll(f, () => f.supervisor.requestStop());
  return f;
}

describe('the model child inherits none of the supervisor environment', () => {
  it('gives a play run and the save step only the allowed names, with the model credentials', async () => {
    const f = playRun();
    expect(await f.supervisor.run()).toBe(0);
    expect(f.runs()).toHaveLength(1);
    expect(f.specs.filter((s) => s.file === 'geldar-git')).toHaveLength(1);
    assertSpecs(f.specs);
    // The canaries are really in the supervisor's environment: the model still gets its own two.
    const run = f.runs()[0];
    expect(run?.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(CANARY_ENV.CLAUDE_CODE_OAUTH_TOKEN);
    expect(run?.env.GELDAR_MCP_TOKEN).toBe(CANARY_ENV.GELDAR_MCP_TOKEN);
  });

  it('gives a tidy run only the allowed names', async () => {
    const f = makeFixture(
      { last: 'tidy done', stopAt: 1 },
      { GELDAR_TIDY_BYTES: '1000', GELDAR_RUN_MAX_FAILS: '99' },
      CANARY_ENV,
    );
    const journal = join(f.root, 'ws/memory/journal');
    mkdirSync(journal, { recursive: true });
    writeFileSync(join(journal, 'current.md'), `# Journal\n${'x'.repeat(2000)}`);
    onPoll(f, () => f.supervisor.requestStop());
    expect(await f.supervisor.run()).toBe(0);
    const tidy = f.runs()[0];
    expect(tidy?.args.join(' ')).toContain('tidy.json');
    assertSpecs(f.specs);
  });

  it('gives the upstream sync git calls only the allowed names and GIT_ENV', async () => {
    const f = makeFixture({}, {}, CANARY_ENV);
    // A manifest that is not a commit id: the sync asks git for the tip first, then refuses.
    writeFileSync(join(f.keeperDir, 'upstream.json'), '{"head":"not-a-sha"}');
    onPoll(f, () => f.supervisor.requestStop());
    expect(await f.supervisor.run()).toBe(0);
    const git = f.specs.filter((s) => s.file === 'git');
    expect(git.length).toBeGreaterThan(0);
    assertSpecs(git);
  });

  it('writes no canary to the files the operators read', async () => {
    const f = playRun();
    expect(await f.supervisor.run()).toBe(0);
    for (const name of ['supervisor.log', 'status.json', 'costs.csv', 'prompt.txt']) {
      expect(f.has(name), name).toBe(true);
      expect(f.read(name), name).not.toContain('canary');
    }
  });

  it.each(['claude', 'chatgpt'] as const)(
    'childEnv for %s carries none of the canaries',
    (harness) => {
      const settings = readSettings({ GELDAR_HARNESS: harness, GELDAR_RUN_MODEL: 'account-model' });
      const env = childEnv(settings, CANARY_ENV);
      assertIsolated(`childEnv ${harness}`, env, ALLOWED);
      // The MCP token always goes to the model; the CLI token only to the Claude harness.
      expect(env.GELDAR_MCP_TOKEN).toBe(CANARY_ENV.GELDAR_MCP_TOKEN);
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(
        harness === 'claude' ? CANARY_ENV.CLAUDE_CODE_OAUTH_TOKEN : undefined,
      );
    },
  );
});
