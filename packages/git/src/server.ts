import type { Mode } from '@geldar/scriptorium-path-rule';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CommitRefusal, commitMemory } from './commit.ts';

// The MCP server: one tool, commit_memory. The root folder is never echoed back.
export function createServer(root: string, mode: Mode): McpServer {
  const server = new McpServer({ name: 'geldar-git', version: '0.1.0' });
  server.registerTool(
    'commit_memory',
    {
      description: 'Save your memory files with a short message.',
      inputSchema: { message: z.string().max(500) },
    },
    async ({ message }) => {
      try {
        const result = commitMemory({ root, message, mode });
        const body = {
          saved: result.sha.slice(0, 7),
          files: result.files,
          not_saved: result.notSaved,
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(body) }] };
      } catch (err) {
        const body =
          err instanceof CommitRefusal
            ? { error: err.code, message: err.message }
            : { error: 'git_failed', message: 'The save did not work.' };
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify(body) }],
        };
      }
    },
  );
  return server;
}
