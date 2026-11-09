/**
 * Hygiene checks for the campaign markdown in docs/analysis/scriptorium/*.md.
 * Pure functions over text so tests use fixtures; the cli reads the files.
 */
export interface SpecFinding {
  file: string;
  line: number;
  message: string;
}

export interface SpecFile {
  file: string;
  text: string;
}

const ROW_ID = /^\|\s*(SC-\d+[a-z]?)\s*\|/;
const REF = /(?<![A-Za-z0-9-])SC-\d+[a-z]?(?![A-Za-z0-9])/g;
/** A file may list unsuffixed ids it still uses on purpose: <!-- legacy-ids: SC-22, SC-23 --> */
const LEGACY = /<!--\s*legacy-ids:\s*([^>]*?)\s*-->/;

/** Ledger ids: first cell of every table row that starts with `| SC-NN`. */
export function ledgerIds(readme: string): Set<string> {
  const ids = new Set<string>();
  for (const line of readme.split('\n')) {
    const m = ROW_ID.exec(line);
    if (m?.[1]) ids.add(m[1]);
  }
  return ids;
}

export function checkSpecFile(file: SpecFile, ids: Set<string>): SpecFinding[] {
  const out: SpecFinding[] = [];
  const add = (line: number, message: string) => out.push({ file: file.file, line, message });
  const legacyMatch = LEGACY.exec(file.text);
  const legacy = new Set((legacyMatch?.[1] ?? '').split(/[\s,]+/).filter((s) => s !== ''));
  const lines = file.text.split('\n');
  let inFence = false;
  let openSpanLine = 0;
  lines.forEach((raw, i) => {
    const n = i + 1;
    if (raw.includes('\r')) add(n, 'carriage return (CR) in line');
    // biome-ignore lint/suspicious/noControlCharactersInRegex: this is the check
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) add(n, 'control character');
    const line = raw.replace(/\r/g, '');
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      openSpanLine = 0;
      return;
    }
    if (inFence) return;
    if (line.trim() === '') {
      if (openSpanLine) add(openSpanLine, 'inline code span is broken by a line break');
      openSpanLine = 0;
      return;
    }
    // Backtick parity per paragraph line: an odd count leaves a span open across the break.
    const ticks = (line.match(/(?<!`)`(?!`)/g) ?? []).length;
    if (openSpanLine) {
      if (ticks % 2 === 1) {
        add(openSpanLine, 'inline code span contains a literal line break');
        openSpanLine = 0;
      }
    } else if (ticks % 2 === 1) {
      openSpanLine = n;
    }
    for (const m of line.matchAll(REF)) {
      const id = m[0];
      if (ids.has(id) || legacy.has(id)) continue;
      if (!/[a-z]$/.test(id) && [...ids].some((x) => x.startsWith(`${id}`) && x !== id)) {
        add(
          n,
          `${id} has no ledger row (only suffixed rows exist; list it in legacy-ids if intended)`,
        );
      } else {
        add(n, `${id} has no ledger row`);
      }
    }
  });
  if (openSpanLine) add(openSpanLine, 'inline code span is never closed');
  return out;
}

export function checkSpecs(files: SpecFile[], readme: string): SpecFinding[] {
  const ids = ledgerIds(readme);
  return files.flatMap((f) => checkSpecFile(f, ids));
}
