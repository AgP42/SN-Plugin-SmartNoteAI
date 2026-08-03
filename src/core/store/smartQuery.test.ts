import {parseSmartQuery} from './smartQuery';

describe('parseSmartQuery — page operators (v0.75)', () => {
  it('p:N stays an explicit 1-based page', () => {
    expect(parseSmartQuery('p:8').criteria).toEqual([{type: 'page', value: '8'}]);
  });
  it('p:first / p:last are keyword page criteria', () => {
    expect(parseSmartQuery('p:first').criteria).toEqual([
      {type: 'page', value: 'first'},
    ]);
    expect(parseSmartQuery('p:LAST').criteria).toEqual([
      {type: 'page', value: 'last'},
    ]);
  });
  it('a bad page value is not a criterion', () => {
    expect(parseSmartQuery('p:0').criteria).toEqual([]);
    expect(parseSmartQuery('p:foo').criteria).toEqual([]);
  });
});

describe('parseSmartQuery — the v0.37 grammar', () => {
  it('bare words fold into ONE contains criterion (AND)', () => {
    const q = parseSmartQuery('budget q1');
    expect(q.criteria).toEqual([{type: 'contains', value: 'budget q1'}]);
    expect(q.interpretation).toContain('all of: budget q1');
  });

  it("accepts '+' AND spaces as separators (user decision)", () => {
    expect(parseSmartQuery('budget+q1').criteria).toEqual(
      parseSmartQuery('budget q1').criteria,
    );
    expect(parseSmartQuery('f:Perso+budget').criteria).toEqual([
      {type: 'folder', value: 'Perso'},
      {type: 'contains', value: 'budget'},
    ]);
  });

  it('quoted phrases, negated words and negated phrases', () => {
    const q = parseSmartQuery('"note de frais" !brouillon !"pas cette phrase"');
    expect(q.criteria).toEqual([
      {type: 'phrase', value: 'note de frais'},
      {type: 'exclude', value: 'brouillon'},
      {type: 'excludePhrase', value: 'pas cette phrase'},
    ]);
  });

  it('quotes protect + and spaces inside values', () => {
    const q = parseSmartQuery('f:"Tasks and Projects" "a+b"');
    expect(q.criteria).toEqual([
      {type: 'folder', value: 'Tasks and Projects'},
      {type: 'phrase', value: 'a+b'},
    ]);
  });

  it('a|b|c becomes an any (OR) criterion', () => {
    expect(parseSmartQuery('chat|chien|oiseau').criteria).toEqual([
      {type: 'any', value: 'chat chien oiseau'},
    ]);
  });

  it('prefixes: f/n/type/star/kw/src/after/before', () => {
    const q = parseSmartQuery(
      'f:Perso n:ToDo type:note star: kw:certif src:manual after:2026-06 before:2026-07-15',
    );
    expect(q.criteria).toEqual([
      {type: 'folder', value: 'Perso'},
      {type: 'notebook', value: 'ToDo'},
      {type: 'doctype', value: 'note'},
      {type: 'starred', value: 'yes'},
      {type: 'keyword', value: 'certif'},
      {type: 'source', value: 'manual'},
      {type: 'after', value: '2026-06'},
      {type: 'before', value: '2026-07-15'},
    ]);
  });

  it('star:no and type:pdf variants', () => {
    expect(parseSmartQuery('star:no type:pdf').criteria).toEqual([
      {type: 'starred', value: 'no'},
      {type: 'doctype', value: 'pdf'},
    ]);
  });

  it('sort: is a setting, not a criterion', () => {
    const q = parseSmartQuery('budget sort:date');
    expect(q.sort).toBe('date');
    expect(q.criteria).toEqual([{type: 'contains', value: 'budget'}]);
    expect(parseSmartQuery('x sort:note').sort).toBe('notebook');
  });

  it('unknown prefix falls back to a plain word (visible in the echo)', () => {
    const q = parseSmartQuery('flder:Perso budget');
    expect(q.criteria).toEqual([
      {type: 'contains', value: 'flder:Perso budget'},
    ]);
    expect(q.interpretation).toContain('flder:Perso');
  });

  it('bad type value is dropped with a hint, empty query yields nothing', () => {
    const q = parseSmartQuery('type:docx');
    expect(q.criteria).toEqual([]);
    expect(q.interpretation).toContain('type:?');
    expect(parseSmartQuery('   ').criteria).toEqual([]);
  });
});
