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
const HOLD_POLL_SECS = 10;
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

  private status(run: number, state: string, last: string, cost: number, held?: string): void {
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

  /** A stop ends the loop; the supervisor's own hold STOP does not (the hold keeps it waiting). */
  private shouldStop(): boolean {
    if (this.stopFlag) return true;
    const seen = readStop(this.settings);
    return seen !== null && seen !== HOLD_STOP;
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
  private async git(args: string[], capture: boolean): Promise<{ code: number; out: string }> {
    const out = this.path('upstream.out');
    if (capture) rmSync(out, { force: true });
    const code = await this.deps.exec(
      this.asPlayer({
        file: 'git',
        args: [...hardenedArgs(this.path('no-hooks')), ...args],
        env: { ...childEnv(this.settings, this.env), ...GIT_ENV },
        ...(capture ? { stdoutPath: out } : {}),
      }),
    );
    return { code, out: capture && existsSync(out) ? readFileSync(out, 'utf8') : '' };
  }

  /**
   * Between runs only: applies the keeper's upstream bundle as the player. A refusal writes the
   * auto STOP and returns false, so the loop ends without a run.
   */
  private async upstream(): Promise<boolean> {
    mkdirSync(this.path('no-hooks'), { recursive: true, mode: 0o700 });
    const report = await syncUpstream(
      this.settings,
      (args, capture) => this.git(args, capture),
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
    const seen = readStop(s);
    if (seen?.startsWith('auto:') && seen !== HOLD_STOP) {
      this.deps.say(`The supervisor stopped itself: ${seen.slice(6)} (${this.path('STOP')}).`);
      return 1;
    }
    if (seen !== null) rmSync(this.path('STOP'), { force: true });
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
    let failed = false;
    this.deps.say('The supervisor started.');
    while (!this.shouldStop()) {
      if (this.held()) {
        await this.hold(n, last);
        if (this.shouldStop()) {
          const seen = readStop(s);
          failed = seen?.startsWith('auto:') === true && seen !== HOLD_STOP;
          break;
        }
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
      if (!(await this.upstream())) {
        failed = true;
        break;
      }
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
        failed = true;
        break;
      }
      if (this.shouldStop()) break;
      if (!ok) this.deps.say(`Cycle ${n} failed; waiting ${delay} seconds.`);
      await this.deps.sleep(delay, () => this.shouldStop());
    }
    this.status(n, 'stopped', last, costToday(s.stateDir, fmt(this.deps.now(), 'date')));
    this.log('stopped');
    this.deps.say(`The supervisor stopped after run ${n}.`);
    return failed ? 1 : 0;
  }

  /**
   * While HELD exists no run starts. Writes the hold STOP and state `held` once, then polls every
   * few seconds (the heartbeat goes on meanwhile). When HELD is gone it clears its own hold STOP
   * only; any other STOP, or a stop request, returns at once with that STOP still in place.
   */
  private async hold(n: number, last: string): Promise<void> {
    const s = this.settings;
    writeAutoStop(s, HELD_REASON);
    const cost = costToday(s.stateDir, fmt(this.deps.now(), 'date'));
    this.status(n, 'held', last, cost, this.heldReason() ?? undefined);
    this.log('held by the keeper; no run starts until HELD is removed');
    this.deps.say(`The keeper holds the history; the supervisor waits (${heldPath(s)}).`);
    while (this.held() && !this.shouldStop()) {
      await this.deps.sleep(HOLD_POLL_SECS, () => this.shouldStop());
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
