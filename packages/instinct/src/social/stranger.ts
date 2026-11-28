// The stranger policy (HC-28b, brief 5.7, D-HC-09). A first-time sighting is never settled and never spoken to: the
// instinct step can only avoid, ignore or follow a stranger, and it escalates to the model before any speech. The
// policy is pure; the caller injects the roll. The why strings go to the operator ledger and never to the character.
import type { CharacterSheet, Roll, Score } from '@geldar/scriptorium-psyche';
import { type Branch, type Dist, distribution, type Prob } from './branch.ts';

export type StrangerChoice = 'avoid' | 'approach' | 'ignore';

export interface StrangerInput {
  own: CharacterSheet;
  socialProficiency: number;
  other: { id: string; name: string; distance: number; estAggression: number };
  sightings: number;
  hasPeopleFile: boolean;
  followsSoFar: number;
  rollsOn: boolean;
}

export type StrangerOutcome =
  | { kind: 'pass' }
  | { kind: 'escalate'; why: string }
  | { kind: 'settle'; act: { kind: 'travel_away' | 'follow'; target: string }; why: string };

/** Within this many blocks an approach escalates: speech needs a model. */
export const SPEECH_RANGE = 4;
/** The most follows the instinct step settles for one stranger; the next escalates. */
export const FOLLOW_LIMIT = 3;

const THREAT_LINE = 2;
const CHANCE_DC = 11;
// Ties between equally probable choices go to the first of these.
const TIE_ORDER: readonly StrangerChoice[] = ['ignore', 'avoid', 'approach'];

function leaf(outcome: StrangerChoice): Branch<StrangerChoice> {
  return { kind: 'outcome', outcome };
}

/** The own curiosity and good, shifted to zero at 3, plus half the social proficiency. */
function approachOf(i: StrangerInput): number {
  return i.own.attributes.curiosity - 3 + (i.own.alignment.good - 3) + 0.5 * i.socialProficiency;
}

/** The other's estimated aggression less our own. */
function threatOf(i: StrangerInput): number {
  return i.other.estAggression - i.own.attributes.aggression;
}

/** The choice as a tree: a fixed outcome, or one curiosity check between approach and ignore. */
export function strangerBranch(i: StrangerInput): Branch<StrangerChoice> {
  const approach = approachOf(i);
  if (threatOf(i) >= THREAT_LINE) return leaf('avoid');
  if (approach >= 1) return leaf('approach');
  if (approach + 2 < 1) return leaf('ignore');
  return {
    kind: 'chance',
    chance: { score: i.own.attributes.curiosity, dc: CHANCE_DC, proficiency: 0 },
    success: leaf('approach'),
    failure: leaf('ignore'),
  };
}

/** Walks the tree, calling roll once per chance node. Null when the roll is not available. */
function walkWithRolls(
  b: Branch<StrangerChoice>,
  roll: (score: Score, dc: number) => Roll | null,
  rolls: Roll[],
): StrangerChoice | null {
  let node = b;
  while (node.kind === 'chance') {
    const r = roll(node.chance.score, node.chance.dc);
    if (r === null) return null;
    rolls.push(r);
    node = r.success ? node.success : node.failure;
  }
  return node.outcome;
}

/** The most probable choice; a tie goes to the earlier entry of TIE_ORDER. */
function mostProbable(dist: Dist<StrangerChoice>): StrangerChoice {
  let best: StrangerChoice = TIE_ORDER[0] ?? 'ignore';
  let bestP = -1;
  for (const c of TIE_ORDER) {
    const q = dist.get(c) ?? 0;
    if (q > bestP) {
      best = c;
      bestP = q;
    }
  }
  return best;
}

function outcomeOf(choice: StrangerChoice, i: StrangerInput): StrangerOutcome {
  if (choice === 'ignore') return { kind: 'pass' };
  if (choice === 'avoid') {
    return {
      kind: 'settle',
      act: { kind: 'travel_away', target: i.other.id },
      why: 'avoid: the other is estimated a threat',
    };
  }
  if (i.other.distance <= SPEECH_RANGE) {
    return { kind: 'escalate', why: 'approach within speech range: speech needs a model' };
  }
  if (i.followsSoFar >= FOLLOW_LIMIT) {
    return { kind: 'escalate', why: 'approach: follow limit reached' };
  }
  return {
    kind: 'settle',
    act: { kind: 'follow', target: i.other.id },
    why: 'approach: follow the stranger',
  };
}

/**
 * The stranger outcome for one sighting. Gates first: a known person (a people file) and the first sighting pass.
 * With rolls off the most probable choice is taken and no roll is drawn. With rolls on the tree is walked and roll
 * is called once per chance node; a null roll passes, so the model decides.
 */
export function strangerStep(
  i: StrangerInput,
  roll: (score: Score, dc: number) => Roll | null,
  p: Prob,
): { outcome: StrangerOutcome; rolls: Roll[] } {
  if (i.hasPeopleFile || i.sightings < 1) return { outcome: { kind: 'pass' }, rolls: [] };
  const rolls: Roll[] = [];
  const branch = strangerBranch(i);
  const choice = i.rollsOn
    ? walkWithRolls(branch, roll, rolls)
    : mostProbable(distribution(branch, p));
  if (choice === null) return { outcome: { kind: 'pass' }, rolls };
  return { outcome: outcomeOf(choice, i), rolls };
}
