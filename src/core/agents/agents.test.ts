import {
  MAX_AGENTS,
  DEFAULT_LASSO_DIRECTIVE,
  DEFAULT_IMAGE_QUICK_ACTIONS,
  MAX_IMAGE_QUICK_ACTIONS,
  sanitizeAgents,
  isUnderDocRef,
  resolveAgentDocs,
  resolveAgentDocPages,
  composeAgentDocsSection,
  estimateAgentCost,
  type Agent,
} from './agents';

describe('lasso mode (v0.81)', () => {
  it('ships a non-empty default directive', () => {
    expect(DEFAULT_LASSO_DIRECTIVE.length).toBeGreaterThan(40);
  });
  it('ships one default image quick action (fresh array each call)', () => {
    const a = DEFAULT_IMAGE_QUICK_ACTIONS();
    const b = DEFAULT_IMAGE_QUICK_ACTIONS();
    expect(a).toHaveLength(1);
    expect(a[0].enabled).toBe(true);
    expect(a).not.toBe(b); // not a shared mutable ref
    expect(MAX_IMAGE_QUICK_ACTIONS).toBe(3);
  });
});

describe('resolveAgentDocPages (page-scoped agent context)', () => {
  const base: Agent = {id: 'a', name: 'A', icon: '', persona: '', model: '', docs: []};
  const store = ['/N/one.note', '/N/two.note', '/N/gone.note'];
  it('returns page-scoped paths present in the store, sorted', () => {
    const a: Agent = {...base, docPages: {'/N/two.note': [2, 0], '/N/one.note': [1]}};
    expect(resolveAgentDocPages(a, store)).toEqual([
      {path: '/N/one.note', pages: [1]},
      {path: '/N/two.note', pages: [2, 0]},
    ]);
  });
  it('drops a path already covered whole via docs (superset)', () => {
    const a: Agent = {...base, docs: ['/N/one.note'], docPages: {'/N/one.note': [3]}};
    expect(resolveAgentDocPages(a, store)).toEqual([]);
  });
  it('drops a path no longer in the store', () => {
    const a: Agent = {...base, docPages: {'/N/missing.note': [0]}};
    expect(resolveAgentDocPages(a, store)).toEqual([]);
  });
  it('folder ref in docs covers a page-scoped note under it', () => {
    const a: Agent = {...base, docs: ['/N'], docPages: {'/N/two.note': [1]}};
    expect(resolveAgentDocPages(a, store)).toEqual([]);
  });
});

describe('sanitizeAgents docPages', () => {
  it('keeps valid page arrays, dedupes/sorts, drops garbage', () => {
    const [a] = sanitizeAgents([
      {
        id: 'a',
        name: 'A',
        docs: [],
        docPages: {'/N/x.note': [2, 0, 2, -1, 1.5, 'z'], '/N/y.note': [], '': [0]},
      },
    ]);
    expect(a.docPages).toEqual({'/N/x.note': [0, 2]});
  });
});

describe('PRESET_AGENTS (starter presets)', () => {
  const {PRESET_AGENTS} = require('./agents');
  it('are 4 well-formed, distinct agents that survive sanitize', () => {
    expect(PRESET_AGENTS).toHaveLength(4);
    const ids = PRESET_AGENTS.map((p: {id: string}) => p.id);
    expect(new Set(ids).size).toBe(4);
    const kept = sanitizeAgents(PRESET_AGENTS);
    expect(kept).toHaveLength(4);
    for (const p of PRESET_AGENTS) {
      expect(p.name.trim().length).toBeGreaterThan(0);
      expect(p.model.length).toBeGreaterThan(0);
      expect(p.persona.length).toBeGreaterThan(20);
      expect(p.quickActions.length).toBeGreaterThan(0);
      expect(['precise', 'balanced', 'creative']).toContain(p.answerStyle);
    }
  });
  it('are English-first (no leftover French quick-action labels)', () => {
    const labels = PRESET_AGENTS.flatMap((p: {quickActions: {label: string}[]}) =>
      p.quickActions.map(q => q.label),
    ).join(' | ');
    expect(labels).not.toMatch(/Reformuler|Rédiger|idées|Titres|révision/);
  });
});

