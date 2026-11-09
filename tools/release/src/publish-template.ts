// Publishes template/ to the player template repository as one commit and one tag per release.
// Plain Node and real git. The token comes only from GELDAR_PUBLISH_TOKEN and reaches git only
// through the environment (never an argv, a URL or .git/config). It never forces a push.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEFAULT_REMOTE = 'https://github.com/SandboxServers/geldar-player-template.git';
const VERSION_RE = /^kit-v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.]+)?$/;
const IMAGE_RE = /^[a-z0-9./-]+@sha256:[0-9a-f]{64}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const MAX_FILE = 1024 * 1024;
const MAX_FILES = 200;
const IDENTITY = { name: 'geldar-bot', email: 'geldar-bot@users.noreply.github.com' };

class Fail extends Error {}

interface Options {
  version: string;
  sourceSha: string;
  image?: string;
  remote: string;
  template: string;
  branch: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    version: '',
    sourceSha: '',
    remote: DEFAULT_REMOTE,
    template: join(REPO_ROOT, 'template'),
    branch: 'main',
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--dry-run') {
      o.dryRun = true;
      continue;
    }
    const v = argv[++i];
    if (v === undefined) throw new Fail(`missing value for ${a}`);
    if (a === '--version') o.version = v;
    else if (a === '--source-sha') o.sourceSha = v;
    else if (a === '--image') o.image = v;
    else if (a === '--remote') o.remote = v;
    else if (a === '--template') o.template = resolve(v);
    else if (a === '--branch') o.branch = v;
    else throw new Fail(`unknown argument ${a}`);
  }
  return o;
}

const isUrl = (r: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(r);

function validate(o: Options, token: string): void {
  if (!VERSION_RE.test(o.version)) throw new Fail('bad --version: expected kit-vX.Y.Z[-pre]');
  if (!SHA_RE.test(o.sourceSha)) throw new Fail('bad --source-sha: expected 40 lowercase hex');
  if (o.image !== undefined && !IMAGE_RE.test(o.image)) {
    throw new Fail('bad --image: expected <repo>@sha256:<64 hex>');
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(o.branch) || o.branch.includes('..')) {
    throw new Fail('bad --branch');
  }
  if (o.remote !== DEFAULT_REMOTE && process.env.GELDAR_INTERNAL !== '1') {
    throw new Fail('refusing a remote other than the player template repository');
  }
  if (token !== '' && !/^https:\/\//i.test(o.remote)) {
    throw new Fail('refusing to use a token with a non-https remote');
  }
}

function listTemplate(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(root, rel)).sort()) {
      const r = rel === '' ? name : `${rel}/${name}`;
      if (name === '..' || name.includes('\\') || name.toLowerCase() === '.git') {
        throw new Fail(`template path refused: ${r}`);
      }
      const st = lstatSync(join(root, r));
      if (st.isSymbolicLink()) throw new Fail(`template symlink refused: ${r}`);
      if (st.isDirectory()) {
        walk(r);
        continue;
      }
      if (!st.isFile()) throw new Fail(`template entry refused: ${r}`);
      if (st.size > MAX_FILE) throw new Fail(`template file over 1 MiB: ${r}`);
      out.push(r);
      if (out.length > MAX_FILES) throw new Fail('template has more than 200 files');
      const bytes = readFileSync(join(root, r));
      if (!bytes.includes(0) && bytes.includes(13)) throw new Fail(`CR byte in text file: ${r}`);
    }
  };
  walk('');
  return out;
}

function patternOf(prop: string): RegExp {
  const schema = JSON.parse(readFileSync(join(REPO_ROOT, 'schemas', 'player.schema.json'), 'utf8'));
  return new RegExp(schema.properties[prop].pattern);
}

function assemble(o: Options, dest: string): void {
  const files = listTemplate(o.template);
  for (const f of files) {
    mkdirSync(dirname(join(dest, f)), { recursive: true });
    copyFileSync(join(o.template, f), join(dest, f));
  }
  if (!files.includes('player.json')) throw new Fail('template has no player.json');
  const path = join(dest, 'player.json');
  const player = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
  player.kit_version = o.version.slice('kit-v'.length);
  if (o.image !== undefined) player.kit_image = o.image;
  if (!patternOf('kit_version').test(player.kit_version as string)) {
    throw new Fail('kit_version does not match the schema');
  }
  if (!patternOf('kit_image').test(player.kit_image as string)) {
    throw new Fail('kit_image does not match the schema');
  }
  writeFileSync(path, `${JSON.stringify(player, null, 2)}\n`);
}

