import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// The otel-agent config is read as text (for the literal scans) and parsed with the YAML reader
// (for the structure). Nothing here starts a Collector: the image is validated by the ops agent.
const raw = readFileSync(
  fileURLToPath(new URL('../../image/otel-agent/config.yaml', import.meta.url)),
  'utf8',
);

interface Statements {
  context: string;
  statements: string[];
}

interface Pipeline {
  receivers: string[];
  processors: string[];
  exporters: string[];
}

interface Collector {
  extensions: Record<string, { endpoint: string }>;
  receivers: Record<string, { protocols: Record<string, { max_request_body_size?: number }> }>;
  processors: Record<string, unknown>;
  exporters: {
    otlphttp: {
      endpoint: string;
      headers: Record<string, string>;
      sending_queue: { enabled: boolean; queue_size: number; block_on_overflow?: boolean };
    };
  };
  service: {
    extensions: string[];
    telemetry: { logs: { level: string } };
    pipelines: Record<string, Pipeline>;
  };
}

const config = parse(raw) as Collector;
const otlphttp = config.exporters.otlphttp;
const scrub = config.processors['transform/scrub'] as {
  trace_statements: Statements[];
  log_statements: Statements[];
};

// Turns one scrub statement into a key predicate. OTTL string literals unescape `\\` to `\`.
function scrubRule(statement: string): (key: string) => boolean {
  const match = /^(delete_key|delete_matching_keys)\(attributes, "(.*)"\)$/.exec(statement);
  if (!match) throw new Error(`unexpected scrub statement: ${statement}`);
  const literal = (match[2] ?? '').replace(/\\\\/g, '\\');
  if (match[1] === 'delete_key') return (key) => key === literal;
  const pattern = new RegExp(literal);
  return (key) => pattern.test(key);
}

const scrubRules = [...scrub.trace_statements, ...scrub.log_statements]
  .flatMap((block) => block.statements)
  .map(scrubRule);
const scrubbed = (key: string) => scrubRules.some((rule) => rule(key));

describe('otel-agent collector config', () => {
  it('(a) memory_limiter is the first processor of every pipeline', () => {
    const pipelines = Object.entries(config.service.pipelines);
    expect(pipelines.map(([name]) => name)).toEqual(['traces', 'logs', 'metrics']);
    for (const [, pipeline] of pipelines) {
      expect(pipeline.processors[0]).toBe('memory_limiter');
    }
  });

  it('(b) the exporter endpoint and Authorization header are env placeholders, no literal bearer token', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the expected values are the literal collector placeholders
    expect(otlphttp.endpoint).toBe('https://${env:GELDAR_INGEST_HOST}');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the expected values are the literal collector placeholders
    expect(otlphttp.headers.Authorization).toBe('Bearer ${env:GELDAR_INGEST_TOKEN}');
    expect(raw).not.toMatch(/bearer (?!\$\{env:GELDAR_INGEST_TOKEN\})/i);
  });

  it('(c) only OTLP over HTTP in, only otlphttp out, no debug, logging, file, pprof, zpages or gRPC', () => {
    expect(Object.keys(config.receivers)).toEqual(['otlp']);
    expect(Object.keys(config.receivers.otlp?.protocols ?? {})).toEqual(['http']);
    expect(Object.keys(config.exporters)).toEqual(['otlphttp']);
    expect(Object.keys(config.extensions)).toEqual(['health_check']);
    expect(config.service.extensions).toEqual(['health_check']);
    // The collector's own logs stay at warn, so request bodies and headers are not logged.
    expect(config.service.telemetry.logs.level).toBe('warn');
    expect(raw).not.toMatch(
      /pprof|zpages|grpc|\bdebug\b|\blogging\b|file_storage|docker_stats|hostmetrics/,
    );
  });

  it('(d) the health_check endpoint is bound to loopback', () => {
    expect(config.extensions.health_check?.endpoint).toMatch(/^127\.0\.0\.1:/);
  });

  it('(e) the sending queue is enabled and bounded, and the request body limit stays under 8 MiB', () => {
    expect(otlphttp.sending_queue.enabled).toBe(true);
    expect(otlphttp.sending_queue.queue_size).toBeLessThanOrEqual(500);
    // Overflow drops the item instead of blocking the exporter (R5: the Mind never waits on telemetry).
    expect(otlphttp.sending_queue.block_on_overflow ?? false).toBe(false);
    expect(
      config.receivers.otlp?.protocols.http?.max_request_body_size ?? Infinity,
    ).toBeLessThanOrEqual(8 * 1024 * 1024);
  });

  it('(f) the scrub never matches a geldar.content key, and does match the identity and credential keys', () => {
    const contentNames = [
      'prompt',
      'assistant_text',
      'reasoning',
      'tool_arguments',
      'tool_result',
      'journal',
    ];
    for (const name of contentNames) {
      expect(scrubbed(`geldar.content.${name}`)).toBe(false);
    }
    expect(scrubbed('user.email')).toBe(true);
    expect(scrubbed('enduser.id')).toBe(true);
    expect(scrubbed('http.request.header.authorization')).toBe(true);
    expect(scrubbed('http.request.header.cookie')).toBe(true);
    expect(scrubbed('http.request.header.accept')).toBe(false);
  });

  it('(g) the only IPv4 literals are the loopback and the all-interfaces bind', () => {
    const ips = raw.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
    expect(ips.filter((ip) => ip !== '127.0.0.1' && ip !== '0.0.0.0')).toEqual([]);
  });
});
