// Overlay open-view intent (index.js → Bubble). Pin the consume-resets-
// to-chat default: a lasso or legacy open must always land on the chat.

import {setOverlayView, consumeOverlayView} from './overlayView';

describe('overlayView', () => {
  it('defaults to chat and resets to chat after a consume', () => {
    expect(consumeOverlayView()).toBe('chat');
    setOverlayView('menu');
    expect(consumeOverlayView()).toBe('menu');
    expect(consumeOverlayView()).toBe('chat'); // reset, not sticky
  });
});
