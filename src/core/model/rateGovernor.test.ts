import {
  rateAcquire,
  rateReport,
  rateReset,
  ratePaceMs,
} from './rateGovernor';

describe('rateGovernor (adaptive 429 pacing)', () => {
  beforeEach(() => rateReset());

  it('is a no-op until a 429 is seen', async () => {
    let slept = 0;
    const sleepFn = async (ms: number) => {
      slept += ms;
    };
    await rateAcquire(1000, sleepFn);
    await rateAcquire(1000, sleepFn);
    expect(slept).toBe(0);
    expect(ratePaceMs()).toBe(0);
  });

  it('a 429 turns on pacing and spaces subsequent starts', async () => {
    rateReport(429, 0);
    const pace = ratePaceMs();
    expect(pace).toBeGreaterThan(0);

    const waits: number[] = [];
    const sleepFn = async (ms: number) => {
      waits.push(ms);
    };
    // Three concurrent acquirers at the same instant must be spaced by `pace`.
    await Promise.all([
      rateAcquire(1000, sleepFn),
      rateAcquire(1000, sleepFn),
      rateAcquire(1000, sleepFn),
    ]);
    // First runs immediately-ish (slot may be now+pace from the 429 nextSlot),
    // the rest are staggered by exactly one pace each.
    const sorted = [...waits].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBe(pace);
    }
  });

  it('repeated 429s double the pace, capped', async () => {
    rateReport(429, 0);
    const p1 = ratePaceMs();
    rateReport(429, 0);
    const p2 = ratePaceMs();
    expect(p2).toBe(p1 * 2);
    for (let i = 0; i < 20; i++) {
      rateReport(429, 0);
    }
    expect(ratePaceMs()).toBeLessThanOrEqual(30_000);
    expect(ratePaceMs()).toBeGreaterThan(0);
  });

  it('clean calls decay the pace back to zero', () => {
    rateReport(429, 0); // pacing on
    expect(ratePaceMs()).toBeGreaterThan(0);
    // A streak of clean calls eventually turns it fully off.
    for (let i = 0; i < 100; i++) {
      rateReport(200, 0);
    }
    expect(ratePaceMs()).toBe(0);
  });

  it('non-throughput statuses (402/500) do not change the pace', () => {
    rateReport(402, 0);
    rateReport(500, 0);
    expect(ratePaceMs()).toBe(0);
  });
});
