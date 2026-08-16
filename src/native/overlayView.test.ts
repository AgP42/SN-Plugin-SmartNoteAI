// v1.0.27: the overlay-view store notifies the LIVE overlay (the toolbar
// menu tap over an already-open chat was a visible no-op — the native
// window is kept, and the old mount-only consume never fired).
import {
  setOverlayView,
  consumeOverlayView,
  subscribeOverlayView,
} from './overlayView';

afterEach(() => {
  consumeOverlayView(); // reset pending to 'chat'
});

it('mount-time consume: reads the pending view once, then defaults to chat', () => {
  setOverlayView('menu');
  expect(consumeOverlayView()).toBe('menu');
  expect(consumeOverlayView()).toBe('chat'); // consumed → default
});

it('a live subscriber hears the switch (the ALREADY_OPEN case)', () => {
  const seen: string[] = [];
  const off = subscribeOverlayView(v => seen.push(v));
  setOverlayView('menu');
  setOverlayView('chat');
  expect(seen).toEqual(['menu', 'chat']);
  off();
  setOverlayView('menu');
  expect(seen).toEqual(['menu', 'chat']); // unsubscribed
});

it('a stale unsubscribe never detaches a NEWER subscriber', () => {
  const a: string[] = [];
  const b: string[] = [];
  const offA = subscribeOverlayView(v => a.push(v));
  subscribeOverlayView(v => b.push(v)); // replaces A
  offA(); // must NOT detach B
  setOverlayView('menu');
  expect(a).toEqual([]);
  expect(b).toEqual(['menu']);
});
