// Shared theme helpers. maskKey guards what the config screen shows of
// the API key; makeTheme must actually follow the Appearance scales.

import {maskKey, makeTheme, theme} from './theme';

describe('maskKey', () => {
  it('fully masks short keys (nothing recoverable)', () => {
    expect(maskKey('')).toBe('••••');
    expect(maskKey('12345678')).toBe('••••');
  });

  it('shows only 4 leading + 2 trailing chars of a real key', () => {
    expect(maskKey('sk-abcdefghijklmnop')).toBe('sk-a••••op');
  });
});

describe('makeTheme', () => {
  it('scales fonts with `scale` and paddings with `btnScale`', () => {
    const t = makeTheme(2, 3);
    expect(t.title.fontSize).toBe(40); // 20 × 2
    expect(t.chip.paddingHorizontal).toBe(36); // 12 × 3
    expect(t.chip.paddingVertical).toBe(21); // 7 × 3
  });

  it('the default export is the unscaled theme', () => {
    expect(theme.title.fontSize).toBe(20);
    expect(theme.chip.paddingHorizontal).toBe(12);
  });
});
