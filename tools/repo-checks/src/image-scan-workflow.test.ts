import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { checkWorkflow } from './workflows.ts';

const PATH = fileURLToPath(new URL('../../../.github/workflows/image-scan.yml', import.meta.url));
const TEXT = readFileSync(PATH, 'utf8');
// biome-ignore lint/suspicious/noExplicitAny: workflow YAML is read loosely
const wf = parse(TEXT) as any;
// biome-ignore lint/suspicious/noExplicitAny: workflow YAML is read loosely
const steps: any[] = wf.jobs.scan.steps;
const step = (prefix: string) => steps.find((s) => String(s.uses).startsWith(prefix));

describe('image-scan.yml', () => {
  it('passes the workflow check with zero findings', () => {
    expect(checkWorkflow({ path: 'image-scan.yml', text: TEXT })).toEqual([]);
  });

  it('holds exactly contents: read, at the top and in no job', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
    expect(Object.keys(wf.jobs)).toEqual(['scan']);
    expect(wf.jobs.scan.permissions).toBeUndefined();
  });

  it('has no login, no cosign, no secret and pushes nothing', () => {
    expect(TEXT).not.toMatch(/login-action|cosign|secrets\.|id-token|packages:/);
    expect(step('docker/build-push-action').with.push).toBe(false);
    expect(step('docker/build-push-action').with.target).toBe('kit');
  });

  it('pins the scanners and uses the strict fail settings', () => {
    const trivy = step('aquasecurity/trivy-action');
    expect(trivy.uses).toContain('ed142fd0673e97e23eac54620cfb913e5ce36c25');
    expect(trivy.with).toMatchObject({
      severity: 'CRITICAL',
      'exit-code': '1',
      'ignore-unfixed': false,
      version: 'v0.76.1',
      cache: false,
    });
    const grype = step('anchore/scan-action');
    expect(grype.uses).toContain('27805bf3b4e84b4a5c980df22ed233c00390a439');
    expect(grype.with).toMatchObject({
      'fail-build': true,
      'severity-cutoff': 'critical',
      'only-fixed': false,
      'grype-version': 'v0.121.0',
    });
  });

  it('triggers on pull_request, main, a weekly schedule and dispatch only', () => {
    expect(Object.keys(wf.on).sort()).toEqual([
      'pull_request',
      'push',
      'schedule',
      'workflow_dispatch',
    ]);
    expect(wf.on.push.branches).toEqual(['main']);
  });
});