function main(): void {
  const o = parseArgs(process.argv.slice(2));
  const token = process.env.GELDAR_PUBLISH_TOKEN ?? '';
  validate(o, token);

  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  if (token !== '' && process.env.GITHUB_ACTIONS) {
    console.log(`::add-mask::${token}`);
    console.log(`::add-mask::${basic}`);
  }
  const scrub = (s: string): string => {
    if (token === '') return s;
    return s.split(token).join('***').split(basic).join('***');
  };

  const base = mkdtempSync(join(tmpdir(), 'geldar-publish-'));
  try {
    const tree = join(base, 'tree');
    const work = join(base, 'work');
    const hooks = join(base, 'hooks');
    mkdirSync(tree);
    mkdirSync(work);
    mkdirSync(hooks);
    assemble(o, tree);

    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    delete env.GELDAR_PUBLISH_TOKEN;
    for (const k of Object.keys(env)) if (k.startsWith('GIT_CONFIG_')) delete env[k];
    if (process.env.GIT_CONFIG_GLOBAL) env.GIT_CONFIG_GLOBAL = process.env.GIT_CONFIG_GLOBAL;
    env.GIT_AUTHOR_NAME = env.GIT_COMMITTER_NAME = IDENTITY.name;
    env.GIT_AUTHOR_EMAIL = env.GIT_COMMITTER_EMAIL = IDENTITY.email;
    const remoteEnv: NodeJS.ProcessEnv = { ...env };
    if (token !== '') {
      remoteEnv.GIT_CONFIG_COUNT = '1';
      remoteEnv.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
      remoteEnv.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basic}`;
    }
    const git = (args: string[], e = env, input?: string): string => {
      const r = spawnSync(
        'git',
        [
          '-c',
          `core.hooksPath=${hooks}`,
          '-c',
          'fetch.fsckObjects=true',
          '-c',
          'core.autocrlf=false',
          '-c',
          'core.safecrlf=false',
          ...args,
        ],
        { cwd: work, env: e, encoding: 'utf8', input },
      );
      if (r.status !== 0) {
        const first = scrub(String(r.stderr)).split('\n')[0] ?? '';
        throw new Fail(`git ${args[0]} failed: ${first}`);
      }
      return String(r.stdout);
    };

    const contact = !(o.dryRun && isUrl(o.remote));
    git(['init', '--quiet']);
    git(['symbolic-ref', 'HEAD', `refs/heads/${o.branch}`]);
    if (contact) {
      git(['remote', 'add', 'origin', o.remote]);
      const heads = git(['ls-remote', '--heads', 'origin', `refs/heads/${o.branch}`], remoteEnv);
      if (heads.trim() !== '') {
        git(['fetch', '--quiet', 'origin', `refs/heads/${o.branch}`], remoteEnv);
        git(['reset', '--quiet', '--hard', 'FETCH_HEAD']);
      }
    }
    for (const name of readdirSync(work)) {
      if (name !== '.git') rmSync(join(work, name), { recursive: true, force: true });
    }
    for (const f of listTemplate(tree)) {
      mkdirSync(dirname(join(work, f)), { recursive: true });
      copyFileSync(join(tree, f), join(work, f));
    }
    git(['add', '-A']);
    const message = [
      `release ${o.version}`,
      '',
      `template: ${o.sourceSha}`,
      `image: ${o.image === undefined ? 'none' : (o.image.split('@')[1] as string)}`,
      `launcher: ${o.version}`,
    ].join('\n');
    git(['commit', '--quiet', '--allow-empty', '-F', '-'], env, message);

    if (contact) {
      const tags = git(['ls-remote', '--tags', 'origin', `refs/tags/${o.version}`], remoteEnv);
      if (tags.trim() !== '') {
        const spec = `refs/tags/${o.version}:refs/tags/${o.version}`;
        git(['fetch', '--quiet', 'origin', spec], remoteEnv);
        const old = `${o.version}^{commit}`;
        const sameTree =
          git(['rev-parse', `${old}^{tree}`]).trim() === git(['rev-parse', 'HEAD^{tree}']).trim();
        const sameMessage = git(['log', '-1', '--format=%B', old]).trim() === message.trim();
        if (!(sameTree && sameMessage)) {
          throw new Fail(`tag ${o.version} exists with different content; never moved`);
        }
        console.log(`already published ${o.version}`);
        return;
      }
    }
    git(['tag', '-a', '-m', `release ${o.version}`, o.version]);

    const refspecs = [`HEAD:refs/heads/${o.branch}`, `refs/tags/${o.version}`];
    if (o.dryRun) {
      console.log(git(['show', '--stat', 'HEAD']));
      console.log(message);
      console.log(`planned push: origin ${refspecs.join(' ')}`);
      return;
    }
    try {
      git(['push', '--atomic', 'origin', ...refspecs], remoteEnv);
    } catch {
      throw new Fail('the template repository moved; nobody edits it by hand');
    }
    console.log(`published ${o.version}`);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

try {
  main();
} catch (e) {
  console.error(e instanceof Fail ? e.message : `publish failed: ${(e as Error).message}`);
  process.exitCode = 1;
}
