import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { World } from './harness.ts';

// A stand-in for the template repository (SC-64a): a bare repository of kit files with one tag
// `kit-v<version>` per release, built with git plumbing (raw tree objects), so hostile shapes
// that `git add` would refuse (a `.git` entry, a `..` entry) can be written too.

export type Hostile =
  | 'symlink' // .claude/link, a symlink to ../memory
  | 'gitlink' // vendor, a gitlink (submodule entry)
  | 'newline-name' // a file whose name has a newline
  | 'tag-form-image' // player.json kit_image is a tag, not a digest
  | 'traversal' // the path .claude/../memory/identity.md
  | 'git-hooks' // .git/hooks/post-checkout that writes $GELDAR_HOOK_MARKER if it ever runs
  | 'big-file' // a 6 MiB file
  | 'version-mismatch' // player.json kit_version differs from the tag
  | 'image-mismatch' // the commit message image line differs from player.json
  | 'other-registry' // kit_image names another registry (S6)
  | 'other-repo' // kit_image names another repository on ghcr.io (S6)
  | 'ntfs-dot-git' // a path component `.git.` (N-e)
  | 'ntfs-dot-git-space' // a path component `.git ` (N-e)
  | 'export-attrs' // a .gitattributes with export-ignore (S4)
  | 'memory-content'; // files under memory/ and skills/ (excluded by name, must not be copied)

export interface ReleaseOptions {
  versions: string[];
  // Path to content; null removes a default file. Applied to every version.
  files?: Record<string, string | null>;
  // The kit_image for every version (repo@sha256:...); default is one digest per version.
  image?: string;
  hostile?: Hostile | Hostile[];
  // Extra tag names to create verbatim (for example hostile ones), each on the last version's commit.
  extraTags?: string[];
}

export interface Release {
  repo: string; // forward slashes, valid for both launchers
  digest(version: string): string; // sha256:... as in the commit message
  kitImage(version: string): string; // repo@sha256:... as in player.json
  commit(version: string): string;
}

export const KIT_REPO = 'ghcr.io/sandboxservers/geldar-kit';

export function digestFor(version: string): string {
  return `sha256:${createHash('sha256').update(`image-${version}`).digest('hex')}`;
}

export const defaultKitFiles: Record<string, string> = {
  'AGENTS.md': 'Kit agents file.\n',
  'CLAUDE.md': 'Kit claude file.\n',
  'README.md': 'Kit readme.\n',
  '.claude/settings.json': '{"kit":true}\n',
  'memory/README.md': 'Template memory, never copied.\n',
  'skills/README.md': 'Template skills, never copied.\n',
};

interface Entry {
  mode: string;
  name: string;
  sha: string;
}

type Node = { file: Buffer; mode: string } | { link: string } | { gitlink: string } | Dir;
interface Dir {
  dir: Map<string, Node>;
}

