import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkWorkflow } from './workflows.ts';

const path = fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url));
const text = readFileSync(path, 'utf8');

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
});
