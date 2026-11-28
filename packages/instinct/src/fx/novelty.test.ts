import { check, rngFor, type Score, type Sheet } from '@geldar/scriptorium-psyche';
import { describe, expect, it } from 'vitest';
import type { RollRecord } from '../contract.ts';
import type { FxContext } from '../decide.ts';
import type { Observation } from '../observe.ts';
import { emptyState, type InstinctState } from '../state.ts';
import { noticeRadius, noveltyFx } from './novelty.ts';

const noObs: Observation = {
  tick: 1,
  dead: false,
  night: null,
  position: null,
  health: null,
  hunger: null,
  inventory: {},
  foodCarried: null,
  inventoryFull: null,
  agents: [],
  entities: [],
  notable: [],
  intent: null,
  events: [],
  cursor: null,
};

interface Options {
  state?: InstinctState;
  knownText?: string;
  curiosity?: Score;
  /** Scripted: every check answers this and records a roll with no dice. Unset: the real psyche check runs. */
  scripted?: boolean;
  rolls?: boolean;
}

/** A context for the novelty fx. Without `scripted` the real check runs with the psyche rng, as run.ts does. */
function ctxFor(obs: Partial<Observation> = {}, opts: Options = {}): FxContext {
  const rolls: RollRecord[] = [];
  const curiosity = opts.curiosity ?? 3;
  const ctx: FxContext = {
    obs: { ...noObs, ...obs },
    sheet: {
      version: 1,
      attributes: { curiosity, common_sense: 3, cleverness: 3, aggression: 3 },
      alignment: { law: 3, good: 3 },
      op_modes: { explorer: 3, farmer: 3, miner: 3, builder: 3, crafter: 3, warrior: 3, nitwit: 3 },
    } satisfies Sheet,
    state: opts.state ?? emptyState(),
    cfg: { arm: 'instinct', failureCap: 4, maxPicks: 3, thinkP: 0.25, rolls: opts.rolls ?? true },
    lifeKey: 'life',
    tick: 1,
    goal: null,
    knownText: opts.knownText ?? '',
    rolls,
    check(fx, score, dc, prof = 0) {
      const n = rolls.length;
      if (opts.scripted !== undefined) {
        const roll: RollRecord = {
          id: `life:1:${fx}:${n}`,
          fx,
          score,
          dc,
          mode: 'off',
          dice: [],
          kept: null,
          bonus: prof,
          total: null,
          success: opts.scripted,
        };
        rolls.push(roll);
        return { success: opts.scripted, roll };
      }
      const rng = rngFor({
        lifeId: 'life',
        producer: 'kit',
        generation: 0,
        tick: 1,
        fx,
        decisionSeq: n,
      });
      const out = check(fx, score, dc, rng, n, 'life', 1, { prof, rolls: opts.rolls ?? true });
      rolls.push(out.roll);
      return out;
    },
    draw: () => 0,
  };
  return ctx;
}

const cow = (distance: number | null) => ({ kind: 'cow', hostile: false, distance });

describe('noticeRadius', () => {
  it('is 4, 8, 16, 24, 32 by curiosity 1 to 5', () => {
    const radii = [1, 2, 3, 4, 5].map((c) => noticeRadius(c as Score));
    expect(radii).toEqual([4, 8, 16, 24, 32]);
  });
});

