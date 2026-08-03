// Library search tests (moved from transcriptStore.test.ts in v0.36 with
// the engine itself; the old searchLibrary is expressed as ONE 'contains'
// criterion of the advanced engine).
import {searchLibraryAdvanced} from './librarySearch';
import {emptyStore, upsertPage, type PageEntry, type Store} from './transcriptStore';

const entry = (text: string, over: Partial<PageEntry> = {}): PageEntry => ({
  text,
  source: 'medium',
  at: 1000,
  hash: '5',
  ...over,
});

const base = (s: Store, q: string) =>
  searchLibraryAdvanced(s, [{type: 'contains', value: q}]);

describe('base search = one contains criterion (v0.36)', () => {
  const build = () => {
    const s = emptyStore();
    upsertPage(s, '/Note/Pro/Pelican.note', 0, entry('Backtest SOL entry 14.06 gain +12€'), 1);
    upsertPage(s, '/Note/Pro/Pelican.note', 2, entry('Réunion avec Wolfgang sur le TGV-M'), 1);
    upsertPage(s, '/Note/Perso/Cook.note', 0, entry('Recette de pancakes aux amandes'), 1);
    upsertPage(s, '/Note/Pro/Empty.note', 0, entry('   '), 1); // empty → ignored
    return s;
  };
  it('finds pages containing all terms, accent-insensitive', () => {
    const r = base(build(), 'reunion wolfgang');
    expect(r).toHaveLength(1);
    expect(r[0].path).toBe('/Note/Pro/Pelican.note');
    expect(r[0].page).toBe(2);
    expect(r[0].snippet).toContain('Wolfgang');
  });
  it('AND semantics: a missing term drops the page', () => {
    expect(base(build(), 'pancakes tgv')).toHaveLength(0);
    expect(base(build(), 'pancakes amandes')).toHaveLength(1);
  });
  it('ignores empty pages and too-short queries', () => {
    expect(base(build(), 'a')).toEqual([]);
    expect(base(build(), 'zzz')).toEqual([]);
  });
  it('ranks by occurrence count', () => {
    const s = emptyStore();
    upsertPage(s, '/a.note', 0, entry('sol sol sol'), 1);
    upsertPage(s, '/b.note', 0, entry('sol once'), 1);
    const r = base(s, 'sol');
    expect(r[0].path).toBe('/a.note');
  });
  it('exposes `terms` (highlight) and `at` on hits', () => {
    const r = base(build(), 'reunion wolfgang');
    expect(r[0].terms).toEqual(['reunion', 'wolfgang']);
    expect(r[0].at).toBe(1000);
  });
});

