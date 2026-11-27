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
} from './contract.ts';
import { decide, type Fx, type FxContext, type InstinctConfig } from './decide.ts';
import { makeFact } from './facts.ts';
import { readAdoptedGoal } from './fx/goal.ts';
import { observe } from './observe.ts';
import { loadState, PENDING_MAX, saveState } from './state.ts';
import { connectWorld, type WorldLink } from './world.ts';

/** The fx list. HC-19 and later cards add theirs here; HC-18 has none, so only the guards and facts run. */
export const DEFAULT_FXS: readonly Fx[] = [];

export type Env = Record<string, string | undefined>;

/** A numeric env value, or the fallback when the value is missing, blank or not a finite number (never NaN). */
function numEnv(value: string | undefined, fallback: number): number {
  const n = value === undefined || value.trim() === '' ? Number.NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function readConfig(env: Env): InstinctConfig {
  return {
    arm: env.GELDAR_INSTINCT_ARM ?? 'instinct',
    failureCap: numEnv(env.GELDAR_INSTINCT_FAILURE_CAP, 4),
    maxPicks: numEnv(env.GELDAR_INSTINCT_MAX_PICKS, 3),
    thinkP: numEnv(env.GELDAR_INSTINCT_THINK_P, 0.25),
    rolls: (env.GELDAR_INSTINCT_ROLLS ?? 'on') === 'on',
  };
}

/** The own-act line kept for the model. Fixed text: the world's reply is never copied into it or into world.line. */
export const OWN_ACT_LINE = 'Your act was accepted.';

/** True only when the act reply is one JSON object whose accepted field is a non-empty array. */
export function acceptedReply(text: string): boolean {
  try {
    const value = JSON.parse(text) as { accepted?: unknown };
    return Array.isArray(value.accepted) && value.accepted.length > 0;
  } catch {
    return false;
  }
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
  connect: (env: Env) => Promise<WorldLink> = connectWorld,
  fxs: readonly Fx[] = DEFAULT_FXS,
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
      world = await connect(env);
    } catch {
      return audit(pass('no_world'), 0);
    }
    return audit(await wake(env, world, stateDir, sheet, cfg, fxs), waking(stateDir));
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
  fxs: readonly Fx[],
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
    goal: obs.intent?.goal ?? readAdoptedGoal(env.GELDAR_INSTINCT_WORKSPACE),
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
  const decided = decide(ctx, fxs);
  let out: InstinctResult = decided;
  if (decided.kind === 'settle') {
    // Settle only when the world's reply is JSON with a non-empty accepted array; anything else is send_failed.
    let accepted = false;
    try {
      accepted = acceptedReply(await world.call(decided.act.tool, decided.act.arguments));
    } catch {
      accepted = false;
    }
    if (!accepted) {
      out = pass('send_failed', decided.rolls);
    } else {
      out = { ...decided, world: { accepted: true, line: OWN_ACT_LINE } };
      state.pending_acts = [OWN_ACT_LINE, ...state.pending_acts].slice(0, PENDING_MAX);
    }
  } else if (
    decided.kind === 'pass-with-facts' ||
    (!decided.forced && state.pending_acts.length > 0)
  ) {
    // Own acts not yet shown go first, then the decision's facts (max 4). A non-forced pass becomes
    // pass-with-facts with fx none to carry them; a forced pass leaves pending_acts for the next non-forced result.
    const own = state.pending_acts
      .map((line) => makeFact('own_act', { line }))
      .filter((f): f is string => f !== null);
    const kept = decided.kind === 'pass-with-facts' ? decided.facts : [];
    out = {
      v: 1,
      kind: 'pass-with-facts',
      fx: decided.kind === 'pass-with-facts' ? decided.fx : 'none',
      facts: [...own, ...kept].slice(0, MAX_FACTS),
      rolls: decided.rolls,
    };
    state.pending_acts = [];
  }
  // Picks in a row: only an accepted idle act counts; every other outcome starts the count again at 0.
  state.picks_in_a_row =
    decided.kind === 'settle' && out.kind === 'settle' && decided.fx === 'idle'
      ? state.picks_in_a_row + 1
      : 0;
  saveState(stateDir, state);
  return out;
}
