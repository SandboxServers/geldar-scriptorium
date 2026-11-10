import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { forbidden, repoRoot } from './check.ts';

// The Patron guide must stay in step with the launcher: its verbs and flags are read from the launcher source.
const readmePath = path.join(repoRoot, 'template/README.md');
const text = readFileSync(readmePath, 'utf8');
const launcherSource = [
  readFileSync(path.join(repoRoot, 'launcher/geldar-play'), 'utf8'),
  readFileSync(path.join(repoRoot, 'launcher/lib/new.sh'), 'utf8'),
];

// The sections of the guide, in order (SC-70a card, sections 1 to 9).
const headings = [
  '## What this is',
  '## What you need',
  '## Install and check the launcher',
  '## Make your player',
  '## A day with your player',
  '## Be a Patron, not a puppeteer',
  '## Start with one player',
  '## When something stops',
  '## Getting help',
];

// The only addresses the guide may show: the releases page of the player template, and the GitHub CLI page.
const allowedUrls = [
  'https://github.com/SandboxServers/geldar-player-template/releases',
  'https://cli.github.com/',
];

// Lines of every code fence, and every inline code span that starts with the launcher's name.
function commandLines(md: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of md.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence && trimmed.startsWith('geldar-play')) out.push(trimmed);
  }
  for (const m of md.matchAll(/`(geldar-play[^`]*)`/g)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

// The verbs are the words of the launcher's main case line, for example "new | setup | play ... | upgrade) ;;".
function launcherVerbs(): string[] {
  const m = /^\s+((?:[a-z]+ \| )+[a-z]+)\) ;;$/m.exec(launcherSource[0] ?? '');
  if (!m?.[1]) throw new Error('the verb line of launcher/geldar-play was not found');
  return m[1].split(' | ');
}

describe('template/README.md', () => {
  it('has the nine sections, in order, each once', () => {
    const found = text.split('\n').filter((l) => l.startsWith('## '));
    expect(found.filter((h) => headings.includes(h))).toEqual(headings);
  });

  it('names only verbs the launcher has, in code fences and inline code', () => {
    const verbs = launcherVerbs();
    expect(verbs).toEqual(expect.arrayContaining(['new', 'setup', 'play', 'status']));
    const bad: string[] = [];
    for (const line of commandLines(text)) {
      const [, word] = line.split(/\s+/);
      if (word && !word.startsWith('-') && !verbs.includes(word)) bad.push(line);
    }
    expect(bad).toEqual([]);
  });

  it('shows only flags the launcher accepts', () => {
    const source = launcherSource.join('\n');
    const bad: string[] = [];
    for (const line of commandLines(text)) {
      for (const token of line.split(/\s+/)) {
        if (token.startsWith('--') && !source.includes(token)) bad.push(token);
      }
    }
    expect(bad).toEqual([]);
  });

  it('does not show the owner or developer options', () => {
    expect(text).not.toMatch(/--persona-dir|GELDAR_DEV_MCP_URL/);
  });

  it('contains none of the forbidden words of the template check', () => {
    const bad = forbidden.filter((w) => text.includes(w));
    expect(bad).toEqual([]);
  });

  it('links only to the allowed addresses, and to the releases page', () => {
    const urls = (text.match(/https?:\/\/[^\s)>`]+/g) ?? []).map((u) => u.replace(/[.,;:]+$/, ''));
    expect(urls.filter((u) => !allowedUrls.includes(u))).toEqual([]);
    expect(urls).toContain(allowedUrls[0]);
  });

  it('shows no IP address except 127.0.0.1', () => {
    const ips = (text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []).filter(
      (ip) => ip !== '127.0.0.1',
    );
    expect(ips).toEqual([]);
  });

  it('is at most 250 lines', () => {
    expect(text.replace(/\n$/, '').split('\n').length).toBeLessThanOrEqual(250);
  });

  it('speaks to the Patron in the second person', () => {
    expect(text).toMatch(/\byou\b/i);
    expect(text).not.toMatch(/\bwe /i);
    expect(text).not.toMatch(/\bour team\b/i);
    expect(text).not.toMatch(/the developers/i);
  });
});
