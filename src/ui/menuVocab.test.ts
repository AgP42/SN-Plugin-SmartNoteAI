// The hub menu vocabulary is defined ONCE (collecte 2026-08-03: Bubble and
// App each hardcoded the list and three subtitles had drifted).

import {MENU_VOCAB, buildMenuItems, type MenuAction} from './menuVocab';

describe('menu vocabulary', () => {
  it('six entries, unique keys and labels', () => {
    expect(MENU_VOCAB.length).toBe(6);
    const keys = MENU_VOCAB.map(v => v.key);
    const labels = MENU_VOCAB.map(v => v.label);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('every entry has a non-empty subtitle', () => {
    for (const v of MENU_VOCAB) {
      expect(v.sub.length).toBeGreaterThan(0);
    }
  });

  it('buildMenuItems wires each handler to its own entry, in vocab order', () => {
    const calls: MenuAction[] = [];
    const h = (k: MenuAction) => () => calls.push(k);
    const items = buildMenuItems({
      assistant: h('assistant'),
      library: h('library'),
      currentDoc: h('currentDoc'),
      currentPage: h('currentPage'),
      config: h('config'),
      guide: h('guide'),
    });
    expect(items.map(i => i.label)).toEqual(MENU_VOCAB.map(v => v.label));
    items.forEach(i => i.onPress());
    expect(calls).toEqual(MENU_VOCAB.map(v => v.key));
  });
});
