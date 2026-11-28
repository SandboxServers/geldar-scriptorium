import { describe, expect, it } from 'vitest';
import { buildKit, dockerReady, KIT_IMAGE, run } from './docker.ts';

describe.skipIf(!dockerReady())('ChatGPT runtime in the released image', () => {
  it('loads the actual adapter and dependencies with no network or account', () => {
    buildKit();
    const result = run([
      'run',
      '--rm',
      '--network',
      'none',
      '--entrypoint',
      'geldar-chatgpt',
      KIT_IMAGE,
      'status',
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('chatgpt-login');
    expect(result.stderr).not.toMatch(/MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/);
  });
  it('uses the allowlist proxy for subscription HTTP requests with no external network or real token', () => {
    const script = `
      import { createServer } from 'node:net';
      import { spawn } from 'node:child_process';
      import { AuthStore, PLAN_SCOPE } from '/opt/geldar/packages/chatgpt/src/auth.ts';
      const store = new AuthStore('/cli-home');
      store.write('registration.json', { host: 'urn:uuid:fixture', client: 'oaiapp_fixture', subject: 'fixture' });
      store.write('credentials.json', { client: 'oaiapp_fixture', subject: 'fixture', access: 'test-access', refresh: 'test-refresh', id: 'test-id', scopes: [PLAN_SCOPE], expires: Date.now() + 3600000 });
      let connected = false;
      const proxy = createServer((socket) => socket.once('data', (data) => {
        connected = data.toString().startsWith('CONNECT api.openai.com:443 ');
        socket.end('HTTP/1.1 403 Forbidden\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n');
      }));
      const timeout = setTimeout(() => { process.exitCode = 2; proxy.close(); }, 10000);
      proxy.listen(0, '127.0.0.1', () => {
        const child = spawn('/usr/local/bin/geldar-chatgpt', ['models'], {
          env: { PATH: '/usr/local/bin:/usr/bin:/bin', HTTPS_PROXY: 'http://127.0.0.1:' + proxy.address().port, NO_PROXY: '' }, stdio: 'ignore'
        });
        child.on('close', (code) => {
          clearTimeout(timeout); proxy.close();
          if (!connected || code !== 1) process.exitCode = 1;
          else process.stdout.write('proxied subscription request');
        });
      });
    `;
    const result = run([
      'run',
      '--rm',
      '--network',
      'none',
      '--entrypoint',
      'node',
      KIT_IMAGE,
      '--input-type=module',
      '-e',
      script,
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('proxied subscription request');
  });
});
