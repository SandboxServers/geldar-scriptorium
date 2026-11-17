import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildPrompt, buildTidyPrompt, TIDY_PROMPT } from '../../packages/supervisor/src/prompt.ts';
import { listFiles, repoRoot } from './check.ts';

// Decision 0350 point 7; 0059 and 0068: an agent must never learn it is watched. Matched case-insensitively,
// as a whole word or as a segment of a file name; a space in a phrase also matches `_` or `-`.
const telemetryWords: readonly string[] = [
  'telemetry',
  'otel',
  'opentelemetry',
  'traceparent',
  'tracestate',
  'trace id',
  'trace_id',
  'span id',
  'span_id',
  'signoz',
  'clickhouse',
  'observability',
  'instrumentation',
  'monitoring',
  'monitored',
  'watched',
  'being watched',
  'logged for',
  'we record',
  'recorded for',
];

// Hits that are clearly unrelated to telemetry (a word in a sentence about hunger, say). Empty today.
const exceptions: readonly { label: string; word: string; reason: string }[] = [];

// A phrase separator is any run of whitespace, `_` or `-`, so a hard-wrapped or double-spaced phrase still matches.
const wordPattern = new RegExp(
  `(?<![A-Za-z0-9])(?:${telemetryWords
    .map((word) => word.replace(/ |_/g, '[\\s_-]+'))
    .join('|')})(?![A-Za-z0-9])`,
  'gi',
);

// Files that are not text: they are never read as words.
const binary = /\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|db|sqlite|bin|woff2?)$/i;

interface Hit {
  label: string;
  word: string;
}

// Splits camelCase, PascalCase and letter/digit runs (`traceId`, `OTELExporter`, `otel2`) so that the
// boundary rule above sees each word on its own.
function splitIdentifiers(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2');
}

// The telemetry words in one text; the label names where the text came from. The text is read as written
// (`TraceParent` must not be split) and split at identifier boundaries; a word found either way is one hit.
function scanText(label: string, text: string): Hit[] {
  const found = new Set<string>();
  for (const view of [text, splitIdentifiers(text)]) {
    for (const m of view.matchAll(wordPattern)) {
      found.add(m[0].replace(/\s+/g, ' ').toLowerCase());
    }
  }
  return [...found].map((word) => ({ label, word }));
}

// Scans the template (content and file names) and image/settings/*.json under root.
function scanKit(root: string): { scanned: string[]; hits: Hit[] } {
  const scanned: string[] = [];
  const hits: Hit[] = [];
  const template = path.join(root, 'template');
  for (const rel of listFiles(template)) {
    const label = `template/${rel}`;
    scanned.push(label);
    hits.push(...scanText(`file name ${label}`, rel));
    if (binary.test(rel)) continue;
    hits.push(...scanText(label, readFileSync(path.join(template, rel), 'utf8')));
  }
  const settings = path.join(root, 'image/settings');
  for (const name of readdirSync(settings)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    const label = `image/settings/${name}`;
    scanned.push(label);
    hits.push(...scanText(`file name ${label}`, name));
    hits.push(...scanText(label, readFileSync(path.join(settings, name), 'utf8')));
  }
  return { scanned, hits };
}

// The prompt text for neutral inputs only: a player's own words may hold any word, so no
// telemetry word is ever fed in as an input.
const promptSamples: readonly [string, string][] = [
  ['buildPrompt, empty input', buildPrompt(1, '', null)],
  ['buildPrompt, long last words', buildPrompt(12, 'the lake was cold. '.repeat(200), null)],
  [
    'buildPrompt, with a handoff, goals and identity',
    buildPrompt(
      3,
      'I walked to the river.',
      null,
      'Rested by the river; the wolves left.',
      'Find iron and bread.',
      'I am a farmer, slow to trust.',
    ),
  ],
  ['buildPrompt, with a note', buildPrompt(4, 'I dug a pit.', 'Eat the bread when hungry.')],
  ['buildTidyPrompt', buildTidyPrompt()],
];

// Scratch copies of the kit for the self-tests, so the real template is never edited.
const copies: string[] = [];

function copyKit(edit: (root: string) => void): string {
  const root = mkdtempSync(path.join(tmpdir(), 'tm26-'));
  copies.push(root);
  cpSync(path.join(repoRoot, 'template'), path.join(root, 'template'), { recursive: true });
  cpSync(path.join(repoRoot, 'image/settings'), path.join(root, 'image/settings'), {
    recursive: true,
  });
  edit(root);
  return root;
}

