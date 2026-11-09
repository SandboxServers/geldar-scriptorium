import { readFileSync } from 'node:fs';
import path from 'node:path';

// A stdio server, as the player's .mcp.json names it.
export interface ServerSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

// Reads <root>/.mcp.json. A missing file or bad JSON throws.
// An entry with a command is stdio; an entry with type "http" is returned as { http: true }.
export function readMcpConfig(root: string): Record<string, ServerSpec | { http: true }> {
  const file = path.join(root, '.mcp.json');
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const servers = (parsed as { mcpServers?: unknown } | null)?.mcpServers;
  if (typeof servers !== 'object' || servers === null) {
    throw new Error(`${file} has no mcpServers object`);
  }
  const result: Record<string, ServerSpec | { http: true }> = {};
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
      result[name] = { http: true };
    } else {
      throw new Error(`${file}: server "${name}" has neither a command nor type "http"`);
    }
  }
  return result;
}
