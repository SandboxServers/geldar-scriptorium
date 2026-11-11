// The worker agent: the small model, a low effort, only the kit's own tools, and a hand-off reply.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './check.ts';

const text = readFileSync(resolve(repoRoot, 'template/.claude/agents/worker.md'), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const lines = text.split('\n');
const close = lines.indexOf('---', 1);
const front = new Map<string, string>();
for (const line of lines.slice(1, close)) {
  const at = line.indexOf(':');
  front.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
}
const body = lines.slice(close + 1).join('\n');

describe('the worker agent', () => {
  it('opens with fenced frontmatter', () => {
    expect(lines[0]).toBe('---');
    expect(close).toBeGreaterThan(1);
  });

  it('uses only the proven frontmatter keys', () => {
    const allowed = ['name', 'description', 'model', 'effort', 'tools', 'maxTurns'];
    for (const key of front.keys()) expect(allowed, key).toContain(key);
    expect(front.get('name')).toBe('worker');
    expect(front.get('description')).not.toBe('');
  });

  it('runs on haiku at low effort', () => {
    expect(front.get('model')).toBe('haiku');
    expect(front.get('effort')).toBe('low');
  });

  it('keeps a turn backstop of 60', () => {
    expect(front.get('maxTurns')).toBe('60');
  });

  it('holds only the kit tools', () => {
    const tools = (front.get('tools') ?? '')
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t !== '');
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) expect(tool.startsWith('mcp__geldar__'), tool).toBe(true);
    for (const banned of ['Bash', 'Edit', 'Write', 'Agent', 'Task']) {
      expect(front.get('tools'), banned).not.toContain(banned);
    }
  });

  it('keeps model names and meta words out of the text', () => {
    const words = [
      'sonnet',
      'haiku',
      'opus',
      'orchestrator',
      'subagent',
      'model',
      'context',
      'token',
      'prompt',
      'human',
      'terminal',
      'geldar tools',
      'budget',
      'cap',
      'limit',
    ];
    const prose = `${front.get('description')}\n${body}`.toLowerCase();
    for (const word of words) expect(prose, word).not.toContain(word);
  });

  it('asks for a hand-off: what is done, what is left, the one next step', () => {
    const flat = body.replace(/\s+/g, ' ');
    expect(flat).toContain('what is done, what is left, and the one next step');
    expect(flat).toContain('That reply is your hand-off. You write no file.');
  });
});
