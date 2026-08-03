import {
  getActivity,
  requestStop,
  setActivity,
  stopRequested,
  subscribeActivity,
} from './activity';

describe('activity beacon (v0.67)', () => {
  afterEach(() => setActivity(null));

  it('sets, notifies, and clears', () => {
    let ticks = 0;
    const off = subscribeActivity(() => ticks++);
    setActivity({label: 'Checking notes', done: 1, total: 10});
    expect(getActivity()).toEqual({label: 'Checking notes', done: 1, total: 10});
    setActivity(null);
    expect(getActivity()).toBeNull();
    expect(ticks).toBe(2);
    off();
  });

  it('Stop only arms while an activity runs, and dies with it', () => {
    requestStop(); // nothing running → no-op
    expect(stopRequested()).toBe(false);
    setActivity({label: 'x'});
    requestStop();
    expect(stopRequested()).toBe(true);
    setActivity(null); // producer exits → flag cleared
    expect(stopRequested()).toBe(false);
    setActivity({label: 'next run'});
    expect(stopRequested()).toBe(false); // never leaks into the next run
  });

  it('a throwing listener does not break producers', () => {
    const off = subscribeActivity(() => {
      throw new Error('boom');
    });
    expect(() => setActivity({label: 'x'})).not.toThrow();
    off();
  });
});
