import { describe, expect, it } from 'vitest';
import type { Tool } from './types.ts';
import { compileTools } from './validate.ts';

/** A tool with the given parameter schema; its call is never used here. */
function tool(name: string, parameters: Record<string, unknown>): Tool {
  return { name, description: 'test', parameters, call: async () => [] };
}

const strict = tool('strict', {
  type: 'object',
  properties: { word: { type: 'string' } },
  required: ['word'],
  additionalProperties: false,
});

describe('compileTools', () => {
  const check = compileTools([strict]);

  it('reports a missing required property', () => {
    expect(check('strict', {})).toContain("must have required property 'word'");
  });

  it('reports a wrong type with the property path', () => {
    expect(check('strict', { word: 3 })).toMatch(/^\/word must be string$/);
  });

  it('reports an extra property when additionalProperties is false', () => {
    expect(check('strict', { word: 'a', extra: 1 })).toContain(
      'must NOT have additional properties',
    );
  });

  it('passes a valid call', () => {
    expect(check('strict', { word: 'a' })).toBeNull();
  });

  it('compiles a 2020-12 schema with $defs', () => {
    const modern = tool('modern', {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: { name: { type: 'string', minLength: 1 } },
      type: 'object',
      properties: { name: { $ref: '#/$defs/name' } },
      required: ['name'],
    });
    const checkModern = compileTools([modern]);
    expect(checkModern('modern', { name: 'x' })).toBeNull();
    expect(checkModern('modern', { name: '' })).toContain('/name');
  });

  it('falls back to passing a tool whose schema does not compile', () => {
    const broken = tool('broken', { type: 'not-a-type' });
    expect(compileTools([broken])('broken', { anything: 1 })).toBeNull();
  });

  it('keeps every message to 300 characters or fewer', () => {
    const long = tool('long', {
      type: 'object',
      properties: { value: { type: 'number', minimum: 1, description: 'x'.repeat(10) } },
      required: ['k'.repeat(400)],
    });
    const message = compileTools([long])('long', { value: 1 });
    expect(message).not.toBeNull();
    expect((message ?? '').length).toBeLessThanOrEqual(300);
  });
});
