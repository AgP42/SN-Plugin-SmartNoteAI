import {
  QUICK_ACTIONS,
  DEFAULT_QUICK_ACTIONS,
  resolveQuickActions,
} from './quickActions';

describe('QUICK_ACTIONS', () => {
  it('has unique ids and non-empty labels/prompts', () => {
    const ids = QUICK_ACTIONS.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of QUICK_ACTIONS) {
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.prompt.length).toBeGreaterThan(0);
    }
  });
  it('is the generalist trio: summarize, explain, translate (v0.76.1)', () => {
    expect(QUICK_ACTIONS.map(a => a.id)).toEqual([
      'summary',
      'explain',
      'translate',
    ]);
  });
  it('no prompt hard-codes "this page" (context is scope-agnostic)', () => {
    for (const a of QUICK_ACTIONS) {
      expect(a.prompt.toLowerCase()).not.toContain('this page');
    }
  });
});

describe('resolveQuickActions', () => {
  it('falls back to the defaults only when nothing saved (v0.88: [] is deliberate)', () => {
    expect(resolveQuickActions(undefined)).toBe(DEFAULT_QUICK_ACTIONS);
    // An explicitly EMPTIED list round-trips as empty — the sanitizer no
    // longer resurrects the defaults at the next boot (audit 2026-07-30).
    expect(resolveQuickActions([])).toEqual([]);
  });
  it('keeps valid saved actions and drops malformed ones', () => {
    const saved = [
      {label: 'A', prompt: 'pa', enabled: true},
      {label: 3 as unknown as string, prompt: 'x', enabled: true}, // bad
      {label: 'B', prompt: 'pb', enabled: false},
    ];
    expect(resolveQuickActions(saved)).toEqual([
      {label: 'A', prompt: 'pa', enabled: true},
      {label: 'B', prompt: 'pb', enabled: false},
    ]);
  });
  it('caps at 12', () => {
    const many = Array.from({length: 20}, (_, i) => ({
      label: `L${i}`,
      prompt: `p${i}`,
      enabled: true,
    }));
    expect(resolveQuickActions(many)).toHaveLength(12);
  });
});