describe('sanitizeAgents', () => {
  it('drops garbage and caps at MAX_AGENTS', () => {
    const raw = [
      {id: 'a', name: 'Coach', icon: '🎓', persona: 'p', model: 'm', docs: ['/N/a.note']},
      {id: '', name: 'bad'},
      {id: 'b', name: '  ', docs: []},
      null,
      {id: 'c', name: 'C', docs: ['/N', 42, '']},
      // more valid agents than the cap allows
      ...Array.from({length: MAX_AGENTS + 2}, (_, i) => ({
        id: `x${i}`,
        name: `X${i}`,
        docs: [],
      })),
    ];
    const out = sanitizeAgents(raw);
    expect(out.length).toBe(MAX_AGENTS); // capped
    expect(out[0].id).toBe('a');
    expect(out[1].id).toBe('c'); // '', blank-name and null dropped before it
    expect(out[1].docs).toEqual(['/N']); // non-strings filtered
    expect(out[1].icon).toBe(''); // defaults, never undefined
  });
  it('returns [] for non-arrays', () => {
    expect(sanitizeAgents(undefined)).toEqual([]);
    expect(sanitizeAgents({})).toEqual([]);
  });

  it('v0.59 per-agent overrides: valid ones kept, garbage dropped, absent = inherit', () => {
    const out = sanitizeAgents([
      {
        id: 'a',
        name: 'A',
        docs: [],
        answerStyle: 'precise',
        quickActions: [
          {label: 'Sum', prompt: 'Summarize', enabled: true},
          {label: 3, prompt: 'bad', enabled: true}, // dropped
        ],
      },
      {id: 'b', name: 'B', docs: [], answerStyle: 'loud', quickActions: 'nope'},
      {id: 'c', name: 'C', docs: []},
    ]);
    expect(out[0].answerStyle).toBe('precise');
    expect(out[0].quickActions).toEqual([
      {label: 'Sum', prompt: 'Summarize', enabled: true},
    ]);
    // Invalid values sanitize to ABSENT (inherit), never crash:
    expect(out[1].answerStyle).toBeUndefined();
    expect(out[1].quickActions).toBeUndefined();
    expect(out[2].answerStyle).toBeUndefined();
    expect(out[2].quickActions).toBeUndefined();
  });
});

describe('isUnderDocRef (live folder semantics)', () => {
  it('matches exact paths and folder prefixes on the / boundary', () => {
    expect(isUnderDocRef('/Note/W/a.note', '/Note/W/a.note')).toBe(true);
    expect(isUnderDocRef('/Note/Work', '/Note/Work/a.note')).toBe(true);
    expect(isUnderDocRef('/Note/Work/', '/Note/Work/deep/b.note')).toBe(true);
    // NOT a prefix match on names ("Workshop" ≠ "Work" folder):
    expect(isUnderDocRef('/Note/Work', '/Note/Workshop.note')).toBe(false);
  });
});

describe('resolveAgentDocs', () => {
  it('resolves folders LIVE against the store and sorts', () => {
    const store = ['/N/W/b.note', '/N/W/a.note', '/N/x.pdf', '/Other/c.note'];
    expect(resolveAgentDocs(['/N/W', '/N/x.pdf'], store)).toEqual([
      '/N/W/a.note',
      '/N/W/b.note',
      '/N/x.pdf',
    ]);
  });
});


describe('composeAgentDocsSection', () => {
  it('is deterministic: sorted by (path, page), 1-indexed labels', () => {
    const out = composeAgentDocsSection([
      {path: '/N/b.note', name: 'B', page: 0, text: 'bb'},
      {path: '/N/a.note', name: 'A', page: 2, text: ' aa '},
      {path: '/N/a.note', name: 'A', page: 0, text: 'a0'},
    ]);
    const iA0 = out.indexOf('--- Agent doc: "A" p.1 ---\na0');
    const iA2 = out.indexOf('--- Agent doc: "A" p.3 ---\naa');
    const iB = out.indexOf('--- Agent doc: "B" p.1 ---\nbb');
    expect(iA0).toBeGreaterThan(-1);
    expect(iA0).toBeLessThan(iA2);
    expect(iA2).toBeLessThan(iB);
  });
  it('empty when no block has text', () => {
    expect(
      composeAgentDocsSection([{path: '/n', name: 'n', page: 0, text: ' '}]),
    ).toBe('');
  });
});

describe('estimateAgentCost', () => {
  it('tokens = chars/4; first msg at list price, next at 10%', () => {
    // 400k chars ≈ 100k tokens on Large (0.44 €/M in) → 4.4 c€ / 0.44 c€.
    const e = estimateAgentCost(400_000, 0.44);
    expect(e.tokens).toBe(100_000);
    expect(e.firstMsgCents).toBeCloseTo(4.4);
    expect(e.nextMsgCents).toBeCloseTo(0.44);
  });
  it('unknown price: tokens only', () => {
    const e = estimateAgentCost(4000, undefined);
    expect(e).toEqual({tokens: 1000});
  });
});