function messages(hits: Hit[]): string[] {
  return hits
    .filter((h) => !exceptions.some((e) => e.label === h.label && e.word === h.word))
    .map((h) => `${h.label} contains "${h.word}"`);
}

afterAll(() => {
  for (const dir of copies) rmSync(dir, { recursive: true, force: true });
});

describe('telemetry words in what the model reads', () => {
  it('the template and the managed settings have no telemetry word today', () => {
    expect(messages(scanKit(repoRoot).hits)).toEqual([]);
  });

  it('scans the template files, the managed settings and the prompt builders', () => {
    const { scanned } = scanKit(repoRoot);
    expect(scanned).toEqual(
      expect.arrayContaining([
        'template/.mcp.json',
        'template/.claude/settings.json',
        'template/.claude/skills/play/SKILL.md',
        'image/settings/managed.json',
      ]),
    );
    expect(promptSamples.map(([label]) => label)).toEqual([
      'buildPrompt, empty input',
      'buildPrompt, long last words',
      'buildPrompt, with a handoff, goals and identity',
      'buildPrompt, with a note',
      'buildTidyPrompt',
    ]);
  });

  it('the prompt builders produce clean text for neutral inputs', () => {
    expect(promptSamples.flatMap(([label, text]) => scanText(label, text))).toEqual([]);
  });

  it('fails on a telemetry line appended to .mcp.json, naming the file and the word', () => {
    const root = copyKit((r) =>
      appendFileSync(path.join(r, 'template/.mcp.json'), '\nOTEL_EXPORTER=1\n'),
    );
    expect(messages(scanKit(root).hits)).toEqual(['template/.mcp.json contains "otel"']);
  });

  it('fails on a file named otel-notes.md by its path', () => {
    const root = copyKit((r) => writeFileSync(path.join(r, 'template/otel-notes.md'), 'Notes.\n'));
    expect(messages(scanKit(root).hits)).toEqual([
      'file name template/otel-notes.md contains "otel"',
    ]);
  });

  it('fails on the word telemetry added to a skill', () => {
    const root = copyKit((r) =>
      appendFileSync(path.join(r, 'template/.claude/skills/play/SKILL.md'), '\nTelemetry is on.\n'),
    );
    expect(messages(scanKit(root).hits)).toEqual([
      'template/.claude/skills/play/SKILL.md contains "telemetry"',
    ]);
  });

  it('fails on a camelCase telemetry key added to .mcp.json', () => {
    const root = copyKit((r) =>
      appendFileSync(path.join(r, 'template/.mcp.json'), '\n"telemetryEnabled": true\n'),
    );
    expect(messages(scanKit(root).hits)).toEqual(['template/.mcp.json contains "telemetry"']);
  });

  it('fails on a PascalCase file name that starts with a telemetry word', () => {
    const root = copyKit((r) =>
      writeFileSync(path.join(r, 'template/TelemetryNotes.md'), 'Notes.\n'),
    );
    expect(messages(scanKit(root).hits)).toEqual([
      'file name template/TelemetryNotes.md contains "telemetry"',
    ]);
  });

  it('fails on a telemetry phrase hard-wrapped across a line in a skill', () => {
    const root = copyKit((r) =>
      appendFileSync(
        path.join(r, 'template/.claude/skills/play/SKILL.md'),
        '\nWe\nrecord your steps.\n',
      ),
    );
    expect(messages(scanKit(root).hits)).toEqual([
      'template/.claude/skills/play/SKILL.md contains "we record"',
    ]);
  });

  it('fails on a monitoring word added to a managed settings file', () => {
    const root = copyKit((r) =>
      appendFileSync(path.join(r, 'image/settings/managed.json'), '\n// being watched\n'),
    );
    expect(messages(scanKit(root).hits)).toEqual([
      'image/settings/managed.json contains "being watched"',
    ]);
  });

  it('fails when the static tidy prompt text is patched with telemetry', () => {
    const patched = `${TIDY_PROMPT} Telemetry is on.`;
    expect(messages(scanText('TIDY_PROMPT', patched))).toEqual([
      'TIDY_PROMPT contains "telemetry"',
    ]);
  });

  it('fails when the built prompt text is patched with telemetry', () => {
    const built = buildPrompt(1, '', null);
    const patched = built.replace('Read your journal', 'Read your telemetry journal');
    expect(patched).not.toBe(built);
    expect(messages(scanText('buildPrompt', patched))).toEqual([
      'buildPrompt contains "telemetry"',
    ]);
  });
});
