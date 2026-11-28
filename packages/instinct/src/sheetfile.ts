// The supervisor-side read of the stored sheet: one regular file `sheet.json` in the instinct state folder,
// private to the player uid and at most 4096 bytes. Anything else reads as no sheet (null), never as a throw.
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSheet, type Sheet } from '@geldar/scriptorium-psyche';

/** The largest sheet file the instinct step reads; a sheet is a few hundred bytes. */
export const SHEET_MAX_BYTES = 4096;

/**
 * The sheet in `dir`, or null when the file is missing, a link, not a regular file, any group or other
 * mode bit is set, its owner is not `uid`, it is over SHEET_MAX_BYTES, or it does not parse. The mode and
 * owner checks are POSIX only: on Windows they are skipped. `uid` is the process uid (undefined on Windows).
 */
export function readSheetFile(dir: string, uid: number | undefined): Sheet | null {
  try {
    const file = join(dir, 'sheet.json');
    // lstat, not stat: a link is refused rather than followed.
    const st = lstatSync(file);
    if (!st.isFile()) return null;
    if (st.size > SHEET_MAX_BYTES) return null;
    if (process.platform !== 'win32') {
      if ((st.mode & 0o077) !== 0) return null;
      if (uid === undefined || st.uid !== uid) return null;
    }
    return parseSheet(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
