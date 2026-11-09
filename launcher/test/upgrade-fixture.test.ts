import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { git, makeWorld } from './harness.ts';
import { defaultKitFiles, digestFor, makeTemplateRelease } from './upgrade-fixture.ts';

function tags(repo: string): string[] {
  return git(repo, ['tag', '--list']).split('\n').filter(Boolean).sort();
}
function tree(repo: string, tag: string): string[] {
  return git(repo, ['ls-tree', '-r', '-t', '--name-only', tag]).split('\n').filter(Boolean);
}
function show(repo: string, tag: string, path: string): string {
  return git(repo, ['show', `${tag}:${path}`]);
}

describe('template release fixture', () => {
  it('one tag per version, prereleases included, with the kit tree and player.json defaults', () => {
    const w = makeWorld();
    const r = makeTemplateRelease(w, { versions: ['0.1.0', '0.2.0', '0.3.0-rc1'] });
    expect(existsSync(r.repo)).toBe(true);
    expect(tags(r.repo)).toEqual(['kit-v0.1.0', 'kit-v0.2.0', 'kit-v0.3.0-rc1']);
    const files = tree(r.repo, 'kit-v0.2.0');
    for (const f of Object.keys(defaultKitFiles)) expect(files).toContain(f);
    expect(files).toContain('player.json');
    const p = JSON.parse(show(r.repo, 'kit-v0.2.0', 'player.json'));
    expect(p.kit_version).toBe('0.2.0');
    expect(p.kit_image).toBe(`ghcr.io/sandboxservers/geldar-kit@${digestFor('0.2.0')}`);
    const msg = git(r.repo, ['log', '-1', '--format=%B', 'kit-v0.2.0']);
    expect(msg).toContain(`image: ${r.digest('0.2.0')}`);
    expect(msg.startsWith('release 0.2.0\n')).toBe(true);
  });

  it('files adds and removes entries, image overrides the digest, extra tags are created', () => {
    const w = makeWorld();
    const image = `ghcr.io/sandboxservers/geldar-kit@sha256:${'b'.repeat(64)}`;
    const r = makeTemplateRelease(w, {
      versions: ['1.0.0'],
      files: { 'NEW.md': 'new\n', 'README.md': null },
      image,
      extraTags: ['kit-v1.0.0$(id)'],
    });
    const files = tree(r.repo, 'kit-v1.0.0');
    expect(files).toContain('NEW.md');
    expect(files).not.toContain('README.md');
    expect(JSON.parse(show(r.repo, 'kit-v1.0.0', 'player.json')).kit_image).toBe(image);
    expect(tags(r.repo)).toContain('kit-v1.0.0$(id)');
  });

  it('a hostile option produces what it names', () => {
    const w = makeWorld();
    const mk = (hostile: Parameters<typeof makeTemplateRelease>[1]['hostile']) =>
      makeTemplateRelease(w, { versions: ['0.2.0'], hostile }).repo;
    const t = 'kit-v0.2.0';
    const lsLong = (repo: string) => git(repo, ['ls-tree', '-r', '-t', t]);
    expect(lsLong(mk('symlink'))).toMatch(/^120000 blob \w+\t\.claude\/link$/m);
    expect(lsLong(mk('gitlink'))).toMatch(/^160000 commit a{40}\tvendor$/m);
    expect(tree(mk('newline-name'), t).join('\n')).toContain('name.md');
    expect(tree(mk('traversal'), t)).toContain('.claude/../memory/identity.md');
    expect(tree(mk('git-hooks'), t)).toContain('.git/hooks/post-checkout');
    expect(tree(mk('memory-content'), t)).toContain('memory/smuggled.md');
    const big = mk('big-file');
    expect(Number(git(big, ['cat-file', '-s', `${t}:big.bin`]))).toBe(6 * 1024 * 1024);
    const tagForm = JSON.parse(show(mk('tag-form-image'), t, 'player.json'));
    expect(tagForm.kit_image).not.toContain('@sha256:');
    const mism = mk('version-mismatch');
    expect(JSON.parse(show(mism, t, 'player.json')).kit_version).not.toBe('0.2.0');
    const imgMis = mk('image-mismatch');
    const msg = git(imgMis, ['log', '-1', '--format=%B', t]);
    expect(msg).toContain(`image: sha256:${'f'.repeat(64)}`);
    expect(show(imgMis, t, 'player.json')).not.toContain('f'.repeat(64));
    expect(readFileSync(`${w.root}/gitconfig`, 'utf8')).toContain('user');
  });
});