describe('searchLibraryAdvanced — multi-criteria (v0.25.9)', () => {
  const build = () => {
    const s = emptyStore();
    upsertPage(
      s,
      '/Note/Pro/Budget.note',
      0,
      entry('Réunion budget Q1 avec Wolfgang', {source: 'user', at: 30}),
      1,
    );
    upsertPage(
      s,
      '/Note/Pro/Budget.note',
      1,
      entry('Note de frais Q2, brouillon à revoir', {source: 'improved', at: 20}),
      1,
    );
    upsertPage(
      s,
      '/Note/Perso/Cook.note',
      0,
      entry('Recette pancakes budget serré', {source: 'mistral-ocr', at: 10}),
      1,
    );
    return s;
  };

  it('ANDs criteria across the SAME page', () => {
    // "budget" AND phrase "Q1" only on Budget p0
    const r = searchLibraryAdvanced(build(), [
      {type: 'contains', value: 'budget'},
      {type: 'phrase', value: 'q1'},
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].page).toBe(0);
  });

  it('any = OR within a row', () => {
    const r = searchLibraryAdvanced(build(), [{type: 'any', value: 'q1 q2'}]);
    expect(r.map(h => h.page).sort()).toEqual([0, 1]);
  });

  it('exclude drops pages that contain the word', () => {
    const r = searchLibraryAdvanced(build(), [
      {type: 'contains', value: 'budget'},
      {type: 'exclude', value: 'brouillon pancakes'},
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].path).toBe('/Note/Pro/Budget.note');
    expect(r[0].page).toBe(0);
  });

  it('folder / notebook scope filters', () => {
    expect(
      searchLibraryAdvanced(build(), [
        {type: 'contains', value: 'budget'},
        {type: 'folder', value: 'Perso'},
      ]).map(h => h.page),
    ).toEqual([0]); // only Cook.note (Perso) has "budget"
    expect(
      searchLibraryAdvanced(build(), [
        {type: 'contains', value: 'budget'},
        {type: 'notebook', value: 'Cook'},
      ]),
    ).toHaveLength(1);
  });

  it('source category filter (manual / ai)', () => {
    const only = (cat: string) =>
      searchLibraryAdvanced(build(), [
        {type: 'contains', value: 'budget'},
        {type: 'source', value: cat},
      ]);
    expect(only('manual').map(h => h.source)).toEqual(['user']);
    expect(only('ai').map(h => h.source)).toEqual(['mistral-ocr']);
  });

  it('sorts by date and by notebook', () => {
    const byDate = searchLibraryAdvanced(
      build(),
      [{type: 'contains', value: 'budget'}],
      {sort: 'date'},
    );
    expect(byDate.map(h => h.at)).toEqual([30, 10]); // newest first
    const byNb = searchLibraryAdvanced(
      build(),
      [{type: 'contains', value: 'budget'}],
      {sort: 'notebook'},
    );
    expect(byNb.map(h => h.name)).toEqual(['Budget.note', 'Cook.note']);
  });

  it('empty / all-blank criteria return nothing', () => {
    expect(searchLibraryAdvanced(build(), [])).toEqual([]);
    expect(
      searchLibraryAdvanced(build(), [{type: 'contains', value: '  '}]),
    ).toEqual([]);
  });

  it('caps at 10 criteria', () => {
    const many = Array.from({length: 15}, () => ({
      type: 'contains' as const,
      value: 'budget',
    }));
    // Still valid (all identical), just proves it does not throw on >10.
    expect(searchLibraryAdvanced(build(), many).length).toBeGreaterThan(0);
  });
});

