import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { checkWorkflow } from './workflows.ts';

const path = fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url));
const text = readFileSync(path, 'utf8');

type Job = { if?: string; needs?: string | string[]; steps?: { run?: string }[] };
const jobs = (parse(text) as { jobs: Record<string, Job> }).jobs;

const needsOf = (job: string): string[] => {
  const needs = jobs[job]?.needs ?? [];
  return Array.isArray(needs) ? needs : [needs];
};

// Runs the gate's script under bash with each job's result as its env var.
const runGate = (results: Record<string, string>) => {
  const run = jobs.gate?.steps?.[0]?.run ?? '';
  const env: Record<string, string> = { PATH: process.env.PATH ?? '' };
  for (const [name, value] of Object.entries({
    changes: 'success',
    static: 'success',
    tests: 'success',
    e2e: 'success',
    markdown: 'success',
    ...results,
  })) {
    env[name.toUpperCase()] = value;
  }
  return spawnSync('bash', ['-c', run], { env, encoding: 'utf8' });
};

describe('ci.yml', () => {
  it('passes the workflow check with zero findings', () => {
    expect(checkWorkflow({ path: '.github/workflows/ci.yml', text })).toEqual([]);
  });

  it('runs the workflow check and actionlint after the repo checks', () => {
    const repo = text.indexOf('pnpm check:repo');
    const wf = text.indexOf('pnpm check:workflows');
    const lint = text.indexOf('"$dir/actionlint"');
    expect(repo).toBeGreaterThan(-1);
    expect(wf).toBeGreaterThan(repo);
    expect(lint).toBeGreaterThan(wf);
  });

  it('pins actionlint by version and sha256, and verifies the checksum', () => {
    expect(text).toContain('releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz');
    expect(text).toContain('8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8');
    expect(text).toContain('sha256sum -c');
  });

  it('has no expression inside the actionlint run block', () => {
    const start = text.indexOf('actionlint (pinned');
    const end = text.indexOf('template checks');
    expect(text.slice(start, end)).not.toContain('${{');
  });

  it('gates on changes, static, tests, e2e and markdown', () => {
    expect(jobs.gate?.if).toBe('always()');
    for (const job of ['changes', 'static', 'tests', 'e2e', 'markdown']) {
      expect(needsOf('gate')).toContain(job);
    }
  });

  it('makes tests, e2e and markdown wait for changes', () => {
    for (const job of ['tests', 'e2e', 'markdown']) {
      expect(needsOf(job)).toContain('changes');
    }
  });

  it.skipIf(process.platform === 'win32')(
    'gate passes when changes succeeded and tests were skipped',
    () => {
      const result = runGate({ tests: 'skipped', e2e: 'skipped', markdown: 'skipped' });
      expect(result.status).toBe(0);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'gate fails when changes failed, even if tests were skipped',
    () => {
      const result = runGate({ changes: 'failure', tests: 'skipped' });
      expect(result.status).not.toBe(0);
    },
  );

  it.skipIf(process.platform === 'win32')('gate fails when static failed', () => {
    const result = runGate({ static: 'failure' });
    expect(result.status).not.toBe(0);
  });
});
