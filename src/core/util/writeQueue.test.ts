// The serialized write queue — the primitive under the settings and
// conversation-index single-writer guarantee. Pins: strict FIFO (a
// writer never starts before the previous one finished), a rejection
// reaches ONLY its own caller, and the chain survives it.

import {makeWriteQueue} from './writeQueue';

describe('makeWriteQueue', () => {
  it('runs writers strictly one after the other, in order', async () => {
    const q = makeWriteQueue();
    const events: string[] = [];
    let releaseA!: () => void;
    const a = q(async () => {
      events.push('a-start');
      await new Promise<void>(r => (releaseA = r));
      events.push('a-end');
      return 'A';
    });
    const b = q(async () => {
      events.push('b-start');
      return 'B';
    });
    // B must NOT have started while A holds the queue.
    await Promise.resolve();
    expect(events).toEqual(['a-start']);
    releaseA();
    expect(await a).toBe('A');
    expect(await b).toBe('B');
    expect(events).toEqual(['a-start', 'a-end', 'b-start']);
  });

  it('a rejection reaches its caller but does not break the chain', async () => {
    const q = makeWriteQueue();
    const bad = q(async () => {
      throw new Error('disk full');
    });
    const good = q(async () => 42);
    await expect(bad).rejects.toThrow('disk full');
    expect(await good).toBe(42);
    // And the queue still serves later writers.
    expect(await q(async () => 'later')).toBe('later');
  });

  it('two queues are independent', async () => {
    const q1 = makeWriteQueue();
    const q2 = makeWriteQueue();
    const events: string[] = [];
    let release!: () => void;
    const slow = q1(async () => {
      await new Promise<void>(r => (release = r));
      events.push('q1');
    });
    await q2(async () => {
      events.push('q2');
    });
    expect(events).toEqual(['q2']); // q2 never waited on q1
    release();
    await slow;
  });
});
