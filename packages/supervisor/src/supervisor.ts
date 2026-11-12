import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import type { RunSummary } from '@geldar/scriptorium-verify';
import { summarizeStream } from '@geldar/scriptorium-verify';
import type { Deps, ExecSpec } from './deps.ts';
import { buildPrompt, cleanLastWords } from './prompt.ts';
import type { Settings } from './settings.ts';
import { heldPath, statePath } from './settings.ts';
import {
  acquireLock,
  costToday,
  fmt,
  nextRunNumber,
  readStop,
  releaseLock,
  writeAutoStop,
  writePrivate,
} from './state.ts';
import type { SyncResult } from './upstream.ts';
import { GIT_ENV, hardenedArgs, syncUpstream } from './upstream.ts';

/** The reason written to STOP when the keeper's HELD marker is present. */
export const HELD_REASON = 'the keeper held the history';
/** The first line of the STOP file the supervisor writes while HELD exists. */
const HOLD_STOP = `auto: ${HELD_REASON}`;

const HEARTBEAT_MS = 30_000;
/** How often a held or stopped supervisor checks HELD or STOP again (the heartbeat goes on meanwhile). */
const POLL_SECS = 10;
/** The longest STOP first line kept as `stop_reason` in status.json. */
const STOP_REASON_MAX = 200;
const SAVE_MESSAGE = 'session end: unsaved memory';
const SYSTEM_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

// Environment names from the image and the compose project that the character's CLI needs to
// reach its proxy and keep its image defaults; everything else stays out of the child.
const PASS_THROUGH = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'GELDAR_MCP_TOKEN',
  'GELDAR_MCP_URL',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'no_proxy',
  'DISABLE_AUTOUPDATER',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'ENABLE_CLAUDEAI_MCP_SERVERS',
  'ENABLE_TOOL_SEARCH',
  'CLAUDE_CODE_DISABLE_1M_CONTEXT',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL_FORCE',
];

type Env = Readonly<Record<string, string | undefined>>;

/** The explicit environment of a child: nothing is inherited beyond the names listed here. */
export function childEnv(settings: Settings, env: Env): Record<string, string> {
  const out: Record<string, string> = {
    HOME: settings.cliHome,
    CLAUDE_CONFIG_DIR: settings.cliHome,
    GELDAR_MODE: 'play',
    PATH: env.PATH ?? SYSTEM_PATH,
    GELDAR_RUN_MAX_TURNS: String(settings.maxTurns),
  };
  if (settings.model !== '') out.GELDAR_RUN_MODEL = settings.model;
  for (const name of PASS_THROUGH) {
    const value = env[name];
    if (value !== undefined && value !== '') out[name] = value;
  }
  return out;
}

/** The sh wrapper words (as the launcher's run mode): the prompt is read from descriptor 3, never from an argument. */
export function wrapperLine(settings: Settings): string {
  let line = 'exec claude --autocompact 100000 --settings /etc/geldar/settings/play.json';
  line += ' -p "$(cat <&3)" --max-turns "$GELDAR_RUN_MAX_TURNS"';
  if (settings.model !== '') line += ' --model "$GELDAR_RUN_MODEL"';
  return `${line} --output-format stream-json --verbose`;
}

async function summarizeFile(path: string): Promise<RunSummary | null> {
  if (!existsSync(path)) return null;
  try {
    return await summarizeStream(createReadStream(path, { encoding: 'utf8' }));
  } catch {
    return null;
  }
}

/** The loop: one supervisor keeps one player living. It never logs a token, a prompt or stream text. */
export class Supervisor {
  private stopFlag = false;
  private started = '';
  private upstreamHead = '';
  private upstreamResult: SyncResult = 'none';

  private readonly settings: Settings;
  private readonly deps: Deps;
  private readonly env: Env;

  constructor(settings: Settings, deps: Deps, env: Env = process.env) {
    this.settings = settings;
    this.deps = deps;
    this.env = env;
  }

  /** Ends the loop after the current run (a running child is never killed). */
  requestStop(): void {
    if (!this.stopFlag) this.deps.say('Stopping after the current round.');
    this.stopFlag = true;
  }

  private path(name: string): string {
    return statePath(this.settings, name);
  }

  private log(text: string): void {
    appendFileSync(this.path('supervisor.log'), `${fmt(this.deps.now(), 'stamp')} ${text}\n`, {
      mode: 0o600,
    });
  }

  private status(
    run: number,
    state: string,
    last: string,
    cost: number,
    held?: string,
    stop?: string,
  ): void {
    const body = {
      run,
      state,
      started: this.started,
      last_result: last,
      cost_today: cost,
      upstream_head: this.upstreamHead,
      upstream_result: this.upstreamResult,
      updated: fmt(this.deps.now(), 'stamp'),
      ...(held === undefined ? {} : { held_reason: held }),
      ...(stop === undefined ? {} : { stop_reason: stop }),
    };
    writePrivate(this.path('status.json'), `${JSON.stringify(body)}\n`);
  }

  private beat(): void {
    writePrivate(this.path('heartbeat'), `${fmt(this.deps.now(), 'stamp')}\n`, 0o644);
  }

