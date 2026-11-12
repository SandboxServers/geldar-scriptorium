// No Docker here: the compose file and the proxy files are read as text.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './docker.ts';

const read = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8');
const compose = read('image/compose/player.yml');
const services = ['player', 'proxy-player', 'keeper', 'proxy-keeper'] as const;
type Service = (typeof services)[number];
const kitServices: Service[] = ['player', 'keeper'];

// A service's block: from its key to the next two-space key or top-level key.
function block(name: string): string {
  const match = new RegExp(`^ {2}${name}:\\n([\\s\\S]*?)(?=^ {2}\\S|^\\S)`, 'm').exec(compose);
  return match?.[1] ?? '';
}

// The top-level section `name` (volumes, networks, secrets).
function section(name: string): string {
  return new RegExp(`^${name}:\\n([\\s\\S]*?)(?=^\\S|$(?![\\s\\S]))`, 'm').exec(compose)?.[1] ?? '';
}

// The scalar value of a four-space key in a service, or undefined.
function value(service: Service, key: string): string | undefined {
  return new RegExp(`^ {4}${key}: (.*)$`, 'm').exec(block(service))?.[1];
}

// The dash items under a four-space key (block list), comments and blank lines skipped.
function items(service: Service, key: string): string[] {
  const body = new RegExp(`^ {4}${key}:\\n((?: {6}.*\\n)+)`, 'm').exec(block(service))?.[1] ?? '';
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2));
}

// The names of the environment entries (the part before "=" for a KEY=value entry).
function envNames(service: Service): string[] {
  return items(service, 'environment').map((e) => e.split('=')[0] as string);
}

function networks(service: Service): string[] {
  return (/^ {4}networks: \[(.*)\]$/m.exec(block(service))?.[1] ?? '').split(', ').filter(Boolean);
}

describe('player compose: hardening on every service', () => {
  for (const name of services) {
    describe(name, () => {
      it('drops every capability first and keeps no-new-privileges', () => {
        expect(value(name, 'cap_drop')).toBe('[ALL]');
        expect(value(name, 'security_opt')).toBe('[no-new-privileges:true]');
      });
      it('has a read-only root filesystem with an explicit tmpfs for /tmp', () => {
        expect(value(name, 'read_only')).toBe('true');
        expect(items(name, 'tmpfs').some((t) => t === '/tmp' || t.startsWith('/tmp:'))).toBe(true);
      });
      it('has cpu, memory and pids limits and a restart policy', () => {
        expect(value(name, 'cpus')).toMatch(/^\d+(\.\d+)?$/);
        expect(value(name, 'mem_limit')).toMatch(/^\d+[mg]$/);
        expect(value(name, 'pids_limit')).toMatch(/^\d+$/);
        expect(value(name, 'restart')).toBe('unless-stopped');
      });
      it('publishes no port, is not privileged, has no socket and no host network', () => {
        const text = block(name);
        expect(text).not.toMatch(/^ {4}ports:/m);
        expect(text).not.toMatch(/^ {4}privileged:/m);
        expect(text).not.toMatch(/^ {4}network_mode:/m);
        expect(text).not.toMatch(/docker\.sock/);
        expect(text).not.toMatch(/\b(pid|ipc|userns_mode|cgroup): host/);
      });
      it('adds back only capabilities its job needs', () => {
        const added = (value(name, 'cap_add') ?? '[]').slice(1, -1).split(', ').filter(Boolean);
        const allowed = kitServices.includes(name as Service)
          ? ['CHOWN', 'FOWNER', 'FSETID', 'SETUID', 'SETGID', 'SETPCAP']
          : ['SETUID', 'SETGID'];
        expect(added.sort()).toEqual(allowed.sort());
      });
    });
  }

  it('the whole file has no ports, privileged, socket or host network', () => {
    expect(compose).not.toMatch(/^\s*ports:/m);
    expect(compose).not.toMatch(/privileged:\s*true/);
    expect(compose).not.toMatch(/docker\.sock/);
    expect(compose).not.toMatch(/network_mode/);
  });

  it('the kit services start as root only to drop to their user in the entrypoint', () => {
    const entrypoints = {
      player: ['/usr/local/bin/geldar-player-entrypoint', 'image/geldar-player-entrypoint.sh'],
      keeper: ['/usr/local/bin/geldar-keeper-entrypoint', 'image/geldar-keeper-entrypoint.sh'],
    } as const;
    for (const name of kitServices) {
      const [target, file] = entrypoints[name as 'player' | 'keeper'];
      expect(value(name, 'entrypoint')).toBe(`["${target}"]`);
      expect(value(name, 'user')).toBe('"0:0"');
      const script = read(file);
      expect(script).toMatch(/--no-new-privs/);
      expect(script).toMatch(/--reuid=100[12]/);
      expect(script).toMatch(/--bounding-set=-all/);
    }
    // The keeper keeps no capability after the drop; the supervisor keeps only the two it needs.
    expect(read('image/geldar-keeper-entrypoint.sh')).not.toMatch(/ambient|inh-caps/);
    expect(read('image/geldar-player-entrypoint.sh')).toMatch(/--ambient-caps=\+setuid,\+setgid/);
    expect(read('image/geldar-player-entrypoint.sh')).toMatch(/geldar-supervisor/);
    expect(read('image/geldar-keeper-entrypoint.sh')).toMatch(/geldar-keeper/);
  });

  it('player and keeper have a healthcheck; the proxies wait for health', () => {
    expect(block('player')).toMatch(/\/state\/supervisor\/heartbeat\) \)\) -le 120'/);
    expect(block('keeper')).toMatch(
      /\/keeper-state\/status\.json\) \)\) -le \$\$\(\( 3 \* GELDAR_KEEPER_INTERVAL/,
    );
    expect(block('player')).toMatch(/proxy-player:\n\s+condition: service_healthy/);
    expect(block('keeper')).toMatch(/proxy-keeper:\n\s+condition: service_healthy/);
    for (const name of services) expect(block(name)).toMatch(/^ {4}healthcheck:/m);
  });
});

