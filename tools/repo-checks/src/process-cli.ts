/** Entry for scriptorium.ps1: merge-packet, push-verified, ledger set. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setLedgerStatus } from './ledger.ts';
import { mergePacket, pushVerified } from './merge-packet.ts';

const [cmd, ...args] = process.argv.slice(2);
const run = (command: string, a: string[]) =>
  spawnSync(command, a, { stdio: 'inherit' }).status === 0;
const pwsh = process.platform === 'win32' ? 'pwsh.exe' : 'pwsh';
const script = (...a: string[]) => run(pwsh, ['-NoProfile', '-File', './scriptorium.ps1', ...a]);

try {
  if (cmd === 'merge-packet' && args[0]) {
    mergePacket(process.cwd(), args[0], {
      runCheck: () => script('check'),
      runInstall: () => script('pnpm', 'install', '--no-frozen-lockfile'),
      log: (m) => console.log(m),
    });
  } else if (cmd === 'push-verified') {
    console.log(`pushed and verified at ${pushVerified(process.cwd())}`);
  } else if (cmd === 'ledger' && args[0] === 'set' && args[1] && args[2]) {
    const file = 'docs/analysis/scriptorium/README.md';
    const status = args.slice(2).join(' ');
    writeFileSync(file, setLedgerStatus(readFileSync(file, 'utf8'), args[1], status));
    console.log(`${args[1]} -> ${status}`);
  } else {
    throw new Error('usage: merge-packet <branch> | push-verified | ledger set SC-NN <status>');
  }
} catch (error) {
  console.error(`error: ${(error as Error).message}`);
  process.exitCode = 1;
}
