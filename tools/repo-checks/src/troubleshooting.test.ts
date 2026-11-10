import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoPath = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const MESSAGES_DIR = repoPath('launcher/messages.d');
const DOC = readFileSync(repoPath('docs/troubleshooting.md'), 'utf8');

// Every message key of every messages.d table: the first tab-separated field of each line.
const KEYS = readdirSync(MESSAGES_DIR)
  .filter((name) => name.endsWith('.tsv'))
  .sort()
  .flatMap((name) =>
    readFileSync(join(MESSAGES_DIR, name), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.split('\t')[0] ?? ''),
  );

// The document is cut before every level 2 or level 3 heading. A key section runs from its
// "### key" line to the next heading of either level.
const CHUNKS = DOC.split(/^(?=#{2,3} )/m);
const KEY_SECTIONS = CHUNKS.filter((chunk) => chunk.startsWith('### ')).map((chunk) => ({
  key: chunk.split('\n', 1)[0]?.slice(4) ?? '',
  text: chunk,
}));

// The rows of the "Not a problem" table: | `key` | explanation |.
const NOT_A_PROBLEM = CHUNKS.filter((chunk) => chunk.startsWith('## Not a problem')).join('');
const ROWS = NOT_A_PROBLEM.split('\n')
  .map((line) => line.match(/^\|\s*`([a-z][a-z0-9_]*)`\s*\|\s*(.*?)\s*\|$/))
  .filter((m): m is RegExpMatchArray => m !== null)
  .map((m) => ({ key: m[1] ?? '', explanation: m[2] ?? '' }));

const HEADED_KEYS = KEY_SECTIONS.map((s) => s.key);
const ROW_KEYS = ROWS.map((r) => r.key);

const LABELS = ['What it means.', 'Why it is safe.', 'What to do.'];
const SENTENCE = /[A-Za-z].*[.!?]/s;

// The labels that are missing, repeated, or have a body without a sentence. A labelled
// paragraph starts with its label, after a blank line or at the top of the section.
function badLabels(section: string): string[] {
  const paragraphs = section.split(/\n\s*\n/).map((p) => p.trim());
  return LABELS.filter((label) => {
    const own = paragraphs.filter((p) => p.startsWith(label));
    return own.length !== 1 || !SENTENCE.test((own[0] ?? '').slice(label.length));
  });
}

// An IP address in the text other than 127.0.0.1.
const OTHER_IP = /\b(?!127\.0\.0\.1\b)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;

describe('docs/troubleshooting.md', () => {
  it('has exactly one heading or one Not a problem row for every message key', () => {
    const missing = KEYS.filter(
      (key) =>
        HEADED_KEYS.filter((k) => k === key).length + ROW_KEYS.filter((k) => k === key).length !==
        1,
    );
    expect(missing).toEqual([]);
  });

  it('names no key that no longer exists', () => {
    const gone = [...HEADED_KEYS, ...ROW_KEYS].filter((key) => !KEYS.includes(key));
    expect(gone).toEqual([]);
  });

  it('gives every key section its three labelled paragraphs, each with a sentence', () => {
    const bad = KEY_SECTIONS.map((s) => ({ key: s.key, labels: badLabels(s.text) })).filter(
      (s) => s.labels.length > 0,
    );
    expect(bad).toEqual([]);
  });

  it('gives every Not a problem row a non-empty explanation', () => {
    expect(ROWS.filter((r) => r.explanation === '').map((r) => r.key)).toEqual([]);
  });

  it('contains no ESC byte', () => {
    expect(DOC).not.toContain('\u001b');
  });

  it('contains no IP address other than 127.0.0.1', () => {
    expect(DOC.match(OTHER_IP) ?? []).toEqual([]);
  });
});
