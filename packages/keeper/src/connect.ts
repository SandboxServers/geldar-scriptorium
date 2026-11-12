import { connect } from 'node:net';

// The HTTP CONNECT helper used as ssh's ProxyCommand: geldar-keeper-connect <host> <port>.
// It speaks to the proxy named by GELDAR_KEEPER_PROXY (host:port, default proxy-keeper:3128)
// and then copies bytes both ways between its stdio and the tunnel.

const HOST = /^[A-Za-z0-9.-]{1,253}$/;

export function parseProxy(value: string): { host: string; port: number } | null {
  const match = /^([A-Za-z0-9.-]{1,253}):(\d{1,5})$/.exec(value);
  if (match === null) return null;
  const port = Number(match[2]);
  return port >= 1 && port <= 65535 ? { host: match[1] ?? '', port } : null;
}

export function connectRequest(host: string, port: number): string | null {
  if (!HOST.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return `CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`;
}

export function runConnect(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const proxy = parseProxy(env.GELDAR_KEEPER_PROXY ?? 'proxy-keeper:3128');
  const request = connectRequest(argv[0] ?? '', Number(argv[1]));
  if (proxy === null || request === null) return Promise.resolve(2);
  return new Promise((resolve) => {
    const socket = connect(proxy.port, proxy.host);
    let head = Buffer.alloc(0);
    let tunnel = false;
    socket.on('connect', () => socket.write(request));
    socket.on('data', (chunk: Buffer) => {
      if (tunnel) {
        process.stdout.write(chunk);
        return;
      }
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) {
        if (head.length > 8192) socket.destroy();
        return;
      }
      const status = head.subarray(0, head.indexOf('\r\n')).toString('latin1').split(' ')[1];
      if (status !== '200') {
        socket.destroy();
        resolve(1);
        return;
      }
      tunnel = true;
      process.stdin.pipe(socket);
      const rest = head.subarray(end + 4);
      if (rest.length > 0) process.stdout.write(rest);
    });
    socket.on('error', () => resolve(1));
    socket.on('close', () => resolve(tunnel ? 0 : 1));
  });
}