describe('v0.37 criteria: type / starred / keyword / dates / meta hits', () => {
  const build = () => {
    const s = emptyStore();
    upsertPage(s, '/Note/Pro/Plan.note', 0, entry('budget projet alpha', {at: 100}), 1);
    upsertPage(s, '/Document/spec.pdf', 0, entry('budget spec beta', {at: 200}), 1);
    const doc = s.docs['/Note/Pro/Plan.note'];
    doc.stars = [0, 3];
    doc.kws = [
      {p: 0, t: 'R&D PM Certification'},
      {p: 5, t: 'Budget review'},
    ];
    return s;
  };

  it('type:note / type:pdf filter by origin', () => {
    const note = searchLibraryAdvanced(build(), [
      {type: 'contains', value: 'budget'},
      {type: 'doctype', value: 'note'},
    ]);
    expect(note.map(h => h.path)).toEqual(['/Note/Pro/Plan.note']);
    const pdf = searchLibraryAdvanced(build(), [
      {type: 'contains', value: 'budget'},
      {type: 'doctype', value: 'pdf'},
    ]);
    expect(pdf.map(h => h.path)).toEqual(['/Document/spec.pdf']);
  });

  it('starred:yes keeps starred pages; starred:no drops them', () => {
    const yes = searchLibraryAdvanced(build(), [
      {type: 'contains', value: 'budget'},
      {type: 'starred', value: 'yes'},
    ]);
    expect(yes.map(h => [h.path, h.page])).toEqual([['/Note/Pro/Plan.note', 0]]);
    const no = searchLibraryAdvanced(build(), [
      {type: 'contains', value: 'budget'},
      {type: 'starred', value: 'no'},
    ]);
    expect(no.map(h => h.path)).toEqual(['/Document/spec.pdf']);
  });

  it('keyword matches the Supernote keyword text, accent/case-insensitive', () => {
    const r = searchLibraryAdvanced(build(), [
      {type: 'contains', value: 'budget'},
      {type: 'keyword', value: 'certification'},
    ]);
    expect(r.map(h => h.page)).toEqual([0]);
    expect(
      searchLibraryAdvanced(build(), [
        {type: 'contains', value: 'budget'},
        {type: 'keyword', value: 'inexistant'},
      ]),
    ).toEqual([]);
  });

  it('after/before filter on the read date; invalid date matches nothing', () => {
    const s = build();
    const both = [{type: 'contains', value: 'budget'} as const];
    expect(
      searchLibraryAdvanced(s, [...both, {type: 'after', value: '1970-01-01'}]),
    ).toHaveLength(2);
    expect(
      searchLibraryAdvanced(s, [...both, {type: 'before', value: '1970-01-01'}]),
    ).toHaveLength(0);
    expect(
      searchLibraryAdvanced(s, [...both, {type: 'after', value: 'garbage'}]),
    ).toHaveLength(0);
    // Out-of-range parts must NOT roll over (2026-13 used to become
    // Jan 2027 via Date.UTC — a WRONG result instead of a visible empty
    // one; audit 2026-07-18).
    expect(
      searchLibraryAdvanced(s, [...both, {type: 'after', value: '2026-13'}]),
    ).toHaveLength(0);
    expect(
      searchLibraryAdvanced(s, [...both, {type: 'before', value: '2026-06-31'}]),
    ).toHaveLength(0);
  });

  it('META hits: star:/kw: surface UNREAD pages when no text criterion', () => {
    const r = searchLibraryAdvanced(build(), [{type: 'starred', value: 'yes'}]);
    const pages = r.map(h => [h.page, h.snippet] as [number, string]);
    // p0 has a transcript (normal hit); p3 is starred but unread (meta hit).
    expect(r).toHaveLength(2);
    expect(pages.find(([p]) => p === 3)![1]).toContain('(not read yet)');
    expect(pages.find(([p]) => p === 3)![1]).toContain('★');
    // kw: also surfaces the unread keyword page 5, with the keyword text.
    const k = searchLibraryAdvanced(build(), [{type: 'keyword', value: 'review'}]);
    expect(k.map(h => h.page)).toEqual([5]);
    expect(k[0].snippet).toContain('Budget review');
    // …but adding a text criterion disables meta hits (unread can't match).
    const t = searchLibraryAdvanced(build(), [
      {type: 'starred', value: 'yes'},
      {type: 'contains', value: 'budget'},
    ]);
    expect(t.map(h => h.page)).toEqual([0]);
  });
});

describe('p: and approx: operators (v0.64)', () => {
  const {emptyStore, upsertPage, makePageEntry} = jest.requireActual(
    './transcriptStore',
  );
  const mk = () => {
    const s = emptyStore();
    const now = 1;
    upsertPage(s, '/Note/A.note', 0, makePageEntry('le bag list du projet', 'medium', {hash: ''}, now), now);
    upsertPage(s, '/Note/A.note', 7, makePageEntry('page huit contenu Café', 'medium', {hash: ''}, now), now);
    return s;
  };

  it('page criterion matches the 1-based page only', () => {
    const hits = searchLibraryAdvanced(mk(), [
      {type: 'contains', value: 'contenu'},
      {type: 'page', value: '8'},
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].page).toBe(7);
    expect(
      searchLibraryAdvanced(mk(), [
        {type: 'contains', value: 'contenu'},
        {type: 'page', value: '3'},
      ]),
    ).toHaveLength(0);
  });

  it('approx matches within edit distance 1 (bug → bag), accent/case-free', () => {
    const hits = searchLibraryAdvanced(mk(), [{type: 'approx', value: 'bug'}]);
    expect(hits).toHaveLength(1);
    expect(hits[0].page).toBe(0);
    // CAFE matches Café via deaccent + exact (distance 0).
    expect(
      searchLibraryAdvanced(mk(), [{type: 'approx', value: 'CAFE'}]),
    ).toHaveLength(1);
    // Too far (distance 2 on a short word) → no hit.
    expect(
      searchLibraryAdvanced(mk(), [{type: 'approx', value: 'bxy'}]),
    ).toHaveLength(0);
  });
});