describe('player compose: separation between the two sides', () => {
  it('networks: inside is player and proxy-player, keeper-net is keeper and proxy-keeper', () => {
    expect(networks('player')).toEqual(['inside']);
    expect(networks('keeper')).toEqual(['keeper-net']);
    expect(networks('proxy-player')).toEqual(['inside', 'outside']);
    expect(networks('proxy-keeper')).toEqual(['keeper-net', 'outside']);
    expect(section('networks')).toMatch(/inside:\n {4}internal: true/);
    expect(section('networks')).toMatch(/keeper-net:\n {4}internal: true/);
    expect(section('networks')).not.toMatch(/outside:\n {4}internal/);
  });

  it('the deploy key secret is mounted in keeper only', () => {
    expect(block('keeper')).toMatch(
      /^ {4}secrets:\n {6}- source: deploy_key\n {8}target: deploy_key$/m,
    );
    for (const name of services.filter((s) => s !== 'keeper')) {
      expect(block(name), name).not.toMatch(/secrets:/);
      expect(block(name), name).not.toMatch(/deploy_key/);
    }
    expect(section('secrets')).toMatch(/deploy_key:\n {4}file: \$\{GELDAR_DEPLOY_KEY_FILE:\?\}/);
  });

  it('player has no keeper-net, no secret and no clone volume', () => {
    const player = block('player');
    expect(networks('player')).not.toContain('keeper-net');
    expect(player).not.toMatch(/secrets|deploy_key|clone|keeper-net/);
  });

  it('keeper has no inside network and no Claude, MCP or player-side proxy variable', () => {
    expect(networks('keeper')).not.toContain('inside');
    const names = envNames('keeper');
    expect(
      names.filter((n) => /^CLAUDE|MCP|^ANTHROPIC|PROXY$/i.test(n) && n !== 'GELDAR_KEEPER_PROXY'),
    ).toEqual([]);
    expect(names).not.toContain('GELDAR_MCP_TOKEN');
    expect(block('keeper')).not.toMatch(/CLAUDE_|GELDAR_MCP_TOKEN|inside|cli-home|proxy-player/);
  });

  it('volumes: mounts and read-only flags follow the contract', () => {
    expect(items('player', 'volumes')).toEqual([
      'workspace:/player',
      'cli-home:/cli-home',
      'supervisor-state:/state/supervisor',
      'keeper-state:/keeper-state:ro',
    ]);
    expect(items('keeper', 'volumes')).toEqual([
      'workspace:/workspace:ro',
      'supervisor-state:/supervisor-state:ro',
      'keeper-state:/keeper-state',
      'clone:/clone',
    ]);
    for (const name of ['proxy-player', 'proxy-keeper'] as const) {
      expect(
        items(name, 'volumes').every((v) => v.startsWith('../proxy/') || v.startsWith('${')),
        name,
      ).toBe(true);
      expect(
        items(name, 'volumes').every((v) => v.endsWith(':ro')),
        name,
      ).toBe(true);
    }
  });

  it('volume names carry the player id', () => {
    const volumes = section('volumes');
    for (const [key, name] of [
      ['workspace', 'geldar-ws-'],
      ['cli-home', 'geldar-cli-'],
      ['supervisor-state', 'geldar-sup-'],
      ['keeper-state', 'geldar-keep-'],
      ['clone', 'geldar-clone-'],
    ]) {
      expect(volumes).toContain(`${key}:\n    name: ${name}\${GELDAR_ID:?}`);
    }
  });
});

