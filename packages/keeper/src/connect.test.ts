import { createServer } from 'node:net';
import { expect, test } from 'vitest';
import { connectRequest, parseProxy } from './connect.ts';

test('the CONNECT request names the host and port', () => {
  expect(connectRequest('ssh.github.com', 443)).toBe(
    'CONNECT ssh.github.com:443 HTTP/1.1\r\nHost: ssh.github.com:443\r\n\r\n',
  );
});

test('a host that could smuggle a header is refused', () => {
  expect(connectRequest('a.com\r\nX: y', 443)).toBeNull();
  expect(connectRequest('a.com', 0)).toBeNull();
  expect(connectRequest('', 22)).toBeNull();
});

test('the proxy setting is host:port', () => {
  expect(parseProxy('proxy-keeper:3128')).toEqual({ host: 'proxy-keeper', port: 3128 });
  expect(parseProxy('proxy-keeper')).toBeNull();
  expect(parseProxy('proxy:99999')).toBeNull();
});

test('the helper sends CONNECT to the proxy and ends non-zero on a refusal', async () => {
  const received: string[] = [];
  const server = createServer((socket) => {
    socket.once('data', (chunk) => {
      received.push(chunk.toString('latin1'));
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const { runConnect } = await import('./connect.ts');
  const code = await runConnect(['ssh.github.com', '443'], {
    GELDAR_KEEPER_PROXY: `127.0.0.1:${port}`,
  });
  server.close();
  expect(code).toBe(1);
  expect(received[0]).toContain('CONNECT ssh.github.com:443');
});
