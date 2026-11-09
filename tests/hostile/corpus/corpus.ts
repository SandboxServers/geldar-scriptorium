// The malicious-book corpus, scriptorium side (SC-61e).
//
// manifest.json holds one row per corpus entry (MB-01 to MB-09): the canary, the fake secrets,
// the markers a memory file must not contain, the hardening items that answer it, the gullible
// session script (a file under gullible/, or null when no workspace action expresses the attack)
// and the tests that enforce the rest (each carries the comment `// corpus: MB-nn`).
// The hostile text itself lives in the geldar repo (threshold/mcp-mock/scenarios/malicious).
// A gullible session is run through SC-60a's `attack`: it does what a fooled agent would leave
// in the workspace, and the test proves nothing reaches the host, the config or the remote.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Launcher } from '../../../launcher/test/harness.ts';
import { type Attack, type AttackOptions, attack } from '../../../launcher/test/hostile/world.ts';

export interface CorpusEntry {
  id: string;
  class: string;
  canary: string;
  fake_secrets: string[];
  forbidden_markers: string[];
  marker_regex: string | null;
  h_items: string[];
  gullible: string | null;
  enforced_by: { file: string; marker: string }[];
}

export const corpusDir = dirname(fileURLToPath(import.meta.url));

export const manifest: CorpusEntry[] = JSON.parse(
  readFileSync(join(corpusDir, 'manifest.json'), 'utf8'),
);

export function gulliblePath(entry: CorpusEntry): string {
  if (!entry.gullible) throw new Error(`${entry.id} has no gullible session`);
  return join(corpusDir, 'gullible', entry.gullible);
}

// Runs the entry's gullible script as the session. `attack` throws when the script did not run
// (the `ran` guard), unless the caller says the launcher should refuse first (expectRun: false).
export function runGullible(
  launcher: Launcher,
  entry: CorpusEntry,
  opts: Partial<Omit<AttackOptions, 'session'>> = {},
): Attack {
  return attack(launcher, {
    ...opts,
    session: readFileSync(gulliblePath(entry), 'utf8'),
  });
}
