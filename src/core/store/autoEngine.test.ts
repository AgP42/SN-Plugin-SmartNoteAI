import {
  cycleMode,
  isAutoFolderKey,
  resolveAutoTarget,
  effectiveMode,
  sanitizeAutoTargets,
  modeLabel,
  DEFAULT_MODE,
  type AutoTarget,
} from './autoEngine';

describe('cycleMode / modeLabel', () => {
  it('Mode: Off → Manual → Auto → Off', () => {
    expect(cycleMode('off')).toBe('manual');
    expect(cycleMode('manual')).toBe('auto');
    expect(cycleMode('auto')).toBe('off');
  });
  it('labels', () => {
    expect(modeLabel('off')).toBe('Off');
    expect(modeLabel('manual')).toBe('Manual');
    expect(modeLabel('auto')).toBe('Auto');
  });
  it('default mode is Manual', () => {
    expect(DEFAULT_MODE).toBe('manual');
  });
});

describe('isAutoFolderKey', () => {
  it('folders vs files', () => {
    expect(isAutoFolderKey('/Note/Pro')).toBe(true);
    expect(isAutoFolderKey('/Note/Pro/a.note')).toBe(false);
    expect(isAutoFolderKey('/Doc/b.PDF')).toBe(false);
  });
});

describe('resolveAutoTarget / effectiveMode', () => {
  const map: Record<string, AutoTarget> = {
    '/Note/Pro': {mode: 'auto'},
    '/Note/Pro/Sub': {mode: 'manual'},
    '/Note/Pro/x.note': {mode: 'off'},
  };
  it('own entry wins', () => {
    expect(resolveAutoTarget(map, '/Note/Pro/x.note')).toEqual({mode: 'off'});
    expect(effectiveMode(map, '/Note/Pro/x.note')).toBe('off');
  });
  it('nearest ancestor folder wins', () => {
    expect(resolveAutoTarget(map, '/Note/Pro/y.note')).toEqual({mode: 'auto'});
    expect(effectiveMode(map, '/Note/Pro/Sub/z.note')).toBe('manual');
  });
  it('untracked → null, effective falls back to the default (Manual)', () => {
    expect(resolveAutoTarget(map, '/Note/Perso/a.note')).toBeNull();
    expect(effectiveMode(map, '/Note/Perso/a.note')).toBe('manual');
    expect(
      resolveAutoTarget({'/Note/Pro': {mode: 'auto'}}, '/Note/Project/a.note'),
    ).toBeNull();
  });
});

describe('sanitizeAutoTargets', () => {
  it('keeps only well-formed {mode} targets, drops legacy/invalid', () => {
    expect(
      sanitizeAutoTargets({
        '/a.note': {mode: 'auto'},
        '/b.note': {mode: 'nope'},
        '/c.note': {mode: 'off', power: 'smart'}, // extra legacy key ignored
        '': {mode: 'auto'},
        '/d': {mode: 'manual'},
      }),
    ).toEqual({
      '/a.note': {mode: 'auto'},
      '/c.note': {mode: 'off'},
      '/d': {mode: 'manual'},
    });
    expect(sanitizeAutoTargets(null)).toEqual({});
  });
});
