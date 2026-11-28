// The orchestrator and its guards. Guards run first (dead, speech to me, a stranger); then each fx in order. An act
// settles at once, an escalation passes with its reason, facts accumulate. A stranger's key joins state.seen when the
// guard fires, so the model meets the stranger once.
import type { Score, Sheet } from '@geldar/scriptorium-psyche';
import {
  type ActRecord,
  FORCED,
  type FxName,
  type InstinctResult,
  MAX_FACTS,
  type PassReason,
  type RollRecord,
} from './contract.ts';
import type { Observation } from './observe.ts';
import { type InstinctState, SEEN_MAX } from './state.ts';

export interface InstinctConfig {
  arm: string;
  failureCap: number;
  maxPicks: number;
  thinkP: number;
  rolls: boolean;
}

export interface FxContext {
  obs: Observation;
  sheet: Sheet;
  state: InstinctState;
  cfg: InstinctConfig;
  lifeKey: string;
  tick: number;
  goal: string | null;
  knownText: string;
  check(
    fx: string,
    score: Score,
    dc: number,
    prof?: number,
  ): { success: boolean; roll: RollRecord };
  draw(fx: string): number;
  rolls: RollRecord[];
}

export type FxResult =
  | { kind: 'act'; fx: FxName; why: string; act: ActRecord }
  | { kind: 'facts'; fx: FxName; facts: string[]; stop?: boolean }
  | { kind: 'escalate'; fx: FxName; reason: PassReason }
  | { kind: 'pass' };

export type Fx = (ctx: FxContext) => FxResult;

/** The sighting key of one thing seen: `<kind>:<lowercased name>`. */
export function sightingKey(kind: string, name: string): string {
  return `${kind}:${name.toLowerCase()}`;
}

/** Decide one waking. Pure apart from ctx.state.seen, which the first_sighting guard extends when it fires. */
export function decide(ctx: FxContext, fxs: readonly Fx[]): InstinctResult {
  const { obs, state, rolls } = ctx;
  const pass = (reason: PassReason): InstinctResult => ({
    v: 1,
    kind: 'pass',
    reason,
    forced: FORCED.includes(reason),
    rolls: [...rolls],
  });
  if (obs.dead) return pass('dead');
  if (obs.events.some((e) => e.kind === 'speech_to_me')) return pass('speech_addressed');

  const unseen = [...new Set(obs.agents.map((a) => sightingKey('agent', a.name)))].filter(
    (key) => !state.seen.includes(key),
  );
  if (unseen.length > 0) {
    state.seen = [...state.seen, ...unseen].slice(-SEEN_MAX);
    return pass('first_sighting');
  }

  const facts: string[] = [];
  let factFx: FxName = 'none';
  const passWithFacts = (): InstinctResult => ({
    v: 1,
    kind: 'pass-with-facts',
    fx: factFx,
    facts: facts.slice(0, MAX_FACTS),
    rolls: [...rolls],
  });
  for (const fx of fxs) {
    const result = fx(ctx);
    if (result.kind === 'act') {
      // The world's reply is filled in by run.ts once the act is accepted.
      return {
        v: 1,
        kind: 'settle',
        fx: result.fx,
        why: result.why,
        act: result.act,
        rolls: [...rolls],
        world: { accepted: true, line: '' },
      };
    }
    if (result.kind === 'escalate') return pass(result.reason);
    if (result.kind === 'facts') {
      facts.push(...result.facts);
      factFx = result.fx;
      if (result.stop) return passWithFacts();
    }
  }
  return facts.length > 0 ? passWithFacts() : pass('nothing_to_do');
}
