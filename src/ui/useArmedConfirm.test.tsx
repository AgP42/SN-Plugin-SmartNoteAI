// The tap-to-arm / tap-to-confirm hook. The SAFETY under test (full
// review 2026-08-02 #10): the deadline check happens AT TAP TIME — a
// frozen cosmetic timer must never leave a stale armed state that a
// stray later tap would execute. Rendered through react-test-renderer
// with fake timers + fake system clock.

import React from 'react';
import {act, create} from 'react-test-renderer';
import {useArmedConfirm} from './useArmedConfirm';

type Hook = ReturnType<typeof useArmedConfirm>;

const renderHook = (timeoutMs?: number): {current: Hook} => {
  const ref = {current: null as unknown as Hook};
  const Probe = (): null => {
    ref.current = useArmedConfirm(timeoutMs);
    return null;
  };
  act(() => {
    create(React.createElement(Probe));
  });
  return ref;
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(1_000_000);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useArmedConfirm', () => {
  it('first tap arms (no execution), second tap within the window executes', () => {
    const h = renderHook();
    const run = jest.fn();
    let r1 = true;
    act(() => {
      r1 = h.current.confirm('clear', run);
    });
    expect(r1).toBe(false);
    expect(h.current.armed).toBe('clear');
    expect(run).not.toHaveBeenCalled();
    let r2 = false;
    act(() => {
      jest.setSystemTime(1_003_000); // 3 s later — within the 4 s window
      r2 = h.current.confirm('clear', run);
    });
    expect(r2).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(h.current.armed).toBeNull();
  });

  it('SAFETY: a stale second tap re-arms instead of executing, even with the timer frozen', () => {
    const h = renderHook();
    const run = jest.fn();
    act(() => {
      h.current.confirm('delete', run);
    });
    // The cosmetic setTimeout is FROZEN (we advance only the clock, not
    // the timers) — exactly the backgrounded-overlay state.
    act(() => {
      jest.setSystemTime(1_000_000 + 4_001);
    });
    let r = true;
    act(() => {
      r = h.current.confirm('delete', run);
    });
    expect(r).toBe(false); // re-armed, NOT executed
    expect(run).not.toHaveBeenCalled();
    // And the fresh arming works normally from here.
    act(() => {
      jest.setSystemTime(1_000_000 + 4_001 + 1_000);
      r = h.current.confirm('delete', run);
    });
    expect(r).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('tapping a DIFFERENT key re-arms onto it (no cross-key execution)', () => {
    const h = renderHook();
    const run = jest.fn();
    act(() => {
      h.current.confirm('a', run);
    });
    let r = true;
    act(() => {
      r = h.current.confirm('b', run);
    });
    expect(r).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(h.current.armed).toBe('b');
  });

  it('disarm clears the armed state', () => {
    const h = renderHook();
    act(() => {
      h.current.confirm('x');
    });
    act(() => {
      h.current.disarm();
    });
    expect(h.current.armed).toBeNull();
  });

  it('the cosmetic timer un-highlights after the window (when timers run)', () => {
    const h = renderHook(2_000);
    act(() => {
      h.current.confirm('y');
    });
    expect(h.current.armed).toBe('y');
    act(() => {
      jest.advanceTimersByTime(2_000);
    });
    expect(h.current.armed).toBeNull();
  });
});
