/** The one-line report `geldar-verify run-summary` prints for a headless stream. */
export interface RunSummary {
  cost: number;
  turns: number;
  is_error: boolean;
  last_text: string;
  result_seen: boolean;
  tools: Record<string, number>;
}

export const LAST_TEXT_MAX = 1500;

// C0 controls other than space (space is 0x20, outside the range) and DEL.
function isControl(code: number): boolean {
  return code < 0x20 || code === 0x7f;
}

function stripControls(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (!isControl(text.charCodeAt(i))) out += text[i];
  }
  return out;
}

/** Strips control characters, trims, and cuts to LAST_TEXT_MAX characters without splitting a surrogate pair. */
export function cleanText(text: string): string {
  const clean = stripControls(text).trim();
  if (clean.length <= LAST_TEXT_MAX) return clean;
  const end = clean.charCodeAt(LAST_TEXT_MAX - 1);
  const splits = end >= 0xd800 && end <= 0xdbff;
  return clean.slice(0, splits ? LAST_TEXT_MAX - 1 : LAST_TEXT_MAX);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Folds a stream-json transcript, one line at a time, into a RunSummary. */
export class RunSummaryBuilder {
  private result: Record<string, unknown> | null = null;
  private lastText = '';
  private readonly tools: Record<string, number> = Object.create(null) as Record<string, number>;

  /** Feeds one line; lines that are not JSON objects are skipped. */
  addLine(line: string): void {
    if (line.trim() === '') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(parsed)) return;
    if (parsed.type === 'result') this.result = parsed;
    if (parsed.type !== 'assistant' || !isRecord(parsed.message)) return;
    const content = parsed.message.content;
    if (!Array.isArray(content)) return;
    for (const entry of content) {
      if (!isRecord(entry)) continue;
      if (entry.type === 'text' && typeof entry.text === 'string') {
        this.lastText = entry.text;
      } else if (entry.type === 'tool_use' && typeof entry.name === 'string') {
        this.tools[entry.name] = (this.tools[entry.name] ?? 0) + 1;
      }
    }
  }

  summary(): RunSummary {
    const r = this.result;
    const cost = r !== null && typeof r.total_cost_usd === 'number' ? r.total_cost_usd : 0;
    const turns = r !== null && Number.isInteger(r.num_turns) ? (r.num_turns as number) : 0;
    return {
      cost: Number.isFinite(cost) ? cost : 0,
      turns,
      is_error: r === null ? true : r.is_error === true,
      last_text: cleanText(this.lastText),
      result_seen: r !== null,
      tools: this.tools,
    };
  }
}

/** Reads text chunks (any split points) and returns the summary. Holds one partial line at a time. */
export async function summarizeStream(chunks: AsyncIterable<string>): Promise<RunSummary> {
  const builder = new RunSummaryBuilder();
  let rest = '';
  for await (const chunk of chunks) {
    const parts = (rest + chunk).split('\n');
    rest = parts.pop() ?? '';
    for (const part of parts) builder.addLine(part);
  }
  builder.addLine(rest);
  return builder.summary();
}
