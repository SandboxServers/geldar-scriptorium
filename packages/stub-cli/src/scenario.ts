// A scenario is a .jsonl file: one JSON object per line, blank lines ignored.
// The stub runs the steps in order and enforces nothing; see run.ts.

export type Step =
  | {
      op: 'call';
      server: string;
      tool: string;
      args: Record<string, unknown>;
      expect: { error: boolean; includes: string[]; excludes: string[] };
    }
  | { op: 'write'; path: string; content: string }
  | { op: 'append'; path: string; content: string }
  | { op: 'delete'; path: string };

const OP_FIELDS: Record<Step['op'], readonly string[]> = {
  call: ['op', 'server', 'tool', 'args', 'expect'],
  write: ['op', 'path', 'content'],
  append: ['op', 'path', 'content'],
  delete: ['op', 'path'],
};

const EXPECT_FIELDS = ['error', 'includes', 'excludes'];

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function checkFields(obj: Json, allowed: readonly string[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw new Error(`unknown field "${key}"`);
  }
}

function requireString(obj: Json, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`field "${key}" must be a non-empty string`);
  }
  return value;
}

// Rejects absolute paths, '..' components and backslashes (the folder rule is the stub's own).
function checkPath(value: string): string {
  if (value.includes('\\')) throw new Error('path must not contain a backslash');
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error('path must be relative');
  }
  if (value.split('/').includes('..')) throw new Error('path must not contain ".."');
  return value;
}

function parseExpect(value: unknown): Extract<Step, { op: 'call' }>['expect'] {
  const expect = { error: false, includes: [] as string[], excludes: [] as string[] };
  if (value === undefined) return expect;
  if (!isObject(value)) throw new Error('field "expect" must be an object');
  checkFields(value, EXPECT_FIELDS);
  if (value.error !== undefined) {
    if (typeof value.error !== 'boolean') throw new Error('expect.error must be a boolean');
    expect.error = value.error;
  }
  for (const key of ['includes', 'excludes'] as const) {
    if (value[key] !== undefined) {
      if (!isStringList(value[key])) throw new Error(`expect.${key} must be a list of strings`);
      expect[key] = value[key];
    }
  }
  return expect;
}

function parseStep(obj: Json): Step {
  if (typeof obj.op !== 'string') throw new Error('field "op" must be a string');
  if (!Object.hasOwn(OP_FIELDS, obj.op)) throw new Error(`unknown op "${obj.op}"`);
  const op = obj.op as Step['op'];
  checkFields(obj, OP_FIELDS[op]);
  if (op === 'call') {
    const args = obj.args ?? {};
    if (!isObject(args)) throw new Error('field "args" must be an object');
    return {
      op,
      server: requireString(obj, 'server'),
      tool: requireString(obj, 'tool'),
      args,
      expect: parseExpect(obj.expect),
    };
  }
  const path = checkPath(requireString(obj, 'path'));
  if (op === 'delete') return { op, path };
  if (typeof obj.content !== 'string') throw new Error('field "content" must be a string');
  return { op, path, content: obj.content };
}

export function parseScenario(text: string): Step[] {
  const steps: Step[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.trim() === '') return;
    const lineNo = index + 1;
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error('invalid JSON');
      }
      if (!isObject(parsed)) throw new Error('each line must be a JSON object');
      steps.push(parseStep(parsed));
    } catch (error) {
      const problem = error instanceof Error ? error.message : String(error);
      throw new Error(`scenario line ${lineNo}: ${problem}`);
    }
  });
  return steps;
}
