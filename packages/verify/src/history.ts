import type { Mode } from '@geldar/scriptorium-path-rule';
import type { Reason } from './reasons.ts';
import { git } from './run-git.ts';

export interface HistoryContext {
  repo: string;
  start: string;
  tip: string;
  mode: Mode;
  playerId: string;
}

// SC-23a placeholder: SC-23b replaces this body. The signature is final.
export function checkHistory(ctx: HistoryContext, run: typeof git = git): Reason[] {
  return [];
}
