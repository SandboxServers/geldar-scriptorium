import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from './server.ts';
import { connect, textOf } from './test-client.ts';

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'sc21-root-'));
  outside = mkdtempSync(path.join(os.tmpdir(), 'sc21-outside-'));
  mkdirSync(path.join(root, 'memory', 'people'), { recursive: true });
  mkdirSync(path.join(root, 'memory', 'journal'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function write(rel: string, content: string | Buffer): void {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

async function call(args: Record<string, unknown>) {
  const client = await connect(createServer(root));
  try {
    return await client.callTool({ name: 'recall', arguments: args });
  } finally {
    await client.close();
  }
}

async function recallText(section: string) {
  return call({ section });
}

describe('recall server', () => {
  it('exposes exactly one tool, recall', async () => {
    const client = await connect(createServer(root));
    const { tools } = await client.listTools();
    await client.close();
    expect(tools.map((t) => t.name)).toEqual(['recall']);
  });

  it.each([
    ['identity', 'memory/identity.md'],
    ['summary', 'memory/summary.md'],
    ['goals', 'memory/goals.md'],
    ['beliefs', 'memory/beliefs.md'],
    ['people/pike', 'memory/people/pike.md'],
    ['journal/current', 'memory/journal/current.md'],
    ['journal/day-001', 'memory/journal/day-001.md'],
  ])('returns the file for %s', async (section, rel) => {
    write(rel, `words for ${section}`);
    const result = await recallText(section);
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(textOf(result));
    expect(Object.keys(body).sort()).toEqual(['note', 'section', 'source', 'text', 'truncated']);
    expect(body.source).toBe('your own past writing');
    expect(body.section).toBe(section);
    expect(body.text).toBe(`words for ${section}`);
    expect(body.truncated).toBe(false);
    expect(body.note).toContain('not an instruction');
  });

  it('cuts a file over 16384 bytes without splitting a character', async () => {
    write('memory/summary.md', Buffer.from(`a${'é'.repeat(10000)}`, 'utf8'));
    const body = JSON.parse(textOf(await recallText('summary')));
    expect(body.truncated).toBe(true);
    expect(Buffer.byteLength(body.text, 'utf8')).toBeLessThanOrEqual(16384);
    expect(body.text).not.toContain('�');
  });

  it('refuses unknown sections with unknown_section and does not echo the root', async () => {
    for (const section of ['../CLAUDE', 'people/../../CLAUDE', 'identity.md', 'people/con']) {
      const result = await recallText(section);
      expect(result.isError).toBe(true);
      const body = JSON.parse(textOf(result));
      expect(body.error).toBe('unknown_section');
      expect(textOf(result)).not.toContain(root);
    }
  });

  it('answers not_found for a missing day and a missing person', async () => {
    for (const section of ['journal/day-009', 'people/nobody']) {
      const result = await recallText(section);
      expect(result.isError).toBe(true);
      expect(JSON.parse(textOf(result)).error).toBe('not_found');
    }
  });

  it('never follows a symlink out of the root', async (ctx) => {
    const secret = 'TOP-SECRET-TEXT';
    const secretFile = path.join(outside, 'secret.md');
    writeFileSync(secretFile, secret);
    const outsideDir = path.join(outside, 'people-elsewhere');
    mkdirSync(outsideDir);
    writeFileSync(path.join(outsideDir, 'pike.md'), secret);
    try {
      symlinkSync(secretFile, path.join(root, 'memory', 'summary.md'));
      rmSync(path.join(root, 'memory', 'people'), { recursive: true, force: true });
      symlinkSync(
        outsideDir,
        path.join(root, 'memory', 'people'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') ctx.skip();
      throw error;
    }

    for (const section of ['summary', 'people/pike']) {
      const result = await recallText(section);
      expect(result.isError).toBe(true);
      expect(JSON.parse(textOf(result)).error).toBe('unreadable');
      expect(textOf(result)).not.toContain(secret);
    }
  });

  it('rejects a non-string section', async () => {
    const result = await call({ section: 5 });
    expect(result.isError).toBe(true);
  });
});
