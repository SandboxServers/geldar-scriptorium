// The failure fx (HC-20). It counts the failed tries of one problem (the goal and the program of the last intent),
// rolls a falling insight check for a repeat_failure fact, and escalates once the agent's retry cap is reached.
// Proficiency is degraded for this run (0320 OD-C), so every check passes 0 as its proficiency.
import { createHash } from 'node:crypto';
import type { Score } from '@geldar/scriptorium-psyche';
import type { Fx } from '../decide.ts';
import { makeFact } from '../facts.ts';

/** True while the run has no proficiency data: the sheet has none, so every check is made at proficiency 0. */
export const PROFICIENCY_DEGRADED = true;

/** The key of one problem: the goal and the program, never the arguments. The first 16 hex digits of a sha256. */
export function problemKey(goal: string, program: string): string {
  return createHash('sha256').update(`${goal}\0${program}`).digest('hex').slice(0, 16);
}

/** The retry cap of one agent: the base, moved by cleverness (3 is neutral), kept between 2 and 6. */
export function retryCap(cleverness: Score, base: number): number {
  return Math.min(6, Math.max(2, base + (cleverness - 3)));
}

/** The failure fx: a success clears the count, a failure counts once per waking and rolls the falling insight DC. */
export const failureFx: Fx = (ctx) => {
  const { obs, state, sheet } = ctx;
  const last = state.last_intent;
  if (obs.events.some((e) => e.kind === 'intent_finished')) {
    if (last !== null) {
      const key = problemKey(last.goal, last.program);
      delete state.attempts[key];
      delete state.tried[key];
    }
    return { kind: 'pass' };
  }
  const failed = obs.events.some((e) => e.kind === 'intent_failed' || e.kind === 'action_failed');
  if (!failed || last === null) return { kind: 'pass' };

  const key = problemKey(last.goal, last.program);
  const attempts = (state.attempts[key] ?? 0) + 1;
  state.attempts[key] = attempts;
  const cleverness = sheet.attributes.cleverness;
  if (attempts >= retryCap(cleverness, ctx.cfg.failureCap)) {
    return { kind: 'escalate', fx: 'failure', reason: 'failure_past_cap' };
  }
  const { success } = ctx.check('insight', cleverness, Math.max(8, 14 - attempts), 0);
  const fact = success ? makeFact('repeat_failure', { n: attempts }) : null;
  if (fact !== null) return { kind: 'facts', fx: 'failure', stop: true, facts: [fact] };
  return { kind: 'escalate', fx: 'failure', reason: 'no_variation' };
};
