import { readFileSync } from 'node:fs';
import path from 'node:path';

// A stdio server, as the player's .mcp.json names it.
export interface ServerSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

// An http server: url and headers have ${VAR} already expanded from process.env.
export interface HttpSpec {
  http: true;
  url: string;
  headers: Record<string, string>;
  // Set when a ${VAR} was unset. The error is raised when the server is used, so a stdio-only
  // scenario still runs from a .mcp.json whose http entry names variables that are not set.
  error?: string;
}

// Replaces each ${VAR} with process.env.VAR. An unset variable is an error naming it.
function expand(text: string, where: string): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const value = process.env[name];
    if (value === undefined) throw new Error(`${where}: the variable ${name} is not set`);
    return value;
  });
}

// Reads <root>/.mcp.json. A missing file or bad JSON throws.
// An entry with a command is stdio; an entry with type "http" is returned as an HttpSpec.
export function readMcpConfig(root: string): Record<string, ServerSpec | HttpSpec> {
  const file = path.join(root, '.mcp.json');
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const servers = (parsed as { mcpServers?: unknown } | null)?.mcpServers;
  if (typeof servers !== 'object' || servers === null) {
    throw new Error(`${file} has no mcpServers object`);
  }
  const result: Record<string, ServerSpec | HttpSpec> = {};
  for (const [name, entry] of Object.entries(servers)) {
    const spec = entry as Record<string, unknown>;
    if (typeof spec.command === 'string') {
      const args = Array.isArray(spec.args) ? spec.args.map(String) : [];
      const env: Record<string, string> = {};
      if (typeof spec.env === 'object' && spec.env !== null) {
        for (const [key, value] of Object.entries(spec.env)) env[key] = String(value);
      }
      result[name] = { command: spec.command, args, env };
    } else if (spec.type === 'http') {
      const where = `${file}: server "${name}"`;
      if (typeof spec.url !== 'string') throw new Error(`${where} has no url`);
      const headers: Record<string, string> = {};
      let url = '';
      try {
        if (typeof spec.headers === 'object' && spec.headers !== null) {
          for (const [key, value] of Object.entries(spec.headers)) {
            headers[key] = expand(String(value), where);
          }
        }
        url = expand(spec.url, where);
      } catch (error) {
        result[name] = { http: true, url, headers, error: (error as Error).message };
        continue;
      }
      result[name] = { http: true, url, headers };
    } else {
      throw new Error(`${file}: server "${name}" has neither a command nor type "http"`);
    }
  }
  return result;
}