function gitRun(
  repo: string,
  args: string[],
  input?: Buffer | string,
  env?: Record<string, string>,
) {
  const r = spawnSync('git', ['-C', repo, ...args], {
    input,
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(r.stderr)}`);
  return r.stdout.toString('utf8').trim();
}

function put(root: Dir, path: string[], leaf: Node): void {
  let cur = root;
  for (const part of path.slice(0, -1)) {
    let next = cur.dir.get(part);
    if (!next || !('dir' in next)) {
      next = { dir: new Map() };
      cur.dir.set(part, next);
    }
    cur = next;
  }
  cur.dir.set(path[path.length - 1] ?? '', leaf);
}

// Identical content in one repository is written once, so a repository with many versions stays cheap.
function blob(repo: string, body: Buffer): string {
  const key = `${repo}|${createHash('sha256').update(body).digest('hex')}`;
  let sha = blobs.get(key);
  if (!sha) {
    sha = gitRun(repo, ['hash-object', '-w', '--stdin'], body);
    blobs.set(key, sha);
  }
  return sha;
}

function writeTree(repo: string, d: Dir): string {
  const entries: Entry[] = [];
  for (const [name, node] of d.dir) {
    if ('dir' in node) entries.push({ mode: '40000', name, sha: writeTree(repo, node) });
    else if ('file' in node) {
      entries.push({
        mode: node.mode,
        name,
        sha: blob(repo, node.file),
      });
    } else if ('link' in node) {
      entries.push({
        mode: '120000',
        name,
        sha: gitRun(repo, ['hash-object', '-w', '--stdin'], node.link),
      });
    } else entries.push({ mode: '160000', name, sha: node.gitlink });
  }
  // Git orders tree entries by name, a tree as if its name ended in a slash.
  const key = (e: Entry) => Buffer.from(e.mode === '40000' ? `${e.name}/` : e.name);
  entries.sort((a, b) => Buffer.compare(key(a), key(b)));
  const parts = entries.map((e) =>
    Buffer.concat([Buffer.from(`${e.mode} ${e.name}\0`), Buffer.from(e.sha, 'hex')]),
  );
  return gitRun(
    repo,
    ['hash-object', '-t', 'tree', '-w', '--literally', '--stdin'],
    Buffer.concat(parts),
  );
}

const blobs = new Map<string, string>();

let counter = 0;

export function makeTemplateRelease(world: World, opts: ReleaseOptions): Release {
  const hostile = new Set<Hostile>(
    opts.hostile === undefined ? [] : Array.isArray(opts.hostile) ? opts.hostile : [opts.hostile],
  );
  counter += 1;
  const parent = join(world.root, 'template-releases');
  mkdirSync(parent, { recursive: true });
  const repo = join(parent, `t${counter}.git`);
  gitRun(parent, ['init', '-q', '--bare', '-b', 'main', repo]);
  const idEnv = {
    GIT_AUTHOR_NAME: 'geldar-bot',
    GIT_AUTHOR_EMAIL: 'geldar-bot@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'geldar-bot',
    GIT_COMMITTER_EMAIL: 'geldar-bot@users.noreply.github.com',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  };
  const commits = new Map<string, string>();
  const kitImage = (v: string) => opts.image ?? `${KIT_REPO}@${digestFor(v)}`;
  const digestOf = (v: string) => kitImage(v).slice(kitImage(v).indexOf('@') + 1);

  for (const version of opts.versions) {
    const files: Record<string, string | null> = { ...defaultKitFiles, ...opts.files };
    if (hostile.has('memory-content')) {
      files['memory/smuggled.md'] = 'smuggled memory\n';
      files['skills/smuggled.md'] = 'smuggled skill\n';
    }
    const digest = digestOf(version);
    let image = kitImage(version);
    if (hostile.has('tag-form-image')) image = `${KIT_REPO}:latest`;
    if (hostile.has('other-registry')) image = `evil.example/geldar-kit@${digest}`;
    if (hostile.has('other-repo')) image = `ghcr.io/sandboxservers/other-kit@${digest}`;
    const player = {
      player_id: 'template',
      name: 'template',
      shard: 'template',
      mcp_url: 'https://mcp.template.test/mcp',
      harness: 'claude',
      declared_model: 'template',
      kit_version: hostile.has('version-mismatch') ? '0.0.1' : version,
      kit_image: image,
    };
    const root: Dir = { dir: new Map() };
    for (const [path, body] of Object.entries(files)) {
      if (body !== null) put(root, path.split('/'), { file: Buffer.from(body), mode: '100644' });
    }
    put(root, ['player.json'], {
      file: Buffer.from(`${JSON.stringify(player, null, 2)}\n`),
      mode: '100644',
    });
    if (hostile.has('symlink')) put(root, ['.claude', 'link'], { link: '../memory' });
    if (hostile.has('gitlink')) put(root, ['vendor'], { gitlink: 'a'.repeat(40) });
    if (hostile.has('newline-name')) {
      put(root, ['bad\nname.md'], { file: Buffer.from('x\n'), mode: '100644' });
    }
    if (hostile.has('traversal')) {
      put(root, ['.claude', '..', 'memory', 'identity.md'], {
        file: Buffer.from('x\n'),
        mode: '100644',
      });
    }
    if (hostile.has('git-hooks')) {
      const hook = '#!/bin/sh\necho ran > "${GELDAR_HOOK_MARKER:-/nonexistent/marker}"\n';
      put(root, ['.git', 'hooks', 'post-checkout'], { file: Buffer.from(hook), mode: '100755' });
    }
    if (hostile.has('ntfs-dot-git'))
      put(root, ['.git.', 'x'], { file: Buffer.from('x\n'), mode: '100644' });
    if (hostile.has('ntfs-dot-git-space')) {
      put(root, ['.git ', 'x'], { file: Buffer.from('x\n'), mode: '100644' });
    }
    if (hostile.has('export-attrs')) {
      put(root, ['.gitattributes'], {
        file: Buffer.from('CLAUDE.md export-ignore\n'),
        mode: '100644',
      });
    }
    if (hostile.has('big-file')) {
      put(root, ['big.bin'], { file: Buffer.alloc(6 * 1024 * 1024, 97), mode: '100644' });
    }
    const tree = writeTree(repo, root);
    const imageLine = hostile.has('image-mismatch')
      ? `sha256:${'f'.repeat(64)}`
      : digestOf(version);
    const message = `release ${version}\n\ntemplate: ${'1'.repeat(40)}\nimage: ${imageLine}\nlauncher: ${version}\n`;
    const commit = gitRun(repo, ['commit-tree', tree, '-F', '-'], message, idEnv);
    gitRun(repo, ['update-ref', `refs/tags/kit-v${version}`, commit]);
    commits.set(version, commit);
  }
  const last = commits.get(opts.versions[opts.versions.length - 1] ?? '');
  if (last) {
    for (const t of opts.extraTags ?? []) gitRun(repo, ['update-ref', `refs/tags/${t}`, last]);
    gitRun(repo, ['update-ref', 'refs/heads/main', last]);
  }
  return {
    repo: repo.replace(/\\/g, '/'),
    digest: digestOf,
    kitImage,
    commit: (v) => commits.get(v) ?? '',
  };
}
