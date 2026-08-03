// Library deep-link intent (menu overlay → App). Pin the consume-once
// contract and the explicit clear.

import {setLibTargetIntent, consumeLibTargetIntent} from './libTargetIntent';

describe('libTargetIntent', () => {
  it('is consume-once', () => {
    setLibTargetIntent({doc: '/n/a.note', page: 3});
    expect(consumeLibTargetIntent()).toEqual({doc: '/n/a.note', page: 3});
    expect(consumeLibTargetIntent()).toBeNull();
  });

  it('can be cleared with null (no stale deep-link)', () => {
    setLibTargetIntent({doc: '/n/a.note', page: null});
    setLibTargetIntent(null);
    expect(consumeLibTargetIntent()).toBeNull();
  });
});
