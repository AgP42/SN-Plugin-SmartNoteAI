// One-shot navigation intent (panel → App poll). Tiny, but it crosses
// React roots — pin the consume-once contract.

import {setNavIntent, consumeNavIntent} from './navIntent';

describe('navIntent', () => {
  it('is consume-once', () => {
    setNavIntent('library');
    expect(consumeNavIntent()).toBe('library');
    expect(consumeNavIntent()).toBeNull();
  });

  it('the last set wins', () => {
    setNavIntent('config');
    setNavIntent('guide');
    expect(consumeNavIntent()).toBe('guide');
  });
});
