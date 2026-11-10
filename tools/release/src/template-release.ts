// Creates the launcher release in the player template repository, after publish-template has
// pushed the tag. It uploads exactly the two files the launcher job built: the archive and
// SHA256SUMS. The token comes only from GH_TOKEN and reaches gh only through the environment.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATE_REPO = 'SandboxServers/geldar-player-template';
const TAG_RE = /^kit-v((0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.]+)?)$/;
const SUM_RE = /^([0-9a-f]{64})  (geldar-play-[^/\\\s]+\.tar\.gz)\n$/;

class Fail extends Error {}

export interface ReleasePlan {
  args: string[];
  files: string[];
  archive: string;
}

// The gh arguments for one tag. A tag with a hyphen after the version is a prerelease.
export function releasePlan(tag: string): ReleasePlan {
  const m = TAG_RE.exec(tag);
  if (!m?.[1]) throw new Fail(`bad tag (want kit-vX.Y.Z[-pre]): ${tag}`);
  const version = m[1];
  const archive = `geldar-play-${version}.tar.gz`;
  const files = [archive, 'SHA256SUMS'];
  const args = [
    'release',
    'create',
    tag,
    '--repo',
    TEMPLATE_REPO,
    '--verify-tag',
    '--title',
    `Launcher ${version}`,
    '--notes',
    `The geldar-play launcher ${version} and its checksum.`,
  ];
  if (version.includes('-')) args.push('--prerelease');
  return { args: [...args, ...files], files, archive };
}

// The directory must hold exactly the two files, and SHA256SUMS must name the archive's real hash.
export function checkAssets(dir: string, plan: ReleasePlan): void {
  const names = readdirSync(dir).sort();
  const want = [...plan.files].sort();
  if (names.length !== want.length || names.some((n, i) => n !== want[i])) {
    throw new Fail(`the launcher folder must hold exactly ${want.join(' and ')}`);
  }
  const sums = readFileSync(join(dir, 'SHA256SUMS'), 'utf8');
  const m = SUM_RE.exec(sums);
  if (!m?.[1] || m[2] !== plan.archive) throw new Fail('SHA256SUMS must name the archive');
  const hash = createHash('sha256')
    .update(readFileSync(join(dir, plan.archive)))
    .digest('hex');
  if (hash !== m[1]) throw new Fail('the archive does not match SHA256SUMS');
}

function main(argv: string[]): void {
  const opt: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k || !['--tag', '--dir'].includes(k) || v === undefined) {
      throw new Fail('usage: template-release.ts --tag kit-vX.Y.Z --dir <dir>');
    }
    opt[k] = v;
  }
  if (!opt['--tag'] || !opt['--dir']) throw new Fail('--tag and --dir are required');
  if (!process.env.GH_TOKEN) throw new Fail('GH_TOKEN is not set');
  const plan = releasePlan(opt['--tag']);
  const dir = resolve(opt['--dir']);
  checkAssets(dir, plan);
  const r = spawnSync('gh', plan.args, { cwd: dir, env: process.env, stdio: 'inherit' });
  if (r.status !== 0) throw new Fail(`gh release create failed for ${opt['--tag']}`);
  console.log(`created the launcher release ${opt['--tag']} in ${TEMPLATE_REPO}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    console.error(`template-release: ${e.message}`);
    process.exitCode = 1;
  }
}