describe('player compose: environment contract', () => {
  it('player gets the name-only secrets, the mode, the run names and the keeper state path', () => {
    const lines = items('player', 'environment');
    for (const bare of ['GELDAR_MCP_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'])
      expect(lines).toContain(bare);
    // The world address the .mcp.json reads (without it no world tool loads in the session).
    expect(lines).toContain('GELDAR_MCP_URL=${GELDAR_MCP_URL:?}');
    expect(lines).toContain('GELDAR_MODE=play');
    expect(lines).toContain('GELDAR_KEEPER_STATE=/keeper-state');
    const run = lines.filter((l) => l.startsWith('GELDAR_RUN_'));
    expect(run).toEqual(
      [
        'DAILY_CAP_USD',
        'DELAY',
        'FAST_SEC',
        'MAX_DELAY',
        'MAX_FAILS',
        'MAX_TURNS',
        'MODEL',
        'SLEEP',
      ].map((n) => `GELDAR_RUN_${n}`),
    );
    // No value is ever written for a secret.
    expect(block('player')).not.toMatch(/(TOKEN|OAUTH_TOKEN)=/);
    // Egress goes through proxy-player, in lowercase as well.
    for (const v of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) {
      expect(lines).toContain(`${v}=http://proxy-player:3128`);
    }
  });

  it('keeper gets exactly the keeper variables', () => {
    expect(envNames('keeper').sort()).toEqual(
      [
        'HOME',
        'GELDAR_KEEPER_REMOTE',
        'GELDAR_KEEPER_KEY',
        'GELDAR_KEEPER_PLAYER_ID',
        'GELDAR_KEEPER_INTERVAL',
        'GELDAR_KEEPER_WORKSPACE',
        'GELDAR_KEEPER_CLONE',
        'GELDAR_KEEPER_STATE',
        'GELDAR_KEEPER_SUPERVISOR_STATE',
        'GELDAR_KEEPER_PROXY',
      ].sort(),
    );
    const lines = items('keeper', 'environment');
    for (const want of [
      'GELDAR_KEEPER_KEY=/run/secrets/deploy_key',
      'GELDAR_KEEPER_WORKSPACE=/workspace',
      'GELDAR_KEEPER_CLONE=/clone',
      'GELDAR_KEEPER_STATE=/keeper-state',
      'GELDAR_KEEPER_SUPERVISOR_STATE=/supervisor-state',
      'GELDAR_KEEPER_PROXY=proxy-keeper:3128',
      'GELDAR_KEEPER_PLAYER_ID=${GELDAR_ID:?}',
    ]) {
      expect(lines).toContain(want);
    }
  });
});

describe('player compose: the proxies', () => {
  const active = (text: string) =>
    text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));

  it('the proxy-keeper allowlist is exactly ssh.github.com', () => {
    expect(active(read('image/proxy/allowlist-keeper.txt'))).toEqual(['ssh.github.com']);
  });

  it('the proxy-keeper config allows CONNECT ssh.github.com:443 and nothing else', () => {
    const conf = active(read('image/proxy/squid-keeper.conf'));
    expect(conf.filter((l) => l.startsWith('http_access'))).toEqual([
      'http_access allow CONNECT allowed_keeper keeper_port',
      'http_access deny all',
    ]);
    expect(conf).toContain('acl keeper_port port 443');
    expect(conf).toContain('acl CONNECT method CONNECT');
    expect(conf).toContain('acl allowed_keeper dstdomain "/etc/squid/allowlist-keeper.txt"');
    expect(conf.filter((l) => l.startsWith('acl')).length).toBe(3);
  });

  it('proxy-player uses the same config and allowlists as the session project', () => {
    const session = read('image/compose/session.yml');
    for (const mount of [
      '../proxy/squid.conf:/etc/squid/squid.conf:ro',
      '../proxy/allowlist-vendor.txt:/etc/squid/allowlist-vendor.txt:ro',
      '${GELDAR_WORLD_ALLOWLIST:?}:/etc/squid/allowlist-world.txt:ro',
      '${GELDAR_WORLD_PORTS:-../proxy/world-ports-default.txt}:/etc/squid/allowlist-world-ports.txt:ro',
    ]) {
      expect(session).toContain(mount);
      expect(items('proxy-player', 'volumes')).toContain(mount);
    }
    expect(items('proxy-keeper', 'volumes')).toEqual([
      '../proxy/squid-keeper.conf:/etc/squid/squid.conf:ro',
      '../proxy/allowlist-keeper.txt:/etc/squid/allowlist-keeper.txt:ro',
    ]);
  });
});
