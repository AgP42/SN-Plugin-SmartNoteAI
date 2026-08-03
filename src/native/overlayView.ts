// The floating overlay (Bubble) can open on one of two views: the MENU (hub)
// or the CHAT (assistant). index.js sets this right before calling the native
// open; Bubble reads it once on mount. Default 'chat' so the lasso action and
// any legacy open still land straight on the assistant. (v0.85)
export type OverlayView = 'menu' | 'chat';

let pending: OverlayView = 'chat';

export const setOverlayView = (v: OverlayView): void => {
  pending = v;
};

export const consumeOverlayView = (): OverlayView => {
  const v = pending;
  pending = 'chat';
  return v;
};
