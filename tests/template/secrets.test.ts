import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listFiles, repoRoot, tokenShapes } from './check.ts';

const templateDir = path.join(repoRoot, 'template');

// Run git with no global or system configuration, so a developer's own ignore rules cannot leak in.
function git(dir: string, args: string[]): void {
  execFileSync('git', ['-c', 'core.excludesFile=', ...args], {
    cwd: dir,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
    },
  });
}

function ignored(file: string): boolean {
  const dir = mkdtempSync(path.join(tmpdir(), 'secrets-'));
  try {
    git(dir, ['init', '-q']);
    // Use the template rules as the temp repo's own .gitignore.
    copyFileSync(path.join(templateDir, '.gitignore'), path.join(dir, '.gitignore'));
    try {
      git(dir, ['check-ignore', '-q', file]);
      return true;
    } catch {
      return false;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('template secrets', () => {
  it('.gitignore covers the local token file', () => {
    expect(ignored('.geldar-token')).toBe(true);
    expect(ignored('.geldar-token.bak')).toBe(true);
  });

  it('.gitignore covers any .token file', () => {
    expect(ignored('player.token')).toBe(true);
    expect(ignored('player.token.txt')).toBe(true);
  });

  it('.gitignore covers env files', () => {
    expect(ignored('.env')).toBe(true);
    expect(ignored('.env.local')).toBe(true);
  });

  const mcp = JSON.parse(readFileSync(path.join(templateDir, '.mcp.json'), 'utf8')) as {
    mcpServers: Record<string, { url?: string; headers?: Record<string, string> }>;
  };

  it('.mcp.json has no literal bearer value', () => {
    expect(mcp.mcpServers.geldar?.headers?.Authorization).toBe('Bearer ${GELDAR_MCP_TOKEN}');
  });

  it('.mcp.json names no literal host', () => {
    expect(mcp.mcpServers.geldar?.url).toBe('${GELDAR_MCP_URL}');
  });

  it('no file under template/ holds a token-shaped string', () => {
    for (const rel of listFiles(templateDir)) {
      const text = readFileSync(path.join(templateDir, rel), 'utf8');
      for (const shape of tokenShapes) expect(text, rel).not.toMatch(shape);
    }
  });
});
