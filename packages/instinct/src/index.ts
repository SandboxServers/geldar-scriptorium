// The package entry. The contract is also exported alone as ./contract (pure, no world or engine imports).

export type { AuditMeta } from './audit.ts';
export { appendAudit, buildAuditLine } from './audit.ts';
export type { ActRecord, FxName, InstinctResult, PassReason, RollRecord } from './contract.ts';
export {
  FORCED,
  INSTINCT_V,
  parseInstinctResult,
  sanitizeFact,
} from './contract.ts';
export type { Fx, FxContext, FxResult, InstinctConfig } from './decide.ts';
export { decide, sightingKey } from './decide.ts';
export type { FactKey } from './facts.ts';
export { makeFact } from './facts.ts';
export type { EventKind, EventLine, Observation, WorldCalls } from './observe.ts';
export { classifyLine, observe, parseObservation } from './observe.ts';
export { DEFAULT_FXS, lifeKeyOf, readConfig, runInstinct } from './run.ts';
export type { InstinctState } from './state.ts';
export { emptyState, loadState, saveState } from './state.ts';
export type { WorldLink } from './world.ts';
export { connectWorld } from './world.ts';
