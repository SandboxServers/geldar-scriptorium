import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInstinct } from './run.ts';
import { readSheetFile, SHEET_MAX_BYTES } from './sheetfile.ts';

// The sheet is read from the instinct state folder (GELDAR_INSTINCT_STATE): <state>/instinct/sheet.json.
// The mode and owner cases need POSIX file modes, so they skip on Windows.
const POSIX = process.platform !== 'win32';
const uid = process.getuid?.();

const VALID_SHEET = JSON.stringify({
  version: 1,
  attributes: { curiosity: 3, common_sense: 3, cleverness: 3, aggression: 3 },
  alignment: { law: 3, good: 3 },
  op_modes: { explorer: 3, farmer: 3, miner: 3, builder: 3, crafter: 3, warrior: 3, nitwit: 3 },
});

const dirs: string[] = [];

/** A fresh folder that stands for the instinct state folder; removed after each test. */
function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'instinct-sheetfile-'));
  dirs.push(dir);
  return dir;
}

/** Writes sheet.json in `dir` with the given text and mode. */
function sheetWith(dir: string, text: string, mode = 0o600): string {
  const file = join(dir, 'sheet.json');
  writeFileSync(file, text);
  chmodSync(file, mode);
  return file;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readSheetFile', () => {
  it.skipIf(!POSIX)('a regular 0600 file owned by uid parses', () => {
    const dir = folder();
    sheetWith(dir, VALID_SHEET);
    expect(readSheetFile(dir, uid)).not.toBeNull();
  });

  it('a regular file parses on every platform when the mode and owner checks do not apply', () => {
    const dir = folder();
    sheetWith(dir, VALID_SHEET);
    expect(readSheetFile(dir, POSIX ? uid : undefined)).not.toBeNull();
  });

  it('no file gives null', () => {
    expect(readSheetFile(folder(), uid)).toBeNull();
  });

  it.skipIf(!POSIX)('a link to a valid sheet gives null', () => {
    const dir = folder();
    const target = sheetWith(folder(), VALID_SHEET);
    symlinkSync(target, join(dir, 'sheet.json'));
    expect(readSheetFile(dir, uid)).toBeNull();
  });

  it.skipIf(!POSIX)('a directory named sheet.json gives null', () => {
    const dir = folder();
    mkdirSync(join(dir, 'sheet.json'));
    expect(readSheetFile(dir, uid)).toBeNull();
  });

  it.skipIf(!POSIX)('a group-readable file (0640) gives null', () => {
    const dir = folder();
    sheetWith(dir, VALID_SHEET, 0o640);
    expect(readSheetFile(dir, uid)).toBeNull();
  });

  it.skipIf(!POSIX)('an other-readable file (0604) gives null', () => {
    const dir = folder();
    sheetWith(dir, VALID_SHEET, 0o604);
    expect(readSheetFile(dir, uid)).toBeNull();
  });

  it.skipIf(!POSIX)('a file owned by another uid gives null', () => {
    const dir = folder();
    sheetWith(dir, VALID_SHEET);
    // The owner is fixed by the test, not chowned: the file's real owner is `uid`, the reader wants another.
    expect(readSheetFile(dir, (uid ?? 0) + 1)).toBeNull();
  });

  it('a 4097-byte file gives null on every platform', () => {
    const dir = folder();
    sheetWith(dir, `${VALID_SHEET}${' '.repeat(SHEET_MAX_BYTES + 1 - VALID_SHEET.length)}`);
    expect(readSheetFile(dir, POSIX ? uid : undefined)).toBeNull();
  });
});

describe('runInstinct with an unreadable sheet', () => {
  it('a 4097-byte sheet reports sheet_invalid and never connects to the world', async () => {
    const root = folder();
    const stateDir = join(root, 'instinct');
    mkdirSync(stateDir);
    sheetWith(stateDir, 'x'.repeat(SHEET_MAX_BYTES + 1));
    const connect = vi.fn();
    const result = await runInstinct(
      { GELDAR_INSTINCT_STATE: stateDir, GELDAR_MCP_URL: 'http://127.0.0.1:1/p/life-1' },
      1,
      new Date(0),
      connect,
    );
    expect(result).toMatchObject({ kind: 'pass', reason: 'sheet_invalid' });
    expect(connect).not.toHaveBeenCalled();
  });
});
