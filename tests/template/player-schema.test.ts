import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './check.ts';

const schema: unknown = JSON.parse(
  readFileSync(path.join(repoRoot, 'schemas/player.schema.json'), 'utf8'),
);
const validate = new Ajv2020({ allErrors: true }).compile(schema as object);

// A player.json as `new` writes it: every field present, the harness chosen per case.
const base = {
  player_id: 'example-player',
  name: 'Example',
  shard: 'example',
  mcp_url: 'https://example.invalid/mcp',
  kit_version: '1.0.0',
  kit_image: `ghcr.io/example/kit@sha256:${'0'.repeat(64)}`,
};

describe('player.json schema: the harness values', () => {
  it('accepts claude, chatgpt and local documents, with and without the local fields', () => {
    const documents = [
      { ...base, harness: 'claude', declared_model: 'haiku' },
      { ...base, harness: 'chatgpt', declared_model: 'gpt-model' },
      { ...base, harness: 'local', declared_model: 'local-model' },
      {
        ...base,
        harness: 'local',
        declared_model: 'local-model',
        context_tokens: 8192,
        images: false,
      },
    ];
    for (const document of documents) {
      expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it('refuses an unknown harness and a context below 1024', () => {
    expect(validate({ ...base, harness: 'other', declared_model: 'm' })).toBe(false);
    expect(validate({ ...base, harness: 'local', declared_model: 'm', context_tokens: 10 })).toBe(
      false,
    );
    expect(validate({ ...base, harness: 'local', declared_model: 'm', images: 'yes' })).toBe(false);
  });
});
