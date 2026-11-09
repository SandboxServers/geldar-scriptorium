import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { checkWorkflow } from './workflows.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string) => readFileSync(root + p, 'utf8');
const TEXT = read('.github/workflows/release.yml');

/** OWNER DECISION 1: strict (fail on every critical, fixed or not). One place to flip it. */
const ALLOW_UNFIXED = false;

// biome-ignore lint/suspicious/noExplicitAny: parsed YAML is untyped
type Obj = Record<string, any>;
const wf = (text = TEXT): Obj => parse(text) as Obj;
const jobs = (text = TEXT): Obj => wf(text).jobs;
const steps = (job: string, text = TEXT): Obj[] => jobs(text)[job].steps;
const find = (job: string, pat: string, text = TEXT): number =>
  steps(job, text).findIndex((s) => String(s.uses ?? '').startsWith(pat));
const findRun = (job: string, pat: string, text = TEXT): number =>
  steps(job, text).findIndex((s) => String(s.run ?? '').includes(pat));
const check = (text: string) => checkWorkflow({ path: '.github/workflows/release.yml', text });

const SHAS: Record<string, string> = {
  'actions/checkout': '3d3c42e5aac5ba805825da76410c181273ba90b1',
  'docker/setup-buildx-action': 'f87e5991a6d7451dcb8d9637bfbc97413f497069',
  'docker/login-action': '81c6f93d4bc991e510b342a00b419b3bb4efc5c6',
  'docker/build-push-action': 'c3c9e263c25d99ce0380d002d59b67737d91b0dc',
  'sigstore/cosign-installer': '6f9f17788090df1f26f669e9d70d6ae9567deba6',
  'anchore/sbom-action': '66cbf4bc1f1c0d2edc94016e65bc221b6bb0ad6c',
  'aquasecurity/trivy-action': 'ed142fd0673e97e23eac54620cfb913e5ce36c25',
  'anchore/scan-action': '27805bf3b4e84b4a5c980df22ed233c00390a439',
  'actions/upload-artifact': 'cf430e030ddbb5b0abf93d22962f4752f3646cd9',
  'actions/download-artifact': '9000827ccba6bdab643e8b6fd33ac0654aef8333',
};
const DIGEST_REF = 'ghcr.io/sandboxservers/geldar-kit@${{ needs.build.outputs.digest }}';

