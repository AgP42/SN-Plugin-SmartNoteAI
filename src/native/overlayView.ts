// The floating overlay (Bubble) can open on one of two views: the MENU (hub)
// or the CHAT (assistant). index.js sets this right before calling the native
// open; Bubble reads it once on mount. Default 'chat' so the lasso action and
// any legacy open still land straight on the assistant. (v0.85)
//
// v1.0.27 (device report, A5X): the native open() KEEPS an existing window
// ("ALREADY_OPEN" — deliberate, it protects the lasso seed and a moved
// window), so with the chat already open the toolbar's menu tap consumed
// nothing and NOTHING visible happened. setOverlayView now also NOTIFIES a
// live subscriber: the mounted Bubble switches in place (goMenu/goChat —
// same moves as its own "≡ Menu" button), so the toolbar tap always shows
// the menu, and a lasso fired over the open menu lands on the chat.
export type OverlayView = 'menu' | 'chat';

let pending: OverlayView = 'chat';
let listener: ((v: OverlayView) => void) | null = null;

export const setOverlayView = (v: OverlayView): void => {
  pending = v;
  // A LIVE overlay hears the change immediately (fresh opens have no
  // subscriber yet — the mount-time consume below covers them).
  listener?.(v);
};

export const consumeOverlayView = (): OverlayView => {
  const v = pending;
  pending = 'chat';
  return v;
};

// ONE subscriber (the mounted Bubble). Returns the unsubscribe.
export const subscribeOverlayView = (
  fn: (v: OverlayView) => void,
): (() => void) => {
  listener = fn;
  return () => {
    if (listener === fn) {
      listener = null;
    }
  };
};
