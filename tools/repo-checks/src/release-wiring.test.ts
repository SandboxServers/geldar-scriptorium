import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { checkWorkflow } from './workflows.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string) => readFileSync(root + p, 'utf8');
const TEXT = read('.github/workflows/release.yml');

// biome-ignore lint/suspicious/noExplicitAny: parsed YAML is untyped
type Obj = Record<string, any>;
const jobs = (text = TEXT): Obj => (parse(text) as Obj).jobs;
const needsOf = (j: Obj): string[] =>
  j.needs === undefined ? [] : Array.isArray(j.needs) ? j.needs : [j.needs];
const runs = (job: string, text = TEXT): string[] =>
  (jobs(text)[job].steps as Obj[]).map((s) => String(s.run ?? ''));

/** Every needs.<x> in any expression of a job that is not in that job's own needs. */
function needsViolations(text: string): string[] {
  const out: string[] = [];
  for (const [name, j] of Object.entries(jobs(text))) {
    const own = needsOf(j);
    const body = JSON.stringify(j);
    for (const m of body.matchAll(/needs\.([A-Za-z_][\w-]*)/g)) {
      if (!own.includes(m[1] as string)) out.push(`${name}: needs.${m[1]}`);
    }
  }
  return out;
}

describe('release.yml wiring (SC-63f)', () => {
  it('passes the workflow check with zero findings', () => {
    expect(checkWorkflow({ path: '.github/workflows/release.yml', text: TEXT })).toEqual([]);
  });

  it('has exactly the eight jobs with the right needs', () => {
    const j = jobs();
    expect(Object.keys(j).sort()).toEqual(
      [
        'build',
        'launcher',
        'launcher-sign',
        'rehearse',
        'release',
        'scan',
        'sign',
        'template',
      ].sort(),
    );
    expect(needsOf(j.launcher)).toEqual(['sign']);
    expect(needsOf(j['launcher-sign'])).toEqual(['launcher']);
    expect(needsOf(j.template)).toEqual(['build', 'sign']);
    expect(needsOf(j.release)).toEqual(['build', 'sign', 'launcher-sign', 'template']);
    expect(needsOf(j.rehearse)).toEqual([]);
  });

  it('only references needs.<x> for jobs in the same job needs', () => {
    expect(needsViolations(TEXT)).toEqual([]);
  });

  it('catches template falling back to needs: sign', () => {
    const bad = TEXT.replace('needs: [build, sign]\n    if', 'needs: sign\n    if');
    expect(bad).not.toBe(TEXT);
    expect(needsViolations(bad)).toContain('template: needs.build');
  });

  it('sets the timeouts', () => {
    expect(jobs().launcher['timeout-minutes']).toBe(15);
    expect(jobs().release['timeout-minutes']).toBe(10);
    expect(jobs().rehearse['timeout-minutes']).toBe(30);
  });

  it('gives release the gh environment and the only contents: write', () => {
    expect(jobs().release.env).toEqual({
      GH_TOKEN: '${{ github.token }}',
      GH_REPO: '${{ github.repository }}',
    });
    const writers = Object.entries(jobs())
      .filter(([, j]) => j.permissions?.contents === 'write')
      .map(([n]) => n);
    expect(writers).toEqual(['release']);
    expect(jobs().launcher.permissions).toEqual({ contents: 'read' });
    expect(jobs()['launcher-sign'].permissions).toEqual({ contents: 'read', 'id-token': 'write' });
  });

  it('calls the template workflow with no secrets', () => {
    const t = jobs().template;
    expect(t.uses).toBe('./.github/workflows/publish-template.yml');
    expect(t.secrets).toBeUndefined();
    expect(t.permissions).toEqual({ 'id-token': 'write', contents: 'read' });
    expect(t.with.image).toBe('${{ needs.build.outputs.image }}');
    expect(t.with.version).toBe('${{ github.ref_name }}');
    expect(t.with['source-sha']).toBe('${{ github.sha }}');
    expect(t.if).toContain("startsWith(github.ref, 'refs/tags/kit-v')");
  });

  it('signs both launcher assets with --bundle', () => {
    const r = runs('launcher-sign').join('\n');
    expect(r).toContain('geldar-play-*.tar.gz SHA256SUMS sbom.spdx.json');
    expect(r).toContain('cosign sign-blob --yes --bundle "$f.sigstore.json" "$f"');
    expect(r).not.toContain('package-launcher.ts');
    const p = runs('launcher').join('\n');
    expect(p).toContain('package-launcher.ts');
    expect(p).toContain('sha256sum sbom.spdx.json >> SHA256SUMS');
  });

  it('checks the template tag before the release, names the digest and marks prereleases', () => {
    const r = runs('release');
    const tagCheck = r.findIndex((s) => s.includes('git ls-remote --tags --refs'));
    const create = r.findIndex((s) => s.includes('gh release create'));
    expect(tagCheck).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThan(tagCheck);
    expect(r[tagCheck]).toContain('exit 1');
    expect(r[create]).toContain('--verify-tag');
    expect(r[create]).toContain('--prerelease');
    expect(r[create]).toContain('"$TAG" == *-*');
    expect(r[create]).toContain('cosign verify $IMAGE');
    expect(r[create]).toContain('cosign verify-blob');
    const step = (jobs().release.steps as Obj[])[create];
    expect(step?.env.DIGEST).toBe('${{ needs.build.outputs.digest }}');
    expect(r[create]).toContain('$DIGEST');
  });

  it('runs the rehearsal only on dispatch with no credential', () => {
    const j = jobs().rehearse;
    expect(j.if).toBe("github.event_name == 'workflow_dispatch'");
    expect(j.permissions).toEqual({ contents: 'read' });
    const steps = j.steps as Obj[];
    const build = steps.find((s) => String(s.uses).startsWith('docker/build-push-action@'));
    expect(build?.with.push).toBe(false);
    expect(runs('rehearse').join('\n')).toContain('--dry-run');
    expect(runs('rehearse').join('\n')).toContain('sha256sum -c SHA256SUMS');
  });

  it('has no if: mentioning workflow_call in any workflow', () => {
    for (const f of ['release', 'publish-template', 'ci', 'image-scan']) {
      const p = `.github/workflows/${f}.yml`;
      if (!existsSync(root + p)) continue;
      for (const j of Object.values(jobs(read(p))) as Obj[]) {
        for (const c of [j.if, ...((j.steps ?? []) as Obj[]).map((s) => s.if)])
          expect(String(c ?? '')).not.toContain('workflow_call');
      }
    }
  });

  const lint = spawnSync('actionlint', ['-version'], { encoding: 'utf8' });
  it.skipIf(lint.status !== 0)('lints clean with actionlint', () => {
    const r = spawnSync('actionlint', [`${root}.github/workflows/release.yml`], {
      encoding: 'utf8',
    });
    expect(r.stdout + r.stderr).toBe('');
  });
});
