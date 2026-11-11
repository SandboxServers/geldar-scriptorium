import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const allowedKeys = ['name', 'description', 'model', 'effort', 'tools', 'initialPrompt'];
const bannedWords = [
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
];

function path(relative: string): string {
  return fileURLToPath(new URL(`../../${relative}`, import.meta.url));
}

// Splits an agent file into simple frontmatter (key: value, or key then "- item" lines) and body.
function parseAgent(text: string): { front: Record<string, string | string[]>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replaceAll('\r\n', '\n'));
  if (!match) throw new Error('no frontmatter');
  const front: Record<string, string | string[]> = {};
  let list: string[] | undefined;
  for (const line of (match[1] ?? '').split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && list) {
      list.push((item[1] ?? '').trim());
      continue;
    }
    const pair = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!pair) throw new Error(`bad frontmatter line: ${line}`);
    const key = pair[1] ?? '';
    const value = (pair[2] ?? '').trim();
    if (value === '') {
      list = [];
      front[key] = list;
    } else {
      list = undefined;
      front[key] = value;
    }
  }
  return { front, body: match[2] ?? '' };
}

const settings = JSON.parse(readFileSync(path('template/.claude/settings.json'), 'utf8')) as {
  agent?: string;
  model?: string;
};
const planner = path('template/.claude/agents/planner.md');

describe('template agent files', () => {
  it('has the planner file', () => {
    expect(existsSync(planner)).toBe(true);
  });

  const { front, body } = parseAgent(readFileSync(planner, 'utf8'));

  it('uses only allowed frontmatter keys', () => {
    for (const key of Object.keys(front)) {
      expect(allowedKeys, `unknown key ${key}`).toContain(key);
    }
  });

  it('runs on sonnet at low effort', () => {
    expect(front.model).toBe('sonnet');
    expect(front.effort).toBe('low');
  });

  it('lists Agent and the three Geldar tool families', () => {
    expect(front.tools).toEqual(
      expect.arrayContaining([
        'Agent',
        'mcp__geldar__*',
        'mcp__geldar_memory__*',
        'mcp__geldar_git__*',
      ]),
    );
  });

  it('keeps model names and meta words out of the body', () => {
    const lower = body.toLowerCase();
    for (const word of bannedWords) {
      expect(lower.includes(word), `body contains ${word}`).toBe(false);
    }
  });

  it('is the agent the settings start, and the settings model is sonnet', () => {
    expect(settings.agent).toBeDefined();
    expect(existsSync(path(`template/.claude/agents/${settings.agent}.md`))).toBe(true);
    expect(settings.model).toBe('sonnet');
  });
});
