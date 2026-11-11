// No Docker here: the two variables are read from the files that set them.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './docker.ts';

// Account connectors (a claude.ai login adds Gmail, Calendar, Drive and Docs) and deferred tool
// search would both change what a player's session can reach or see. Both are off in the session
// service and in the image, so a session started either way has them.
const sessionVars = { ENABLE_CLAUDEAI_MCP_SERVERS: 'false', ENABLE_TOOL_SEARCH: 'false' };
// A 200k window: compaction and the meter lines assume it.
const windowVar = 'CLAUDE_CODE_DISABLE_1M_CONTEXT';
const compose = readFileSync(resolve(repoRoot, 'image/compose/session.yml'), 'utf8');
const dockerfile = readFileSync(resolve(repoRoot, 'image/Dockerfile'), 'utf8');
// The session service's block: from its key to the next top-level key.
const sessionBlock = /^ {2}session:\n([\s\S]*?)^\S/m.exec(compose)?.[1] ?? '';

describe('session environment turns off account connectors and tool search', () => {
  it('the session service sets both variables to false', () => {
    expect(sessionBlock).not.toBe('');
    for (const [name, value] of Object.entries(sessionVars)) {
      expect(sessionBlock, name).toMatch(new RegExp(`^ {6}${name}: "${value}"$`, 'm'));
    }
  }, 120_000);

  it('the image sets both variables to false', () => {
    for (const [name, value] of Object.entries(sessionVars)) {
      expect(dockerfile, name).toMatch(new RegExp(`^ENV .*\\b${name}=${value}(\\s|$)`, 'm'));
    }
  }, 120_000);

  it('the session service and the image set the 200k window', () => {
    expect(sessionBlock, windowVar).toMatch(new RegExp(`^ {6}${windowVar}: "1"$`, 'm'));
    expect(dockerfile, windowVar).toMatch(new RegExp(`^ENV .*\\b${windowVar}=1(\\s|$)`, 'm'));
  }, 120_000);
});
