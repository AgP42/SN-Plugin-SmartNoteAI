// Floating panel geometry — shared so App.tsx (which calls
// SmartNoteAiOverlay.open with these) and Bubble.tsx (which seeds its
// drag/resize refs from them) never drift apart.
export const PANEL = {
  x: 80,
  y: 160,
  width: 720,
  height: 960,
  minWidth: 380,
  minHeight: 440,
};

// Default open width = 80% of the screen, centred (device feedback:
// the fixed 720 px wasted most of the Manta's width). Callers invoke
// this once getScreenSize has answered; the values above stay as the
// fallback when it hasn't.
export const applyScreenSize = (screenW?: number, screenH?: number): void => {
  if (typeof screenW === 'number' && screenW > 0) {
    PANEL.width = Math.round(screenW * 0.8);
    PANEL.x = Math.round(screenW * 0.1);
  }
  if (typeof screenH === 'number' && screenH > 0) {
    PANEL.height = Math.min(PANEL.height, Math.round(screenH * 0.6));
  }
};

// v0.85: the compact MENU window (the hub). Smaller than the chat panel; its
// open position is docked to the toolbar side (menuOrigin). Approx toolbar
// strip width — the SDK can't read the host UI.
// Measured from the native "Plugins" menu on the Manta (1920x2560, left
// toolbar) so our hub opens at the SAME place and SAME size (user request
// 2026-07-29): box at x=171 y=1149, 665x1119 — exactly 7 rows, no scroll.
// Stored as screen fractions so it scales to other devices/orientations.
const NATIVE = {
  x: 171 / 1920, // 0.0891 — left edge, just right of the toolbar
  y: 1149 / 2560, // 0.4488 — top edge, a little below mid-screen
  w: 665 / 1920, // 0.3464
  h: 1119 / 2560, // 0.4371
};
export const MENU = {width: 665, height: 1357}; // fallback (1920x2560)

// Native WIDTH and top position, but a bit TALLER (extends downward) so all 7
// card items fit — the native footprint only showed 6 (user, 2026-07-29).
// Height still clamped so the window never runs past the screen bottom from
// the native top.
export const menuSizeFor = (
  screenW?: number,
  screenH?: number,
  // v0.88.3 (user): the frame must STOP at the last button — size the
  // window from the item count instead of a fixed 53% of the screen.
  itemCount = 7,
): {width: number; height: number} => {
  const sw = typeof screenW === 'number' && screenW > 0 ? screenW : 1920;
  const sh = typeof screenH === 'number' && screenH > 0 ? screenH : 2560;
  const top = Math.round(sh * NATIVE.y);
  // Native px, MEASURED on a device screenshot at scale 1 (v0.88.6):
  // header ≈ 134, a plain card ≈ 157, a card whose sub wraps ≈ 198. Use a
  // per-item budget that absorbs a couple of wrapped subs; MenuScreen
  // scrolls if a future item still overflows.
  const wanted = 140 + itemCount * 172 + 36;
  return {
    width: Math.round(sw * NATIVE.w),
    height: Math.min(wanted, sh - top - 24),
  };
};

// Docked open origin: match the native plugin-list menu position.
//  • left / none / default → native spot (x=171, y=1149 on 1920x2560).
//  • right → mirrored to the right toolbar.
//  • top / bottom → horizontally centred, near the top.
export const menuOrigin = (
  screenW: number,
  screenH: number,
  side: 'none' | 'left' | 'right' | 'top' | 'bottom' | undefined,
  w: number,
  h: number,
): {x: number; y: number} => {
  const nx = Math.round(screenW * NATIVE.x);
  const ny = Math.round(screenH * NATIVE.y);
  let x: number;
  let y: number;
  if (side === 'right') {
    x = screenW - w - nx;
    y = ny;
  } else if (side === 'top' || side === 'bottom') {
    x = Math.round(screenW * 0.5 - w / 2);
    y = Math.round(screenH * 0.12);
  } else {
    // left / none / default
    x = nx;
    y = ny;
  }
  return {
    x: Math.max(0, Math.min(x, screenW - w)),
    y: Math.max(0, Math.min(y, screenH - h)),
  };
};
