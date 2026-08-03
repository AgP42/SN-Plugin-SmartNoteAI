// Library → chat handoff buffer. Pins: accumulation across taps with
// dedup, one-shot consume, live subscriber notification, and a throwing
// listener never breaking the library action.

import {
  addChatCtxSeed,
  consumeChatCtxSeed,
  subscribeChatCtxSeed,
} from './chatCtxSeed';

beforeEach(() => {
  consumeChatCtxSeed(); // drain the module-level buffer
});

describe('chatCtxSeed', () => {
  it('accumulates refs across calls, deduped, until consumed', () => {
    addChatCtxSeed([{path: '/n/a.note', page: 0}]);
    addChatCtxSeed([
      {path: '/n/a.note', page: 0}, // duplicate
      {path: '/n/a.note', page: 1},
      {path: '/n/b.note', page: 0},
    ]);
    expect(consumeChatCtxSeed()).toEqual([
      {path: '/n/a.note', page: 0},
      {path: '/n/a.note', page: 1},
      {path: '/n/b.note', page: 0},
    ]);
    // One-shot: a second consume finds nothing.
    expect(consumeChatCtxSeed()).toEqual([]);
  });

  it('notifies live subscribers on add; unsubscribe stops it', () => {
    const seen = jest.fn();
    const off = subscribeChatCtxSeed(seen);
    addChatCtxSeed([{path: '/n/a.note', page: 2}]);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    addChatCtxSeed([{path: '/n/a.note', page: 3}]);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('an empty add neither notifies nor changes the buffer', () => {
    const seen = jest.fn();
    const off = subscribeChatCtxSeed(seen);
    addChatCtxSeed([]);
    expect(seen).not.toHaveBeenCalled();
    expect(consumeChatCtxSeed()).toEqual([]);
    off();
  });

  it('a throwing listener does not break the library action', () => {
    const off1 = subscribeChatCtxSeed(() => {
      throw new Error('bad listener');
    });
    const seen = jest.fn();
    const off2 = subscribeChatCtxSeed(seen);
    expect(() =>
      addChatCtxSeed([{path: '/n/a.note', page: 0}]),
    ).not.toThrow();
    expect(seen).toHaveBeenCalled();
    off1();
    off2();
  });
});
