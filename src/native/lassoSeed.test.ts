// Lasso → chat one-shot seed. Pins: consume clears (the image is never
// re-added on the next render), the seed carries the source note (the
// Off-gate fix of 2026-08-02 #2), and listeners are throw-safe.

import {setLassoSeed, consumeLassoSeed, subscribeLassoSeed} from './lassoSeed';

beforeEach(() => {
  consumeLassoSeed();
});

describe('lassoSeed', () => {
  it('set → consume is one-shot and keeps the source note for the Off gate', () => {
    setLassoSeed({image: 'b64png', note: '/n/private.note'});
    expect(consumeLassoSeed()).toEqual({
      image: 'b64png',
      note: '/n/private.note',
    });
    expect(consumeLassoSeed()).toBeNull();
  });

  it('a new lasso replaces the pending one (last capture wins)', () => {
    setLassoSeed({image: 'first'});
    setLassoSeed({image: 'second'});
    expect(consumeLassoSeed()).toEqual({image: 'second'});
  });

  it('notifies subscribers; unsubscribe stops it; a throwing listener is survived', () => {
    const seen = jest.fn();
    const offBad = subscribeLassoSeed(() => {
      throw new Error('bad');
    });
    const off = subscribeLassoSeed(seen);
    expect(() => setLassoSeed({image: 'x'})).not.toThrow();
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    setLassoSeed({image: 'y'});
    expect(seen).toHaveBeenCalledTimes(1);
    offBad();
    consumeLassoSeed();
  });
});
