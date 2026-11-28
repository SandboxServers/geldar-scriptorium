import { describe, expect, it } from 'vitest';
import { failureFx } from './fx/failure.ts';
import { idleFx } from './fx/idle.ts';
import { noveltyFx } from './fx/novelty.ts';
import { DEFAULT_FXS } from './run.ts';

describe('DEFAULT_FXS', () => {
  it('holds the failure, novelty and idle effects, in that order', () => {
    expect(DEFAULT_FXS).toEqual([failureFx, noveltyFx, idleFx]);
  });
});
