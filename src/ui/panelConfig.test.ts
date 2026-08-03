// Floating-window geometry — pure math shared by App and Bubble. Pins
// the measured native-menu footprint (user request 2026-07-29: same
// place, same size as the firmware's own plugin menu), the item-count
// sizing (v0.88.3: the frame stops at the last button), and the screen
// clamps.

import {PANEL, applyScreenSize, MENU, menuSizeFor, menuOrigin} from './panelConfig';

describe('menuSizeFor', () => {
  it('matches the measured native footprint width on the Manta (1920x2560)', () => {
    const s = menuSizeFor(1920, 2560, 7);
    expect(s.width).toBe(665); // measured native menu width
    // 7 items: header 140 + 7·172 + 36 = 1380, under the bottom clamp.
    expect(s.height).toBe(1380);
  });

  it('clamps the height so the window never runs past the screen bottom', () => {
    const s = menuSizeFor(1920, 2560, 12);
    // top = round(2560·0.4488…) = 1149 → max = 2560 − 1149 − 24 = 1387.
    expect(s.height).toBe(1387);
  });

  it('falls back to the Manta screen when sizes are unknown', () => {
    expect(menuSizeFor(undefined, undefined, 7)).toEqual(
      menuSizeFor(1920, 2560, 7),
    );
  });

  it('scales the width as a screen fraction on other devices', () => {
    const s = menuSizeFor(960, 1280, 7);
    expect(s.width).toBe(Math.round(960 * (665 / 1920)));
  });
});

describe('menuOrigin', () => {
  it('left/default docks at the native menu spot', () => {
    expect(menuOrigin(1920, 2560, 'left', 665, 1119)).toEqual({
      x: 171,
      y: 1149,
    });
    expect(menuOrigin(1920, 2560, undefined, 665, 1119)).toEqual({
      x: 171,
      y: 1149,
    });
  });

  it('right mirrors the native x to the right toolbar', () => {
    const o = menuOrigin(1920, 2560, 'right', 665, 1119);
    expect(o).toEqual({x: 1920 - 665 - 171, y: 1149});
  });

  it('top/bottom centre horizontally near the top', () => {
    const o = menuOrigin(1920, 2560, 'top', 700, 1000);
    expect(o.x).toBe(Math.round(1920 * 0.5 - 350));
    expect(o.y).toBe(Math.round(2560 * 0.12));
  });

  it('never places the window off-screen', () => {
    const o = menuOrigin(800, 600, 'left', 900, 700); // window > screen
    expect(o.x).toBe(0);
    expect(o.y).toBe(0);
  });
});

describe('PANEL / applyScreenSize (mutating defaults — tested last)', () => {
  it('keeps the fallback when no screen size is known', () => {
    const before = {...PANEL};
    applyScreenSize(undefined, undefined);
    expect(PANEL).toEqual(before);
    expect(MENU.width).toBe(665);
  });

  it('sets the open width to 80% of the screen, centred', () => {
    applyScreenSize(1920, 2560);
    expect(PANEL.width).toBe(1536);
    expect(PANEL.x).toBe(192);
    // Height only ever SHRINKS toward 60% of the screen.
    expect(PANEL.height).toBeLessThanOrEqual(Math.round(2560 * 0.6));
  });
});
