// The at-tap capture holder (a PROMISE so the view opens while
// render+OCR finish). Pins: null default, promise passthrough, re-tap
// notification, throw-safe subscribers.

import type {PageCapture} from './capture';
import {
  setCurrentCapture,
  getCurrentCapture,
  subscribeCapture,
} from './currentCapture';

describe('currentCapture', () => {
  it('resolves null before any capture', async () => {
    expect(await getCurrentCapture()).toBeNull();
  });

  it('hands back the exact pending promise and notifies subscribers', async () => {
    const seen = jest.fn();
    const off = subscribeCapture(seen);
    const cap = {notePath: '/n/a.note', page: 2} as unknown as PageCapture;
    let resolve!: (c: PageCapture | null) => void;
    const p = new Promise<PageCapture | null>(r => (resolve = r));
    setCurrentCapture(p);
    expect(seen).toHaveBeenCalledTimes(1); // re-tap refreshes the UI
    const got = getCurrentCapture();
    resolve(cap);
    expect(await got).toBe(cap);
    off();
  });

  it('a throwing subscriber does not break the capture wiring', () => {
    const offBad = subscribeCapture(() => {
      throw new Error('bad');
    });
    const seen = jest.fn();
    const off = subscribeCapture(seen);
    expect(() =>
      setCurrentCapture(Promise.resolve(null)),
    ).not.toThrow();
    expect(seen).toHaveBeenCalled();
    offBad();
    off();
  });
});
