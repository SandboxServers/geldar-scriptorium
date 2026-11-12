import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createExec, type ExecSpec, launchCommand, type SpawnFn } from './deps.ts';

const spec: ExecSpec = {
  file: 'sh',
  args: ['-c', 'echo hi'],
  uid: 1234,
  gid: 4321,
  env: { PATH: '/usr/bin' },
  cwd: '/player',
};

describe('starting a child as the player', () => {
  it('goes through setpriv with every capability set emptied', () => {
    expect(launchCommand(spec)).toEqual({
      file: 'setpriv',
      args: [
        '--reuid=1234',
        '--regid=4321',
        '--clear-groups',
        '--inh-caps=-all',
        '--ambient-caps=-all',
        '--no-new-privs',
        '--',
        'sh',
        '-c',
        'echo hi',
      ],
    });
  });

  it('gives spawn no uid or gid option', async () => {
    const seen: Array<{ file: string; args: readonly string[]; options: Record<string, unknown> }> =
      [];
    const fake = ((file: string, args: readonly string[], options: Record<string, unknown>) => {
      seen.push({ file, args, options });
      const child = new EventEmitter();
      setImmediate(() => child.emit('close', 0));
      return child;
    }) as unknown as SpawnFn;
    expect(await createExec(fake)(spec)).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.file).toBe('setpriv');
    expect(seen[0]?.options).not.toHaveProperty('uid');
    expect(seen[0]?.options).not.toHaveProperty('gid');
    expect(seen[0]?.options.env).toEqual({ PATH: '/usr/bin' });
    expect(seen[0]?.options.cwd).toBe('/player');
  });
});
