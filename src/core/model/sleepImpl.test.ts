// The ONE injectable sleep (audit C2): core waits go through sleepVia so
// index.js can swap in the native heartbeat-backed hybrid at boot. Pins
// the injection contract — default timer, install, restore.

import {setSleepImpl, sleepVia} from './sleepImpl';

afterEach(() => {
  setSleepImpl(null); // never leak a fake into other tests
  jest.useRealTimers();
});

describe('sleepVia', () => {
  it('defaults to a plain timer sleep', async () => {
    jest.useFakeTimers();
    let done = false;
    const p = sleepVia(500).then(() => {
      done = true;
    });
    jest.advanceTimersByTime(499);
    await Promise.resolve();
    expect(done).toBe(false);
    jest.advanceTimersByTime(1);
    await p;
    expect(done).toBe(true);
  });

  it('delegates to an installed implementation', async () => {
    const fake = jest.fn(async () => undefined);
    setSleepImpl(fake);
    await sleepVia(1234);
    expect(fake).toHaveBeenCalledWith(1234);
  });

  it('setSleepImpl(null) restores the default timer', async () => {
    const fake = jest.fn(async () => undefined);
    setSleepImpl(fake);
    setSleepImpl(null);
    jest.useFakeTimers();
    const p = sleepVia(10);
    jest.advanceTimersByTime(10);
    await p;
    expect(fake).not.toHaveBeenCalled();
  });
});
