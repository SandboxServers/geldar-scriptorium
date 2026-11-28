#!/usr/bin/env node
import { realDeps } from './deps.ts';
import { readSettings, SettingError } from './settings.ts';
import { installSignals } from './signals.ts';
import { Supervisor } from './supervisor.ts';

// Exit 0 after a clean stop, 1 when the supervisor stopped itself or cannot start, 2 for a bad setting.
try {
  const supervisor = new Supervisor(readSettings(process.env), realDeps());
  installSignals(process, supervisor);
  const code = await supervisor.run();
  if (code !== 0) process.exitCode = code;
} catch (err) {
  if (!(err instanceof SettingError)) throw err;
  process.stderr.write(`geldar-supervisor: ${err.message}\n`);
  process.exitCode = 2;
}
