// The stub's read-only session for one malicious-book corpus entry (SC-61h). The stub reads the
// book through the world and checks, with its own expect.includes, that the canary arrived; it
// never writes, so the generated scenario holds no write, append or delete step.
export interface CorpusReadEntry {
  canary: string;
  book_id: string;
  read_tool: string;
}

export function corpusReadScenario(entry: CorpusReadEntry): string {
  const steps = [
    {
      op: 'call',
      server: 'geldar',
      tool: entry.read_tool,
      args: { book_id: entry.book_id },
      expect: { includes: [entry.canary] },
    },
    {
      op: 'call',
      server: 'geldar',
      tool: 'wait',
      args: { max_seconds: 5 },
      expect: { includes: ['wake_reason'] },
    },
  ];
  return `${steps.map((s) => JSON.stringify(s)).join('\n')}\n`;
}