describe('noveltyFx', () => {
  it('a thing beyond the radius stays new; a thing at the radius is rolled', () => {
    const far = ctxFor({ entities: [cow(5)] }, { curiosity: 1, scripted: true });
    expect(noveltyFx(far)).toEqual({ kind: 'pass' });
    expect(far.state.seen).toEqual([]);
    const edge = ctxFor({ entities: [cow(4)] }, { curiosity: 1, scripted: true });
    expect(noveltyFx(edge).kind).toBe('facts');
  });

  it('a thing with distance null is ignored', () => {
    const ctx = ctxFor({ entities: [cow(null)] }, { scripted: true });
    expect(noveltyFx(ctx)).toEqual({ kind: 'pass' });
    expect(ctx.rolls).toEqual([]);
  });

  it('a name present in the known text gives nothing; a longer word does not count', () => {
    const named = ctxFor(
      { entities: [{ kind: 'oak_log', hostile: false, distance: 2 }] },
      {
        knownText: 'the oak log is by the river',
        scripted: true,
      },
    );
    expect(noveltyFx(named)).toEqual({ kind: 'pass' });
    const longer = ctxFor(
      { entities: [{ kind: 'log', hostile: false, distance: 2 }] },
      {
        knownText: 'a catalogue of logs',
        scripted: true,
      },
    );
    expect(noveltyFx(longer).kind).toBe('facts');
  });

  it('a first sighting is marked seen whether the roll succeeds or fails', () => {
    for (const success of [true, false]) {
      const ctx = ctxFor({ entities: [cow(2)] }, { scripted: success });
      noveltyFx(ctx);
      noveltyFx(ctx);
      // The second run finds the key in seen and rolls nothing; a mark only on success would roll again.
      expect(ctx.rolls).toHaveLength(1);
      expect(ctx.state.seen).toEqual(['thing:cow']);
    }
  });

  it('a success gives one new_sighting fact and no act', () => {
    const ctx = ctxFor({ entities: [cow(2)] }, { scripted: true });
    expect(noveltyFx(ctx)).toEqual({
      kind: 'facts',
      fx: 'novelty',
      facts: ['You have not seen cow before.'],
    });
  });

  it('rolls off: curiosity 3 at DC 11 succeeds (flat, chance 0.5)', () => {
    const ctx = ctxFor({ entities: [cow(2)] }, { curiosity: 3, rolls: false });
    expect(noveltyFx(ctx).kind).toBe('facts');
    expect(ctx.rolls[0]).toMatchObject({ fx: 'novelty', dc: 11, success: true });
  });

  it('a notable block with pos and distance is a sighting; the pos never appears in the fact', () => {
    const ctx = ctxFor(
      { notable: [{ kind: 'iron_ore', distance: 2, pos: { x: 10, y: 64, z: -3 } }] },
      { scripted: true },
    );
    const result = noveltyFx(ctx);
    expect(result).toEqual({
      kind: 'facts',
      fx: 'novelty',
      facts: ['You have not seen iron ore before.'],
    });
    expect(ctx.state.seen).toEqual(['thing:iron_ore']);
  });

  it('an agent in obs.agents is never a novelty sighting', () => {
    const ctx = ctxFor({ agents: [{ name: 'Ash', distance: 1 }] }, { scripted: true });
    expect(noveltyFx(ctx)).toEqual({ kind: 'pass' });
    expect(ctx.state.seen).toEqual([]);
  });

  it('a kind with a newline or a double quote gives no fact', () => {
    const ctx = ctxFor(
      {
        entities: [
          { kind: 'cow\nbad', hostile: false, distance: 1 },
          { kind: 'cow"bad', hostile: false, distance: 2 },
        ],
      },
      { scripted: true },
    );
    expect(noveltyFx(ctx)).toEqual({ kind: 'pass' });
  });

  it('at most two things are rolled per run, nearest first, and a seen thing rolls nothing', () => {
    const ctx = ctxFor(
      {
        entities: [
          { kind: 'far_one', hostile: false, distance: 9 },
          { kind: 'near_one', hostile: false, distance: 1 },
        ],
        notable: [{ kind: 'mid_one', distance: 4 }],
      },
      { scripted: true },
    );
    const result = noveltyFx(ctx);
    expect(result.kind === 'facts' ? result.facts.length : 0).toBe(2);
    expect(ctx.state.seen).toEqual(['thing:near_one', 'thing:mid_one']);
    const seenCtx = ctxFor(
      { entities: [cow(1)] },
      { scripted: true, state: { ...emptyState(), seen: ['thing:cow'] } },
    );
    expect(noveltyFx(seenCtx)).toEqual({ kind: 'pass' });
    expect(seenCtx.rolls).toEqual([]);
  });

  it('every roll has bonus 0 (no proficiency is added)', () => {
    const ctx = ctxFor(
      { entities: [cow(1), { kind: 'pig', hostile: false, distance: 2 }] },
      { curiosity: 3 },
    );
    noveltyFx(ctx);
    expect(ctx.rolls.length).toBe(2);
    for (const roll of ctx.rolls) expect(roll.bonus).toBe(0);
  });
});
