// The package entry. The engine is re-exported one name at a time, never with `export *`. TEMPERAMENT_BANK and
// temperamentFor stay inside the package (temperament is inactive, see README.md). d20 is exported as a public engine
// helper; a raw draw from it is not recorded, so audited draws go through check() or roll(). check.test.ts pins the
// runtime names.

export type {
  CharacterSheet,
  Domain,
  DrawKey,
  Level,
  Mode,
  Rng,
  Roll,
  Score,
  SheetResult,
} from '../engine/index.ts';
export {
  alignmentLabel,
  canonicalSheetJson,
  DEFAULT_DCS,
  DEFAULT_THRESHOLDS,
  d20,
  decisionId,
  ENGINE_VERSION,
  exactChance,
  factor,
  levelForXp,
  modeFor,
  normalizeSheet,
  rngFor,
  roll,
  STANDARD_SHEET,
  seedFor,
  sheetOrStandard,
  step,
} from '../engine/index.ts';
export type { CheckOptions, RollRecord } from './check.ts';
export { check, successChance, successProbability } from './check.ts';
export type { Sheet } from './sheet.ts';
export { parseSheet } from './sheet.ts';
