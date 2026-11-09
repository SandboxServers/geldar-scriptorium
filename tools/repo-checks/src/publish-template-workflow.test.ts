import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { checkWorkflow } from './workflows.ts';

const path = resolve(import.meta.dirname, '../../../.github/workflows/publish-template.yml');
const text = readFileSync(path, 'utf8');
// biome-ignore lint/suspicious/noExplicitAny: structural test over parsed YAML
const wf: any = parse(text);
// biome-ignore lint/suspicious/noExplicitAny: structural test over parsed YAML
const steps: any[] = wf.jobs.publish.steps;

const PINS = [
  'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
  'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1',
  'azure/login@a641126d1b8aa4d1fa005f4f92df94a3a4c4c906',
  'actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510',
];

describe('publish-template.yml', () => {
  it('passes the workflow lint with zero findings', () => {
    expect(checkWorkflow({ path: 'publish-template.yml', text })).toEqual([]);
  });

  it('triggers only on workflow_call and workflow_dispatch', () => {
    expect(Object.keys(wf.on).sort()).toEqual(['workflow_call', 'workflow_dispatch']);
    expect(wf.permissions).toEqual({});
  });

  it('has exactly two jobs with minimal permissions', () => {
    expect(Object.keys(wf.jobs)).toEqual(['assemble', 'publish']);
    expect(wf.jobs.assemble.permissions).toEqual({ contents: 'read' });
    expect(wf.jobs.publish.permissions).toEqual({ 'id-token': 'write', contents: 'read' });
  });

  it('gates publish on the tag push, the repository and never workflow_call', () => {
    const cond: string = wf.jobs.publish.if;
    expect(cond).toContain("github.event_name == 'push'");
    expect(cond).toContain("startsWith(github.ref, 'refs/tags/kit-v')");
    expect(cond).toContain("github.repository == 'SandboxServers/geldar-scriptorium'");
    expect(text).not.toMatch(/if:.*workflow_call/);
  });

  it('orders the publish steps', () => {
    const kinds = steps.map((s) =>
      s.uses ? String(s.uses).split('@')[0] : s.id === 'keyvault' ? 'keyvault' : s.name,
    );
    const at = (k: string) => kinds.indexOf(k);
    expect(at('actions/checkout')).toBeLessThan(at('Tag guard'));
    expect(at('Tag guard')).toBeLessThan(at('azure/login'));
    expect(at('azure/login')).toBeLessThan(at('keyvault'));
    expect(at('keyvault')).toBeLessThan(at('actions/create-github-app-token'));
    expect(at('actions/create-github-app-token')).toBeLessThan(at('Publish'));
  });

  it('masks before the first GITHUB_OUTPUT write', () => {
    const run: string = steps.find((s) => s.id === 'keyvault').run;
    expect(run.indexOf('::add-mask::')).toBeGreaterThan(-1);
    expect(run.indexOf('::add-mask::')).toBeLessThan(run.indexOf('GITHUB_OUTPUT'));
  });

  it('reads config from vars, uses no secrets, and scopes the token', () => {
    for (const v of [
      'AZURE_CLIENT_ID',
      'AZURE_TENANT_ID',
      'AZURE_SUBSCRIPTION_ID',
      'KEY_VAULT_NAME',
    ]) {
      expect(text).toContain(`vars.${v}`);
    }
    expect(text).not.toMatch(/secrets\./);
    const app = steps.find((s) => s.id === 'app');
    expect(app.with.repositories).toBe('geldar-player-template');
    expect(app.with['permission-contents']).toBe('write');
    expect(app.with['permission-metadata']).toBe('read');
  });

  it('sets the publish token in exactly one step and never forces', () => {
    expect(text.match(/GELDAR_PUBLISH_TOKEN/g)?.length).toBe(1);
    const withToken = steps.filter((s) => s.env?.GELDAR_PUBLISH_TOKEN);
    expect(withToken).toHaveLength(1);
    expect(text).not.toContain('--force');
  });

  it('pins the actions to the SHAs of the pins table', () => {
    for (const p of PINS) expect(text).toContain(p);
  });
});