  private held(): boolean {
    return existsSync(heldPath(this.settings));
  }

  /** The first line of HELD (the keeper's reason), or null when the supervisor cannot read it. */
  private heldReason(): string | null {
    try {
      return readFileSync(heldPath(this.settings), 'utf8').split('\n')[0]?.trim() ?? null;
    } catch {
      return null;
    }
  }

  /** A stop request or any STOP file: a wait ends early and the rounds take the next pass at once. */
  private shouldStop(): boolean {
    return this.stopFlag || readStop(this.settings) !== null;
  }

  private asPlayer(spec: Pick<ExecSpec, 'file' | 'args'> & Partial<ExecSpec>): ExecSpec {
    return {
      uid: this.settings.playerUid,
      gid: this.settings.playerGid,
      env: childEnv(this.settings, this.env),
      cwd: this.settings.workspace,
      ...spec,
    };
  }

  /** The unsaved-memory commit as the player user; a failure is logged and never stops the loop. */
  private async save(): Promise<void> {
    const args = [
      'commit',
      '--root',
      this.settings.workspace,
      '--if-changed',
      '--message',
      SAVE_MESSAGE,
    ];
    const code = await this.deps.exec(this.asPlayer({ file: 'geldar-git', args }));
    if (code !== 0) this.log(`save failed exit=${code}`);
  }

  /** One git call as the player, hardened (see hardenedArgs); its stdout comes back when `capture` is set. */
  private async git(
    args: string[],
    capture: boolean,
    env: Record<string, string> = {},
  ): Promise<{ code: number; out: string }> {
    const out = this.path('upstream.out');
    if (capture) rmSync(out, { force: true });
    const code = await this.deps.exec(
      this.asPlayer({
        file: 'git',
        args: [...hardenedArgs(this.path('no-hooks')), ...args],
        env: { ...childEnv(this.settings, this.env), ...GIT_ENV, ...env },
        ...(capture ? { stdoutPath: out } : {}),
      }),
    );
    return { code, out: capture && existsSync(out) ? readFileSync(out, 'utf8') : '' };
  }

  /**
   * Between runs only: applies the keeper's upstream bundle as the player. A refusal writes the
   * auto STOP and returns false; the next pass of the rounds idles on it and starts no run.
   */
  private async upstream(): Promise<boolean> {
    mkdirSync(this.path('no-hooks'), { recursive: true, mode: 0o700 });
    const report = await syncUpstream(
      this.settings,
      (args, capture, env) => this.git(args, capture, env),
      (text) => this.log(text),
    );
    if (report.head !== null) this.upstreamHead = report.head;
    this.upstreamResult = report.result;
    if (!report.result.startsWith('failed: ')) return true;
    const code = report.result.slice('failed: '.length);
    writeAutoStop(this.settings, `upstream sync: ${code}`);
    this.deps.say(`The supervisor stopped itself: upstream sync: ${code}.`);
    return false;
  }

  /** Runs the loop; resolves to the process exit code. */
  async run(): Promise<number> {
    const s = this.settings;
    mkdirSync(s.stateDir, { recursive: true, mode: 0o700 });
    if (!(await acquireLock(s, this.deps))) {
      this.deps.say(`Another supervisor is already running here (${this.path('lock')}).`);
      return 1;
    }
    try {
      return await this.loop();
    } finally {
      releaseLock(s);
    }
  }

  private async loop(): Promise<number> {
    const s = this.settings;
    // A manual STOP is stale at the start and cleared; one the supervisor wrote itself is not,
    // except the hold STOP, which is cleared here and written again by the rounds if HELD still exists.
    // An auto STOP is kept: the rounds idle on it and start no run.
    const seen = readStop(s);
    if (seen !== null && (seen === HOLD_STOP || !seen.startsWith('auto:'))) {
      rmSync(this.path('STOP'), { force: true });
    }
    this.started = fmt(this.deps.now(), 'stamp');
    this.beat();
    const stopBeat = this.deps.every(HEARTBEAT_MS, () => this.beat());
    try {
      return await this.rounds();
    } finally {
      stopBeat();
    }
  }