describe('release.yml (SC-63d)', () => {
  it('passes the workflow check with zero findings', () => {
    expect(check(TEXT)).toEqual([]);
  });

  it('triggers on kit-v tags and dispatch only, with empty top-level permissions', () => {
    const w = wf();
    expect(Object.keys(w.on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(w.on.push).toEqual({ tags: ['kit-v*'] });
    expect(w.permissions).toEqual({});
    expect(w.concurrency['cancel-in-progress']).toBe(false);
    for (const j of ['build', 'scan', 'sign']) {
      expect(jobs()[j].if).toBe(
        "github.event_name == 'push' && startsWith(github.ref, 'refs/tags/kit-v')",
      );
    }
  });

  it('gives each job exactly its permissions', () => {
    expect(jobs().build.permissions).toEqual({ contents: 'read', packages: 'write' });
    expect(jobs().scan.permissions).toEqual({ contents: 'read', packages: 'read' });
    expect(jobs().sign.permissions).toEqual({
      contents: 'read',
      packages: 'write',
      'id-token': 'write',
    });
  });

  it('pins every action to the card SHA', () => {
    const uses = Object.values(jobs()).flatMap((j: Obj) =>
      (j.steps as Obj[]).map((s) => s.uses).filter(Boolean),
    ) as string[];
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) {
      const [name, sha] = u.split('@');
      expect(SHAS[name as string], name).toBe(sha);
    }
  });

  it('orders the build job: guard, login, absent-tag check, build', () => {
    const guard = findRun('build', 'merge-base --is-ancestor');
    const login = find('build', 'docker/login-action');
    const absent = findRun('build', 'imagetools inspect');
    const build = find('build', 'docker/build-push-action');
    expect(find('build', 'actions/checkout')).toBe(0);
    expect(guard).toBeGreaterThan(0);
    expect(login).toBeGreaterThan(guard);
    expect(absent).toBeGreaterThan(login);
    expect(build).toBeGreaterThan(absent);
    expect(steps('build')[0]?.with['fetch-depth']).toBe(0);
    const b = steps('build')[build] as Obj;
    expect(b.with).toMatchObject({ target: 'kit', push: true, provenance: false, sbom: false });
    expect(TEXT).not.toMatch(/:latest/);
  });

  it('runs both scans before sign, through needs, with the pinned strict settings', () => {
    expect(jobs().sign.needs).toEqual(['build', 'scan']);
    expect(jobs().scan.needs).toBe('build');
    const t = steps('scan')[find('scan', 'aquasecurity/trivy-action')] as Obj;
    const g = steps('scan')[find('scan', 'anchore/scan-action')] as Obj;
    expect(t.with).toMatchObject({
      severity: 'CRITICAL',
      'exit-code': '1',
      version: 'v0.76.1',
      cache: false,
      'ignore-unfixed': ALLOW_UNFIXED,
    });
    expect(g.with).toMatchObject({
      'fail-build': true,
      'severity-cutoff': 'critical',
      'grype-version': 'v0.121.0',
      'only-fixed': ALLOW_UNFIXED,
    });
    const s = steps('scan')[find('scan', 'anchore/sbom-action')] as Obj;
    expect(s.with).toMatchObject({ 'syft-version': 'v1.55.0', format: 'spdx-json' });
    expect(t.with['image-ref']).toBe(DIGEST_REF);
    expect(g.with.image).toBe(DIGEST_REF);
    expect(s.with.image).toBe(DIGEST_REF);
  });

  it('keeps sign to cosign-installer and download-artifact, in order, addressing the digest', () => {
    const uses = steps('sign')
      .map((s) => s.uses)
      .filter(Boolean)
      .map((u) => String(u).split('@')[0]);
    expect(uses).toEqual(['actions/download-artifact', 'sigstore/cosign-installer']);
    expect(steps('sign')[find('sign', 'sigstore/cosign-installer')]?.with['cosign-release']).toBe(
      'v3.1.4',
    );
    const sign = findRun('sign', 'cosign sign');
    const verify = findRun('sign', 'cosign verify');
    const attest = findRun('sign', 'cosign attest');
    const pub = findRun('sign', 'ghcr.io/token');
    expect(sign).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(sign);
    expect(attest).toBeGreaterThan(verify);
    expect(pub).toBe(steps('sign').length - 1);
    for (const i of [sign, verify, attest]) {
      expect(steps('sign')[i]?.env.IMAGE).toBe('${{ needs.build.outputs.image }}');
      expect(steps('sign')[i]?.run).toContain('"$IMAGE"');
    }
    expect(jobs().build.outputs.image).toBe(
      'ghcr.io/sandboxservers/geldar-kit@${{ steps.build.outputs.digest }}',
    );
    expect(String(steps('sign')[pub]?.run)).toContain('the kit package is private');
  });

  it('reads the Dockerfile: a kit stage with the source label; nettest builds on kit', () => {
    const d = read('image/Dockerfile');
    const kitOnly = (d.split(/^FROM .* AS kit$/m)[1] ?? '').split(/^FROM /m)[0] ?? '';
    expect(d).toMatch(/^FROM .* AS kit$/m);
    expect(kitOnly).toContain(
      'LABEL org.opencontainers.image.source="https://github.com/SandboxServers/geldar-scriptorium"',
    );
    expect(d).toMatch(/^FROM kit AS nettest$/m);
  });

  describe('hostile variants', () => {
    it('a scanner action in sign is an idtoken-uses finding', () => {
      const bad = TEXT.replace(
        '      - uses: sigstore/cosign-installer@',
        '      - uses: aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0\n      - uses: sigstore/cosign-installer@',
      );
      expect(check(bad).map((f) => f.rule)).toContain('idtoken-uses');
    });
    it('drift in exit-code or severity is visible to the contract assertions', () => {
      const t = TEXT.replace("exit-code: '1'", "exit-code: '0'").replace(
        'severity: CRITICAL',
        'severity: HIGH,CRITICAL',
      );
      const s = jobs(t).scan.steps.find((x: Obj) => String(x.uses).startsWith('aquasecurity'));
      expect(s.with['exit-code']).not.toBe('1');
      expect(s.with.severity).not.toBe('CRITICAL');
    });
    it('a sign step addressing the image by tag lacks the digest form', () => {
      const bad = TEXT.replace(
        'IMAGE: ${{ needs.build.outputs.image }}',
        'IMAGE: ghcr.io/sandboxservers/geldar-kit:1.0.0',
      );
      expect(steps('sign', bad)[findRun('sign', 'cosign sign', bad)]?.env.IMAGE).not.toContain('@');
    });
    it('an expression inside run: is an injection finding', () => {
      const bad = TEXT.replace(
        'cosign sign --yes "$IMAGE"',
        'cosign sign --yes ${{ github.ref_name }}',
      );
      expect(check(bad).map((f) => f.rule)).toContain('injection');
    });
  });
});
