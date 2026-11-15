// One waking of the instinct step: read the sheet, connect, observe, decide, send the act, save the store, audit.
// Every outcome is one audit line and one result; an exception becomes pass error with no message or stack.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { check, parseSheet, rngFor, type Score, type Sheet } from '@geldar/scriptorium-psyche';
import { appendAudit, buildAuditLine } from './audit.ts';
import {
  FORCED,
  type InstinctResult,
  MAX_FACTS,
  type PassReason,
  type RollRecord,
  sanitizeFact,
} from './contract.ts';
import { decide, type Fx, type FxContext, type InstinctConfig } from './decide.ts';
import { makeFact } from './facts.ts';
import { observe } from './observe.ts';
import { loadState, PENDING_MAX, saveState } from './state.ts';
import { connectWorld, type WorldLink } from './world.ts';

/** The fx list. HC-19 and later cards add theirs here; HC-18 has none, so only the guards and facts run. */
export const DEFAULT_FXS: readonly Fx[] = [];

export type Env = Record<string, string | undefined>;

export function readConfig(env: Env): InstinctConfig {
  return {
    arm: env.GELDAR_INSTINCT_ARM ?? 'instinct',
    failureCap: Number(env.GELDAR_INSTINCT_FAILURE_CAP ?? 4),
    maxPicks: Number(env.GELDAR_INSTINCT_MAX_PICKS ?? 3),
    thinkP: Number(env.GELDAR_INSTINCT_THINK_P ?? 0.25),
    rolls: (env.GELDAR_INSTINCT_ROLLS ?? 'on') === 'on',
  };
}

/** The life key is the last path segment of the world address (/p/<player_id>). */
export function lifeKeyOf(url: string): string {
  return new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
}

function pass(reason: PassReason, rolls: RollRecord[] = []): InstinctResult {
  return { v: 1, kind: 'pass', reason, forced: FORCED.includes(reason), rolls };
}

/** One waking. `runNo` is the supervisor's run number (the audit's `run`). Never throws. */
export async function runInstinct(
  env: Env,
  runNo: number,
  now = new Date(),
): Promise<InstinctResult> {
  const stateDir = env.GELDAR_INSTINCT_STATE ?? '';
  const auditFile = join(dirname(stateDir), 'instinct.jsonl');
  const cfg = readConfig(env);
  const audit = (result: InstinctResult, waking: number): InstinctResult => {
    appendAudit(
      auditFile,
      buildAuditLine(
        {
          ts: now.toISOString(),
          waking,
          run: runNo,
          arm: cfg.arm,
          harness: env.GELDAR_HARNESS ?? null,
          model: env.GELDAR_RUN_MODEL ?? null,
        },
        result,
      ),
    );
    return result;
  };
  let world: WorldLink | undefined;
  try {
    const sheetFile = join(stateDir, 'sheet.json');
    if (!existsSync(sheetFile)) return audit(pass('no_sheet'), 0);
    const sheet: Sheet | null = parseSheet(readFileSync(sheetFile, 'utf8'));
    if (sheet === null) return audit(pass('sheet_invalid'), 0);
    try {
      world = await connectWorld(env);
    } catch {
      return audit(pass('no_world'), 0);
    }
    return audit(await wake(env, world, stateDir, sheet, cfg), waking(stateDir));
  } catch {
    // No message or stack reaches the audit or the result: only the fixed reason.
    try {
      return audit(pass('error'), waking(stateDir));
    } catch {
      return pass('error');
    }
  } finally {
    await world?.close();
  }
}

/** The waking counter as stored, for the audit line of an early outcome. */
function waking(stateDir: string): number {
  return loadState(stateDir).waking;
}

async function wake(
  env: Env,
  world: WorldLink,
  stateDir: string,
  sheet: Sheet,
  cfg: InstinctConfig,
): Promise<InstinctResult> {
  const state = loadState(stateDir);
  state.waking += 1;
  const obs = await observe(world, state.cursor);
  state.cursor = obs.cursor;
  const lifeKey = lifeKeyOf(env.GELDAR_MCP_URL ?? '');
  const tick = obs.tick ?? state.waking;
  const rolls: RollRecord[] = [];
  const ctx: FxContext = {
    obs,
    sheet,
    state,
    cfg,
    lifeKey,
    tick,
    goal: obs.intent?.goal ?? null,
    knownText: '',
    rolls,
    check(fx: string, score: Score, dc: number, prof = 0) {
      const n = rolls.length;
      const rng = rngFor({
        lifeId: lifeKey,
        producer: 'kit',
        generation: 0,
        tick,
        fx,
        decisionSeq: n,
      });
      const out = check(fx, score, dc, rng, n, lifeKey, tick, { prof, rolls: cfg.rolls });
      rolls.push(out.roll);
      return out;
    },
    draw(fx: string) {
      const n = rolls.length;
      const value = rngFor({
        lifeId: lifeKey,
        producer: 'kit',
        generation: 0,
        tick,
        fx,
        decisionSeq: n,
      }).next();
      rolls.push({
        id: `${lifeKey}:${tick}:${fx}:${n}`,
        fx,
        score: 0,
        dc: 0,
        mode: 'off',
        dice: [],
        kept: null,
        bonus: 0,
        total: value,
        success: false,
      });
      return value;
    },
  };
  const decided = decide(ctx, DEFAULT_FXS);
  let out: InstinctResult = decided;
  if (decided.kind === 'settle') {
    let line: string | null = null;
    try {
      const text = await world.call(decided.act.tool, decided.act.arguments);
      line = text === '' ? null : sanitizeFact(text, 200);
    } catch {
      line = null;
    }
    if (line === null) {
      out = pass('send_failed', decided.rolls);
    } else {
      out = { ...decided, world: { accepted: true, line } };
      state.pending_acts = [sanitizeFact(line, 120), ...state.pending_acts].slice(0, PENDING_MAX);
    }
  } else if (decided.kind === 'pass-with-facts') {
    // Own acts not yet shown to the model go first, then the decision's facts; max 4 in all.
    const own = state.pending_acts
      .map((line) => makeFact('own_act', { line }))
      .filter((f): f is string => f !== null);
    state.pending_acts = [];
    out = { ...decided, facts: [...own, ...decided.facts].slice(0, MAX_FACTS) };
  }
  saveState(stateDir, state);
  return out;
}
