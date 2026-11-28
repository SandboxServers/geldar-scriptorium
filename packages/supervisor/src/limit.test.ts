import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Behaviour, makeFixture, onPoll, START } from './fixture.ts';
import { findUsageLimit } from './supervisor.ts';

// The weekly limit as seen in a stream: an error result with exit 1 and no cost.
const limited = (resetsAt?: number): Behaviour => ({
  limit: resetsAt === undefined ? {} : { resetsAt },
  last: "You've hit your weekly limit",
  err: true,
  rc: 1,
  cost: 0,
});

describe('a usage limit', () => {
  it('is not a failed cycle: no count, no auto STOP, waits until resetsAt plus 60 s', async () => {
    const reset = START + 3600;
    const b = limited(reset);
    const f = makeFixture(b, { GELDAR_RUN_MAX_FAILS: '1' });
    const seen: Record<string, unknown>[] = [];
    onPoll(f, (poll) => {
      if (poll === 1) {
        seen.push(JSON.parse(f.read('status.json')));
        // The limit is over: the next run succeeds.
        delete b.limit;
        b.err = false;
        b.rc = 0;
        b.tools = 3;
        b.cost = 1;
      }
      if (poll === 2) f.supervisor.requestStop();
    });
    expect(await f.supervisor.run()).toBe(0);
    // The first sleep is the limit wait: reset + 60 s, counted from the end of the 60 s run.
    expect(f.sleeps[0]).toBe(3600);
    const until = new Date((reset + 60) * 1000).toISOString();
    expect(seen[0]).toMatchObject({ state: 'limited', limited_until: until });
    expect(f.read('supervisor.log')).toContain(
      `limited: weekly limit reached; waiting until ${until}`,
    );
    expect(f.said).toContain(`limited: weekly limit reached; waiting until ${until}`);
    expect(f.has('STOP')).toBe(false);
    expect(f.read('supervisor.log')).not.toMatch(/result=failed/);
    // Run 2 started after the wait and was ordinary.
    expect(f.runs()).toHaveLength(2);
  });

  it('waits 15 minutes when resetsAt is missing or more than 8 days away', async () => {
    for (const reset of [undefined, START + 9 * 86400]) {
      const f = makeFixture(limited(reset), { GELDAR_RUN_MAX_FAILS: '1' });
      onPoll(f, () => f.supervisor.requestStop());
      await f.supervisor.run();
      expect(f.sleeps[0]).toBe(900);
      expect(f.has('STOP')).toBe(false);
    }
  });

  it('still stops on a STOP file during the wait', async () => {
    const f = makeFixture(limited(START + 7200));
    let stopped = false;
    const real = f.deps.sleep;
    f.deps.sleep = async (secs, wake) => {
      if (!stopped) {
        stopped = true;
        writeFileSync(join(f.stateDir, 'STOP'), 'manual\n');
        expect(wake()).toBe(true);
        f.supervisor.requestStop();
      }
      await real(secs, wake);
    };
    expect(await f.supervisor.run()).toBe(0);
    expect(f.runs()).toHaveLength(1);
  });

  it('ignores an allowed event and a rejected one with no event type', () => {
    const f = makeFixture();
    const path = join(f.root, 'stream.jsonl');
    writeFileSync(
      path,
      `${JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } })}\n${JSON.stringify({ rate_limit_info: { status: 'rejected' } })}\n`,
    );
    expect(findUsageLimit(path)).toBeNull();
  });
});