  private async rounds(): Promise<number> {
    const s = this.settings;
    let delay = s.delayBase;
    let fails = 0;
    let n = 0;
    let last = 'none';
    this.deps.say('The supervisor started.');
    // Only a stop request ends the loop: a STOP file idles it (see idle) until the owner removes it.
    while (!this.stopFlag) {
      if (this.held()) {
        await this.hold(n, last);
        continue;
      }
      if (readStop(s) !== null) {
        await this.idle(n, last);
        continue;
      }
      const e = this.deps.now();
      const sum = costToday(s.stateDir, fmt(e, 'date'));
      if (sum >= s.dailyCap) {
        const secs = 86400 - (e % 86400);
        this.deps.say(
          `The daily cost cap (${s.dailyCap} USD) is reached; waiting for the next day.`,
        );
        this.log(`cap reached cost=${sum} waiting=${secs}`);
        this.status(n, 'sleeping', last, sum);
        await this.deps.sleep(secs, () => this.shouldStop());
        continue;
      }
      // A refused apply has written the STOP: the next pass idles on it.
      if (!(await this.upstream())) continue;
      n = nextRunNumber(s.stateDir);
      this.status(n, 'running', last, sum);
      const t0 = this.deps.now();
      const code = await this.oneRun(n);
      const t1 = this.deps.now();
      const secs = t1 - t0;
      await this.save();
      writePrivate(this.path('checkpoint-request'), `${n}\n`, 0o644);
      const done = await summarizeFile(this.path(`session-${n}.jsonl`));
      const turns = done?.turns ?? 0;
      const cost = done?.cost ?? 0;
      const ok =
        code === 0 && secs >= s.fastSec && done !== null && !done.is_error && done.result_seen;
      appendFileSync(this.path('costs.csv'), `${n},${fmt(t1, 'stamp')},${turns},${cost}\n`, {
        mode: 0o600,
      });
      if (ok) {
        fails = 0;
        delay = s.delayBase;
        last = 'ok';
      } else {
        fails++;
        delay = Math.min(delay * 2, s.maxDelay);
        last = 'failed';
      }
      const today = costToday(s.stateDir, fmt(t1, 'date'));
      this.log(
        `run=${n} turns=${turns} cost=${cost} secs=${secs} exit=${code} result=${last} delay=${delay} fails=${fails}`,
      );
      this.status(n, 'sleeping', last, today);
      if (fails >= s.maxFails) {
        writeAutoStop(s, `${fails} failed cycles in a row`);
        this.deps.say(`${fails} cycles in a row failed; the supervisor stopped itself.`);
        continue;
      }
      if (this.shouldStop()) continue;
      if (!ok) this.deps.say(`Cycle ${n} failed; waiting ${delay} seconds.`);
      await this.deps.sleep(delay, () => this.shouldStop());
    }
    this.status(
      n,
      'stopped',
      last,
      costToday(s.stateDir, fmt(this.deps.now(), 'date')),
      undefined,
      this.stopReason(),
    );
    this.log('stopped');
    this.deps.say(`The supervisor stopped after run ${n}.`);
    return 0;
  }

  /**
   * While a STOP file exists no run starts. The state is `stopped` with the STOP's first line as
   * `stop_reason`, logged once here; the heartbeat goes on and the file is checked every POLL_SECS.
   * Removing it resumes the rounds; a stop request returns at once.
   */
  private async idle(n: number, last: string): Promise<void> {
    const s = this.settings;
    const reason = this.stopReason() ?? '';
    const cost = costToday(s.stateDir, fmt(this.deps.now(), 'date'));
    this.status(n, 'stopped', last, cost, undefined, reason);
    this.log(`stopped: ${reason}; no run starts until STOP is removed`);
    this.deps.say(`The supervisor is stopped (${this.path('STOP')}): ${reason}. It waits.`);
    while (readStop(s) !== null && !this.stopFlag) {
      await this.deps.sleep(POLL_SECS, () => this.stopFlag);
    }
    if (!this.stopFlag) this.log('STOP removed; resuming');
  }

  /** The first line of STOP (at most STOP_REASON_MAX characters), or undefined when there is none. */
  private stopReason(): string | undefined {
    const seen = readStop(this.settings);
    return seen === null ? undefined : seen.slice(0, STOP_REASON_MAX);
  }

  /**
   * While HELD exists no run starts. Writes the hold STOP and state `held` once, then polls every
   * few seconds (the heartbeat goes on meanwhile). When HELD is gone it clears its own hold STOP
   * only; any other STOP is left for the rounds to idle on, and a stop request returns at once.
   */
  private async hold(n: number, last: string): Promise<void> {
    const s = this.settings;
    writeAutoStop(s, HELD_REASON);
    const cost = costToday(s.stateDir, fmt(this.deps.now(), 'date'));
    this.status(n, 'held', last, cost, this.heldReason() ?? undefined);
    this.log('held by the keeper; no run starts until HELD is removed');
    this.deps.say(`The keeper holds the history; the supervisor waits (${heldPath(s)}).`);
    while (this.held() && !this.stopFlag) {
      await this.deps.sleep(POLL_SECS, () => this.stopFlag);
    }
    if (this.held()) return;
    if (readStop(s) === HOLD_STOP) rmSync(this.path('STOP'), { force: true });
    this.log('hold released');
  }

  /** One headless run as a child of the player user: writes the prompt file, returns the exit code. */
  private async oneRun(n: number): Promise<number> {
    const s = this.settings;
    const prev = n > 1 ? await summarizeFile(this.path(`session-${n - 1}.jsonl`)) : null;
    const words = prev === null ? '' : cleanLastWords(prev.last_text);
    const note = await this.deps.beforeRun({ run: n, lastWords: words });
    const promptPath = this.path('prompt.txt');
    writePrivate(promptPath, buildPrompt(n, words, note));
    return this.deps.exec(
      this.asPlayer({
        file: 'sh',
        args: ['-c', wrapperLine(s)],
        stdoutPath: this.path(`session-${n}.jsonl`),
        promptPath,
      }),
    );
  }
}
