import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';

/** One child process the supervisor starts (a run, or the save step). */
export interface ExecSpec {
  file: string;
  args: string[];
  uid: number;
  gid: number;
  /** The whole environment of the child: nothing else is inherited. */
  env: Record<string, string>;
  cwd: string;
  /** The child's stdout goes to this file (created 0600); otherwise it is discarded. */
  stdoutPath?: string;
  /** This file is the child's file descriptor 3 (the prompt, read by the sh wrapper). */
  promptPath?: string;
}

/** The director hook (wave 12 plugs in): may return a note for the prompt, or null. */
export interface RunContext {
  run: number;
  lastWords: string;
}

/** Everything the loop touches outside its own state files, so tests need no docker or real time. */
export interface Deps {
  /** The current time in seconds since the epoch. */
  now(): number;
  /** Waits up to `seconds`; returns early once `wake()` is true. */
  sleep(seconds: number, wake: () => boolean): Promise<void>;
  /** Runs one child to the end and returns its exit code (1 when it cannot start). */
  exec(spec: ExecSpec): Promise<number>;
  /** Calls `fn` every `ms` until the returned function is called. */
  every(ms: number, fn: () => void): () => void;
  /** True when a process with this pid exists. */
  alive(pid: number): boolean;
  /** One line for the person who started the supervisor (stderr). */
  say(line: string): void;
  /** The pid of this process (written to the lock). */
  pid: number;
  /** The director hook; a no-op returning null until wave 12. */
  beforeRun(context: RunContext): Promise<string | null>;
}

/** The no-op director hook. */
export async function noDirector(_context: RunContext): Promise<string | null> {
  return null;
}

function realSleep(seconds: number, wake: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    let left = seconds;
    const tick = (): void => {
      if (left <= 0 || wake()) {
        resolve();
        return;
      }
      const step = Math.min(left, 1);
      left -= step;
      setTimeout(tick, step * 1000);
    };
    tick();
  });
}

/**
 * The command that starts a child as the player. spawn's uid/gid options would keep the
 * supervisor's ambient SETUID/SETGID across exec, so setpriv drops the user, groups and every
 * capability set instead (the child ends with an empty capability set and no new privileges). The
 * bounding set is left alone: shrinking it needs SETPCAP, which the supervisor does not hold, and with
 * inheritable and ambient emptied and no new privileges the exec leaves the child no permitted caps.
 */
export function launchCommand(spec: ExecSpec): { file: string; args: string[] } {
  return {
    file: 'setpriv',
    args: [
      `--reuid=${spec.uid}`,
      `--regid=${spec.gid}`,
      '--clear-groups',
      '--inh-caps=-all',
      '--ambient-caps=-all',
      '--no-new-privs',
      '--',
      spec.file,
      ...spec.args,
    ],
  };
}

/** A process starter shaped like node's spawn (a seam for tests). */
export type SpawnFn = typeof spawn;

/** Builds the exec dependency over a spawn function. */
export function createExec(spawnFn: SpawnFn): (spec: ExecSpec) => Promise<number> {
  return (spec) =>
    new Promise((resolve) => {
      const fds: number[] = [];
      const finish = (code: number): void => {
        for (const fd of fds) closeSync(fd);
        fds.length = 0;
        resolve(code);
      };
      try {
        const out =
          spec.stdoutPath === undefined ? 'ignore' : openSync(spec.stdoutPath, 'w', 0o600);
        if (typeof out === 'number') fds.push(out);
        const prompt = spec.promptPath === undefined ? 'ignore' : openSync(spec.promptPath, 'r');
        if (typeof prompt === 'number') fds.push(prompt);
        const launch = launchCommand(spec);
        const child = spawnFn(launch.file, launch.args, {
          env: spec.env,
          cwd: spec.cwd,
          stdio: ['ignore', out, 'ignore', prompt],
        });
        child.once('error', () => finish(1));
        child.once('close', (code) => finish(code ?? 1));
      } catch {
        finish(1);
      }
    });
}

const realExec = createExec(spawn);

/** The real dependencies. */
export function realDeps(): Deps {
  return {
    now: () => Math.floor(Date.now() / 1000),
    sleep: realSleep,
    exec: realExec,
    every: (ms, fn) => {
      const timer = setInterval(fn, ms);
      timer.unref();
      return () => clearInterval(timer);
    },
    alive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'EPERM';
      }
    },
    say: (line) => {
      process.stderr.write(`${line}\n`);
    },
    pid: process.pid,
    beforeRun: noDirector,
  };
}
