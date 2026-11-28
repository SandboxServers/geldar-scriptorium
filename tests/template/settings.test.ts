import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Settings = {
  agent?: string;
  model?: string;
  effortLevel?: string;
  autoMemoryEnabled?: boolean;
  permissions?: {
    allow?: string[];
    deny?: string[];
    defaultMode?: string;
    blockReadsOutsideWorkingDirectories?: boolean;
  };
  hooks?: Record<string, { matcher: string; hooks: { type: string; command: string }[] }[]>;
};

type McpFile = {
  mcpServers: Record<string, { timeout?: number; url?: string; command?: string }>;
};

function load<T>(relative: string): T {
  const file = fileURLToPath(new URL(`../../${relative}`, import.meta.url));
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

const managed = load<Settings>('image/settings/managed.json');
const play = load<Settings>('image/settings/play.json');
const setup = load<Settings>('image/settings/setup.json');
const project = load<Settings>('template/.claude/settings.json');
const mcp = load<McpFile>('template/.mcp.json');
const layers: Record<string, Settings> = { managed, play, setup, project };

const worldTools = [
  'look',
  'view',
  'see',
  'wait',
  'act',
  'say',
  'read_book',
  'write_book',
  'define_skill',
  'use_skill',
  'offer',
  'propose',
  'vote',
  'sleep',
  'journal',
  'status',
  'survey',
  'plan_check',
].map((tool) => `mcp__geldar__${tool}`);
const companionTools = ['mcp__geldar_memory__recall', 'mcp__geldar_git__commit_memory'];
// The player may open its own skills by name, and no other: the owner-side setup skill and the
// harness skills stay out of reach.
const skillRules = readdirSync(
  fileURLToPath(new URL('../../template/.claude/skills', import.meta.url)),
)
  .filter((name) => name !== 'setup')
  .map((name) => `Skill(${name})`);
const allowedPathRules = new Set([
  'Edit(/memory/**)',
  'Write(/memory/**)',
  'Edit(/skills/**)',
  'Write(/skills/**)',
  'Read(/**)',
  ...skillRules,
]);
const kitPaths = [
  '/.claude/**',
  '/CLAUDE.md',
  '/AGENTS.md',
  '/.mcp.json',
  '/player.json',
  '/.gitattributes',
];

describe('Claude Code settings layers', () => {
  it('managed denies Bash, WebFetch and WebSearch', () => {
    expect(managed.permissions?.deny).toEqual(
      expect.arrayContaining(['Bash', 'WebFetch', 'WebSearch']),
    );
  });

  it('no layer allows Bash, WebFetch, WebSearch, Read(**) or a path rule outside the allowed set', () => {
    for (const [name, settings] of Object.entries(layers)) {
      for (const rule of settings.permissions?.allow ?? []) {
        expect(['Bash', 'WebFetch', 'WebSearch'], `${name} allows ${rule}`).not.toContain(rule);
        if (rule.includes('(')) {
          expect(allowedPathRules.has(rule), `${name} allows ${rule}`).toBe(true);
        }
      }
    }
  });

  it('every allowed mcp__ name is a Geldar world tool or a companion tool', () => {
    const known = new Set([...worldTools, ...companionTools]);
    for (const rule of project.permissions?.allow ?? []) {
      if (rule.startsWith('mcp__')) {
        expect(known.has(rule), `unknown MCP tool ${rule}`).toBe(true);
      }
    }
    for (const tool of [...worldTools, ...companionTools]) {
      expect(project.permissions?.allow, `missing ${tool}`).toContain(tool);
    }
  });

  it('allows exactly the player skills by name', () => {
    const rules = (project.permissions?.allow ?? []).filter((rule) => rule.startsWith('Skill('));
    expect(rules.sort()).toEqual([...skillRules].sort());
  });

  it('uses effortLevel low and model haiku', () => {
    expect(project.effortLevel).toBe('low');
    expect(project.model).toBe('haiku');
  });

  it('starts as the planner agent, whose file exists', () => {
    expect(project.agent).toBe('planner');
    const file = fileURLToPath(
      new URL('../../template/.claude/agents/planner.md', import.meta.url),
    );
    expect(existsSync(file)).toBe(true);
  });

  it('anchors every PostToolUse matcher', () => {
    for (const group of project.hooks?.PostToolUse ?? []) {
      expect(group.matcher.startsWith('^')).toBe(true);
      expect(group.matcher.endsWith('$')).toBe(true);
    }
  });

  it('gives the geldar MCP server a timeout above the 240 s wait cap', () => {
    expect(mcp.mcpServers.geldar?.timeout).toBeGreaterThan(240000);
  });

  it('play denies edits to the identity file, relative and absolute', () => {
    expect(play.permissions?.deny).toEqual(
      expect.arrayContaining(['Edit(/memory/identity.md)', 'Edit(//player/memory/identity.md)']),
    );
  });

  it('setup denies every Geldar world tool', () => {
    expect(setup.permissions?.deny).toContain('mcp__geldar__*');
  });

  it('project denies Edit on every kit file', () => {
    for (const path of kitPaths) {
      expect(project.permissions?.deny).toContain(`Edit(${path})`);
    }
  });

  it('project denies Write on every kit file, as it denies Edit', () => {
    for (const path of kitPaths) {
      expect(project.permissions?.deny).toContain(`Write(${path})`);
    }
  });

  it('project allows Write on memory, and on skills as it does Edit', () => {
    expect(project.permissions?.allow).toEqual(
      expect.arrayContaining(['Write(/memory/**)', 'Write(/skills/**)']),
    );
  });

  it('project runs in dontAsk mode', () => {
    expect(project.permissions?.defaultMode).toBe('dontAsk');
  });

  it('managed blocks reads outside the working directory and disables auto memory', () => {
    expect(managed.permissions?.blockReadsOutsideWorkingDirectories).toBe(true);
    expect(managed.autoMemoryEnabled).toBe(false);
  });

  it('managed denies reading and editing credentials', () => {
    expect(managed.permissions?.deny).toEqual(
      expect.arrayContaining(['Read(**/.credentials.json)', 'Edit(**/.credentials.json)']),
    );
  });

  it('every Write path rule has the same path as an Edit rule in the same layer', () => {
    for (const [name, settings] of Object.entries(layers)) {
      for (const list of [settings.permissions?.allow ?? [], settings.permissions?.deny ?? []]) {
        for (const rule of list) {
          if (!rule.startsWith('Write(')) continue;
          const edit = `Edit(${rule.slice('Write('.length)}`;
          expect(list, `${name} has ${rule} without ${edit}`).toContain(edit);
        }
      }
    }
  });

  it('every Edit path rule in the project allow list has a Write twin', () => {
    const allow = project.permissions?.allow ?? [];
    for (const rule of allow) {
      if (!rule.startsWith('Edit(')) continue;
      expect(allow, `${rule} has no Write twin`).toContain(`Write(${rule.slice('Edit('.length)}`);
    }
  });

  it('rejects bare Edit, Write and Read allows and mcp wildcard allows in every layer', () => {
    for (const [name, settings] of Object.entries(layers)) {
      for (const rule of settings.permissions?.allow ?? []) {
        expect(['Edit', 'Write', 'Read'], `${name} allows bare ${rule}`).not.toContain(rule);
        expect(rule.startsWith('mcp__') && rule.includes('*'), `${name} allows ${rule}`).toBe(
          false,
        );
      }
    }
  });

  it('forbids an env key in every settings layer', () => {
    for (const [name, settings] of Object.entries(layers)) {
      expect(settings, `${name} sets env`).not.toHaveProperty('env');
    }
  });

  it('allows a bare name only if it is a known mcp__ tool, in every layer', () => {
    const known = new Set([...worldTools, ...companionTools]);
    for (const [name, settings] of Object.entries(layers)) {
      for (const rule of settings.permissions?.allow ?? []) {
        if (!rule.includes('(')) {
          expect(known.has(rule), `${name} allows unknown bare name ${rule}`).toBe(true);
        }
      }
    }
  });
});
