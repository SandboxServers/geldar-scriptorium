// The sheet in the supervisor state volume is readable by the supervisor (uid 1001) alone: the player
// (uid 1000) and uid 1002 are denied. Run for real in the kit image; skipped where Docker is unavailable.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildKit, dockerReady, KIT_IMAGE, run } from './docker.ts';

const READY = dockerReady();
const SUPERVISOR = 1001;
const VOLUME = `geldar-sheet-blind-${process.pid}-${Date.now()}`;
const SHEET = '/state/supervisor/instinct/sheet.json';

const VALID_SHEET = JSON.stringify({
  version: 1,
  attributes: { curiosity: 3, common_sense: 3, cleverness: 3, aggression: 3 },
  alignment: { law: 3, good: 3 },
  op_modes: { explorer: 3, farmer: 3, miner: 3, builder: 3, crafter: 3, warrior: 3, nitwit: 3 },
});

/** The cat of the stored sheet as one uid, in the kit image with the supervisor state volume mounted. */
function catAs(uid: number) {
  return run([
    'run',
    '--rm',
    '--user',
    `${uid}:${uid}`,
    '-v',
    `${VOLUME}:/state/supervisor:ro`,
    '--entrypoint',
    'cat',
    KIT_IMAGE,
    SHEET,
  ]);
}

describe.skipIf(!READY)('HC-26c: the stored sheet is readable by the supervisor uid only', () => {
  beforeAll(() => {
    buildKit();
    // Prepared as root: the sheet is owned by uid 1001, mode 0600; its folder is traversable (0755), so
    // only the file's mode decides who may read it.
    const script = [
      'mkdir -p /state/supervisor/instinct',
      'chmod 0755 /state/supervisor/instinct',
      `printf '%s' '${VALID_SHEET}' > ${SHEET}`,
      `chown ${SUPERVISOR}:${SUPERVISOR} ${SHEET}`,
      `chmod 0600 ${SHEET}`,
    ].join(' && ');
    const made = run(['volume', 'create', VOLUME]);
    expect(made.status, made.stderr).toBe(0);
    const prepared = run([
      'run',
      '--rm',
      '--user',
      '0:0',
      '-v',
      `${VOLUME}:/state/supervisor`,
      '--entrypoint',
      'sh',
      KIT_IMAGE,
      '-c',
      script,
    ]);
    expect(prepared.status, prepared.stderr).toBe(0);
  });

  afterAll(() => {
    run(['volume', 'rm', '-f', VOLUME]);
  });

  it('as uid 1000 (the player) cat of instinct/sheet.json is denied', () => {
    const r = catAs(1000);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe('');
  });

  it('as uid 1002 cat of instinct/sheet.json is denied', () => {
    const r = catAs(1002);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe('');
  });

  it('as uid 1001 (the supervisor) cat of instinct/sheet.json succeeds', () => {
    const r = catAs(SUPERVISOR);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('"version"');
  });
});
