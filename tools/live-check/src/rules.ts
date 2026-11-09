export interface PathRule {
  tool: 'Read' | 'Edit' | 'Write';
  pattern: string;
}

export interface DenyRules {
  tools: string[];
  paths: PathRule[];
}

const PATH_TOOLS = ['Read', 'Edit', 'Write'] as const;

/** Collapse `.`, `..` and repeated slashes. Case is kept (the CLI is case-sensitive). */
export function normalizePath(path: string): string {
  const absolute = path.startsWith('/');
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push('..');
      continue;
    }
    out.push(seg);
  }
  return (absolute ? '/' : '') + out.join('/');
}

function patternToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/** Does `path` (normalised first) match the rule's pattern? */
export function pathMatchesRule(path: string, rule: PathRule): boolean {
  const pattern = rule.pattern.startsWith('//') ? rule.pattern.slice(1) : rule.pattern;
  return patternToRegExp(normalizePath(pattern)).test(normalizePath(path));
}

export function parseDenyRules(managedJson: string): DenyRules {
  const parsed = JSON.parse(managedJson) as { permissions?: { deny?: unknown } };
  const deny = parsed.permissions?.deny;
  if (!Array.isArray(deny)) throw new Error('managed.json has no permissions.deny list');
  const tools: string[] = [];
  const paths: PathRule[] = [];
  for (const entry of deny) {
    if (typeof entry !== 'string') throw new Error('permissions.deny holds a non-string entry');
    const m = /^(\w+)\((.*)\)$/s.exec(entry);
    if (!m) {
      tools.push(entry);
      continue;
    }
    const tool = m[1] as (typeof PATH_TOOLS)[number];
    if (!PATH_TOOLS.includes(tool)) continue;
    paths.push({ tool, pattern: m[2] as string });
  }
  return { tools, paths };
}
