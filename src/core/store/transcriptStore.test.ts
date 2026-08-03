import {
  isPageLocked,
  setPageLock,
  sanitizeDocEntry,
  type Store,
  setDocLock,
  isDocLocked,
  removeDoc,
  sweepEphemeralPages,
  emptyStore,
  serializeStore,
  getPage,
  isPageValid,
  upsertPage,
  setDocHash,
  getDocHash,
  provenanceFor,
  docsSummary,
  pagesOfDoc,
  remapDocPages,
  setPageIds,
  setStamp,
  getStamp,
  docPageCount,
  pageNeedsRead,
  type PageEntry,
  buildPageIdDonors,
  adoptPdfDoc,
  clearDocRespectingLocks,
  clearLimbo,
  limboSize,
} from './transcriptStore';

beforeEach(() => {
  clearLimbo(); // module-level parked drops must not leak between tests
});

const entry = (text: string, over: Partial<PageEntry> = {}): PageEntry => ({
  text,
  source: 'medium',
  at: 1000,
  hash: '5',
  ...over,
});


describe('isPageValid', () => {
  it('rejects null, empty text, and hash mismatches', () => {
    expect(isPageValid(null, '5')).toBe(false);
    expect(isPageValid(entry('   '), '5')).toBe(false);
    expect(isPageValid(entry('ok', {hash: '5'}), '6')).toBe(false);
  });
  it('accepts matching or unknown hashes', () => {
    expect(isPageValid(entry('ok', {hash: '5'}), '5')).toBe(true);
    expect(isPageValid(entry('ok', {hash: '5'}), '')).toBe(true); // caller has no signal
    expect(isPageValid(entry('ok', {hash: ''}), '7')).toBe(true); // entry stored without one
  });
});

describe('doc-level state', () => {
  it('tracks docHash per doc', () => {
    const s = emptyStore();
    setDocHash(s, '/d.pdf', '12345');
    expect(getDocHash(s, '/d.pdf')).toBe('12345');
    expect(getDocHash(s, '/other.pdf')).toBe('');
  });
});


describe('library browser helpers', () => {
  it('summarises docs, grouped-sortable by folder; empty entries count as unread (v0.23)', () => {
    const s = emptyStore();
    upsertPage(s, '/Note/Perso/Pelican.note', 2, entry('x'), 5);
    upsertPage(s, '/Note/Perso/Pelican.note', 0, entry('y'), 6);
    upsertPage(s, '/Note/Pro/Work.note', 1, entry('  '), 7); // no text: unread
    const sum = docsSummary(s);
    expect(sum).toHaveLength(2);
    expect(sum[0]).toMatchObject({
      name: 'Pelican.note',
      folder: '/Note/Perso',
      pages: 2,
      read: 2,
      total: 3,
    });
    // A structurally-known doc whose only entry is BLANK stays visible,
    // and counts as READ (v0.37.2): a page read-but-blank is done, not
    // pending — total(2) - read(1) = 1 unread, NOT 2.
    expect(sum[1]).toMatchObject({name: 'Work.note', pages: 0, read: 1, total: 2});
    expect(pagesOfDoc(s, '/Note/Perso/Pelican.note')).toEqual([0, 2]);
  });

});

describe('provenanceFor', () => {
  it('aggregates sources and counts missing pages', () => {
    const s = emptyStore();
    upsertPage(s, '/a.note', 0, entry('x', {source: 'medium'}), 1);
    upsertPage(s, '/a.note', 1, entry('y', {source: 'mistral-ocr'}), 1);
    upsertPage(s, '/a.note', 2, entry('  ', {source: 'medium'}), 1); // empty → missing
    const p = provenanceFor(s, '/a.note', [0, 1, 2, 3]);
    expect(p.covered.medium).toBe(1);
    expect(p.covered['mistral-ocr']).toBe(1);
    expect(p.missing).toBe(2);
  });
});

describe('remapDocPages (PAGEID identity, v0.22.4)', () => {
  const ID1 = 'P20260101000000000001aaaaaaaaaaaa';
  const ID2 = 'P20260101000000000002bbbbbbbbbbbb';
  const ID3 = 'P20260101000000000003cccccccccccc';

  it('shifts entries down when a page is deleted — no re-read needed', () => {
    const s = emptyStore();
    upsertPage(s, '/n.note', 0, entry('page A', {hash: ID1}), 1);
    upsertPage(s, '/n.note', 1, entry('page B', {hash: ID2}), 1);
    upsertPage(s, '/n.note', 2, entry('page C', {hash: ID3}), 1);
    // Page B (index 1) deleted on the device → current order: ID1, ID3.
    const r = remapDocPages(s, '/n.note', [ID1, ID3]);
    expect(r).toEqual({moved: 1, dropped: 1});
    expect(getPage(s, '/n.note', 0)?.text).toBe('page A');
    expect(getPage(s, '/n.note', 1)?.text).toBe('page C');
    expect(getPage(s, '/n.note', 2)).toBeNull();
    // And the remapped entry still validates against its id.
    expect(isPageValid(getPage(s, '/n.note', 1), ID3)).toBe(true);
  });

  it('handles insertion and reordering the same way', () => {
    const s = emptyStore();
    upsertPage(s, '/n.note', 0, entry('A', {hash: ID1}), 1);
    upsertPage(s, '/n.note', 1, entry('B', {hash: ID2}), 1);
    // New page inserted at the front, then B, then A (reordered).
    remapDocPages(s, '/n.note', [ID3, ID2, ID1]);
    expect(getPage(s, '/n.note', 0)).toBeNull(); // new page: not read yet
    expect(getPage(s, '/n.note', 1)?.text).toBe('B');
    expect(getPage(s, '/n.note', 2)?.text).toBe('A');
  });

  it('REFUSES to remap against a holed id list (partial footer parse, audit 2026-07-30)', () => {
    // A holed list is a partial parse, not a deletion: remapping against it
    // used to drop PAID entries whose pages still exist (only 'user' ones
    // were shielded), and the next tick re-billed them. Now the remap
    // refuses entirely — every entry ('user' AND paid) stays where it is,
    // and the next complete walk remaps for real.
    const s = emptyStore();
    upsertPage(s, '/n.note', 0, entry('A', {hash: ID1}), 1);
    upsertPage(s, '/n.note', 1, entry('fixed by hand', {hash: ID2, source: 'user'}), 1);
    upsertPage(s, '/n.note', 2, entry('C', {hash: ID3}), 1);
    const r = remapDocPages(s, '/n.note', [ID1, '', ID3]);
    expect(r).toEqual({dropped: 0, moved: 0, refused: true});
    expect(getPage(s, '/n.note', 1)?.text).toBe('fixed by hand');
    expect(getPage(s, '/n.note', 2)?.text).toBe('C'); // paid entry survives too
    // A machine entry in the same holed situation is no longer dropped.
    const s2 = emptyStore();
    upsertPage(s2, '/n.note', 1, entry('machine', {hash: ID2}), 1);
    upsertPage(s2, '/n.note', 0, entry('A', {hash: ID1}), 1);
    const r2 = remapDocPages(s2, '/n.note', [ID1, '', ID3]);
    expect(r2.dropped).toBe(0);
    expect(getPage(s2, '/n.note', 1)?.text).toBe('machine');
  });

  it('keeps legacy (non-id) entries at their index and is a no-op without ids', () => {
    const s = emptyStore();
    upsertPage(s, '/n.note', 0, entry('legacy', {hash: '12'}), 1);
    expect(remapDocPages(s, '/n.note', [ID1])).toEqual({moved: 0, dropped: 0});
    expect(getPage(s, '/n.note', 0)?.text).toBe('legacy');
    // Mixed: identity entry claims index 0, legacy is displaced → dropped.
    upsertPage(s, '/n.note', 1, entry('idd', {hash: ID1}), 1);
    const r = remapDocPages(s, '/n.note', [ID1]);
    expect(r.dropped).toBe(1);
    expect(getPage(s, '/n.note', 0)?.text).toBe('idd');
  });
});

describe('isPageValid — legacy hash vs known PAGEID (device bug 2026-07-12)', () => {
  const PID = 'P20260101000000000009zzzzzzzzzzzz';
  it('rejects empty/legacy hashes when a real PAGEID is expected', () => {
    expect(isPageValid(entry('old page 2', {hash: ''}), PID)).toBe(false);
    expect(isPageValid(entry('old page 2', {hash: '12'}), PID)).toBe(false);
    expect(isPageValid(entry('ok', {hash: PID}), PID)).toBe(true);
  });
  it('still accepts anything when the expected hash is unknown/legacy', () => {
    expect(isPageValid(entry('ok', {hash: ''}), '')).toBe(true);
    expect(isPageValid(entry('ok', {hash: ''}), '12')).toBe(true);
  });
});

describe('pageNeedsRead — in-place edit detection (v0.25.7)', () => {
  const PID = 'P20260101000000000009zzzzzzzzzzzz';
  const OTHER = 'P20260101000000000008zzzzzzzzzzzz';

  it('no entry / stale identity → must read', () => {
    expect(pageNeedsRead(null, PID, '100')).toBe(true);
    // A page was inserted before this one → entry's PAGEID no longer matches.
    expect(
      pageNeedsRead(
        entry('paid', {source: 'medium', hash: OTHER, rev: '100'}),
        PID,
        '100',
      ),
    ).toBe(true);
  });

  it('same page + unchanged content-rev → keep (no paid re-read)', () => {
    expect(
      pageNeedsRead(
        entry('paid', {source: 'medium', hash: PID, rev: '100'}),
        PID,
        '100',
      ),
    ).toBe(false);
  });

  it('same page but CHANGED content-rev → re-read (ink edited in place)', () => {
    expect(
      pageNeedsRead(
        entry('paid', {source: 'medium', hash: PID, rev: '100'}),
        PID,
        '260',
      ),
    ).toBe(true);
    expect(
      pageNeedsRead(
        entry('improved', {source: 'improved', hash: PID, rev: '100'}),
        PID,
        '260',
      ),
    ).toBe(true);
  });

  it('never re-reads on missing data (legacy entry, or footer read failed)', () => {
    // Entry stamped before v0.25.7 (no rev): don't churn the whole library.
    expect(
      pageNeedsRead(
        entry('paid', {source: 'medium', hash: PID, rev: undefined}),
        PID,
        '260',
      ),
    ).toBe(false);
    // Footer read failed → expectedRev undefined.
    expect(
      pageNeedsRead(
        entry('paid', {source: 'medium', hash: PID, rev: '100'}),
        PID,
        undefined,
      ),
    ).toBe(false);
  });

  // v0.94 (user decision 2026-08-02): a hand correction is no longer a
  // freeze. It IS re-read when the ink provably moved — that is what the
  // user asked for. The explicit LOCK is what freezes a page.
  it('re-reads a manual (user) correction when the ink PROVABLY changed', () => {
    expect(
      pageNeedsRead(
        entry('my fix', {source: 'user', hash: PID, rev: '100'}),
        PID,
        '260',
      ),
    ).toBe(true);
  });

  it('a LOCKED page is never re-read, whatever changed', () => {
    const locked = entry('my fix', {source: 'user', hash: PID, rev: '100'});
    locked.lock = true;
    expect(pageNeedsRead(locked, PID, '260')).toBe(false);
    // …and the whole-document lock does the same for an ordinary page.
    expect(
      pageNeedsRead(
        entry('paid', {source: 'medium', hash: PID, rev: '100'}),
        PID,
        '260',
        true,
      ),
    ).toBe(false);
  });

  it('does NOT re-read a correction on unknown stamps (footer glitch)', () => {
    // No proof of change = no overwrite: a 'user' entry saved while the
    // footer read failed carries hash '' and must survive.
    expect(
      pageNeedsRead(entry('my fix', {source: 'user', hash: '', rev: '100'}), PID, '260'),
    ).toBe(false);
    expect(
      pageNeedsRead(
        entry('my fix', {source: 'user', hash: PID, rev: '100'}),
        PID,
        undefined,
      ),
    ).toBe(false);
  });

  it('protects a user entry even with an empty hash when the PAGEID is known (audit 2026-07-17)', () => {
    // The exact bug: a manual edit saved while the footer read failed
    // carries hash '' — isPageValid calls it stale, but the user check
    // now runs FIRST, so Auto never overwrites the correction.
    expect(
      pageNeedsRead(entry('my fix', {source: 'user', hash: ''}), PID, '260'),
    ).toBe(false);
    expect(
      pageNeedsRead(
        entry('my fix', {source: 'user', hash: '', rev: '100'}),
        PID,
        '260',
      ),
    ).toBe(false);
  });

  it('PDF-like entry (empty PAGEID, no rev) → keep', () => {
    expect(
      pageNeedsRead(
        entry('pdf', {source: 'mistral-ocr', hash: '', rev: undefined}),
        '',
        undefined,
      ),
    ).toBe(false);
  });
});

// Test-local round-trip: serialize, then re-sanitize each doc — exactly
// what a shard reload does (parseStore itself was deleted in Lot 1).
const roundTrip = (json: string): Store => {
  const raw = JSON.parse(json) as {docs: Record<string, unknown>};
  const out = emptyStore();
  for (const [path, doc] of Object.entries(raw.docs)) {
    const clean = sanitizeDocEntry(doc);
    if (clean !== null) {
      out.docs[path] = clean;
    }
  }
  return out;
};

describe('sanitize round-trip preserves rev, drops a malformed one (v0.25.7)', () => {
  it('keeps a string rev and drops a non-string rev', () => {
    const s = emptyStore();
    upsertPage(s, '/a.note', 0, entry('p0', {rev: '4242'}), 1);
    expect(getPage(roundTrip(serializeStore(s)), '/a.note', 0)?.rev).toBe(
      '4242',
    );
    const raw = JSON.parse(serializeStore(s));
    raw.docs['/a.note'].pages['0'].rev = 999; // numeric → invalid
    expect(
      getPage(roundTrip(JSON.stringify(raw)), '/a.note', 0)?.rev,
    ).toBeUndefined();
  });
});

describe('structural tracking (v0.23): pageIds, stamp, low words', () => {
  const PID = (n: number) =>
    `P2026010100000000000${n}aaaaaaaaaaaa`.slice(0, 32);

  it('round-trips pageIds and stamp through parse/serialize', () => {
    const s = emptyStore();
    setPageIds(s, '/n.note', [PID(1), PID(2), PID(3)]);
    setStamp(s, '/n.note', '123456');
    const back = roundTrip(serializeStore(s));
    expect(back.docs['/n.note'].pageIds).toEqual([PID(1), PID(2), PID(3)]);
    expect(getStamp(back, '/n.note')).toBe('123456');
    expect(getStamp(back, '/other.note')).toBe('');
  });

  it('docPageCount = max(snapshot, highest entry index + 1)', () => {
    const s = emptyStore();
    expect(docPageCount(s, '/n.note')).toBe(0);
    setPageIds(s, '/n.note', [PID(1), PID(2), PID(3)]);
    expect(docPageCount(s, '/n.note')).toBe(3);
    upsertPage(s, '/n.note', 6, entry('late page'), 1);
    expect(docPageCount(s, '/n.note')).toBe(7);
  });

  it('docsSummary exposes total and keeps unread-only docs visible', () => {
    const s = emptyStore();
    setPageIds(s, '/dir/track.note', [PID(1), PID(2)]);
    const d = docsSummary(s).find(x => x.path === '/dir/track.note');
    expect(d).toBeDefined();
    expect(d?.pages).toBe(0);
    expect(d?.total).toBe(2);
  });

  it('docsSummary: a docHash-stamped PDF is pdfCovered (phantom backlog fix)', () => {
    // A one-call /v1/ocr read covers the WHOLE PDF; its text-less pages
    // (cover, pure images) get no entry by design — they must not count
    // as "to read" forever (device report 2026-07-18: "2 pages to sync"
    // that no Sync could ever drain).
    const s = emptyStore();
    upsertPage(s, '/d/pres.pdf', 0, entry('slide 1', {hash: ''}), 1);
    upsertPage(s, '/d/pres.pdf', 3, entry('slide 4', {hash: ''}), 1);
    setDocHash(s, '/d/pres.pdf', '123456');
    const d = docsSummary(s).find(x => x.path === '/d/pres.pdf');
    expect(d?.total).toBe(4);
    expect(d?.read).toBe(2);
    expect(d?.pdfCovered).toBe(true);
    // Same shape without the docHash (interrupted read): NOT covered.
    const s2 = emptyStore();
    upsertPage(s2, '/d/other.pdf', 0, entry('p1', {hash: ''}), 1);
    expect(
      docsSummary(s2).find(x => x.path === '/d/other.pdf')?.pdfCovered,
    ).toBe(false);
  });

  it('docsSummary splits ocrOnly vs visionDone by page source (v0.68 pipeline)', () => {
    const s = emptyStore();
    // Two pages still at OCR (awaiting vision), two past vision, one blank
    // OCR (no text → counts as neither), one hand-corrected (past vision).
    upsertPage(s, '/n.note', 0, entry('a', {source: 'mistral-ocr'}), 1);
    upsertPage(s, '/n.note', 1, entry('b', {source: 'mistral-ocr'}), 1);
    upsertPage(s, '/n.note', 2, entry('c', {source: 'medium'}), 1);
    upsertPage(s, '/n.note', 3, entry('d', {source: 'user'}), 1);
    upsertPage(s, '/n.note', 4, entry('', {source: 'mistral-ocr'}), 1);
    const d = docsSummary(s).find(x => x.path === '/n.note');
    expect(d?.ocrOnly).toBe(2); // pages 0,1 — the "→ vision" backlog
    expect(d?.visionDone).toBe(2); // pages 2,3 — "up to date"
    expect(d?.pages).toBe(4); // non-empty transcripts (blank page 4 excluded)
  });

  it('round-trips low-confidence words and drops malformed ones', () => {
    const s = emptyStore();
    upsertPage(
      s,
      '/n.note',
      0,
      entry('text', {low: [{t: 'CAGR', c: 0.6}]}),
      1,
    );
    const back = roundTrip(serializeStore(s));
    expect(getPage(back, '/n.note', 0)?.low).toEqual([{t: 'CAGR', c: 0.6}]);

    const raw = JSON.parse(serializeStore(s));
    raw.docs['/n.note'].pages['0'].low = [
      {t: 'ok', c: 0.5},
      {t: '', c: 0.4},
      {t: 'noscore'},
      'junk',
    ];
    const cleaned = roundTrip(JSON.stringify(raw));
    expect(getPage(cleaned, '/n.note', 0)?.low).toEqual([{t: 'ok', c: 0.5}]);
  });
});

describe('legacy sources (eco / recogntext, removed v0.35)', () => {
  it('drops a stored legacy-source entry at parse (defensive re-read)', () => {
    const s = emptyStore();
    upsertPage(s, '/n.note', 0, entry('kept'), 1);
    const raw = JSON.parse(serializeStore(s));
    raw.docs['/n.note'].pages['1'] = {...raw.docs['/n.note'].pages['0'], source: 'eco'};
    raw.docs['/n.note'].pages['2'] = {...raw.docs['/n.note'].pages['0'], source: 'recogntext'};
    const back = roundTrip(JSON.stringify(raw));
    expect(getPage(back, '/n.note', 0)?.text).toBe('kept');
    expect(getPage(back, '/n.note', 1)).toBeNull();
    expect(getPage(back, '/n.note', 2)).toBeNull();
  });
});


// v0.55: agent-pinned docs are NEVER evicted (hard pin).

describe('sweepEphemeralPages (OFF boot sweep, full review 2026-08-02)', () => {
  it('purges eph pages of OFF docs; DEFUSES stray markers elsewhere', () => {
    const s = emptyStore();
    // Off doc: eph page purged, clean page kept.
    upsertPage(s, '/off.note', 0, entry('P1', {text: 'kept'}), 1);
    const e1 = entry('P2', {text: 'off page'});
    e1.eph = true;
    upsertPage(s, '/off.note', 1, e1, 1);
    // NON-Off doc with a stray v0.92.0 marker: page survives, marker goes.
    const e2 = entry('P3', {text: 'legit paid page'});
    e2.eph = true;
    upsertPage(s, '/normal.note', 0, e2, 1);
    const r = sweepEphemeralPages(s, new Set(['/off.note']));
    expect(r).toEqual({purged: 1, defused: 1});
    expect(getPage(s, '/off.note', 0)!.text).toBe('kept');
    expect(getPage(s, '/off.note', 1)).toBeNull();
    const kept = getPage(s, '/normal.note', 0)!;
    expect(kept.text).toBe('legit paid page');
    expect(kept.eph).toBeUndefined();
  });
});

describe('Phase A lock guarantees (owner spec S6)', () => {
  it('upsertPage carries the lock forward through any rewrite', () => {
    const s = emptyStore();
    const locked = entry('P1', {text: 'v1'});
    locked.lock = true;
    upsertPage(s, '/n.note', 0, locked, 1);
    // a later write (edit, allowed re-read) does NOT mention the lock…
    upsertPage(s, '/n.note', 0, entry('P1', {text: 'v2'}), 2);
    // …and the lock survives anyway.
    expect(getPage(s, '/n.note', 0)!.lock).toBe(true);
    expect(getPage(s, '/n.note', 0)!.text).toBe('v2');
  });

  it('setDocLock creates the stub for a never-read document', () => {
    const s = emptyStore();
    setDocLock(s, '/never-read.note', true);
    expect(isDocLocked(s, '/never-read.note')).toBe(true);
    setDocLock(s, '/never-read.note', false);
    expect(isDocLocked(s, '/never-read.note')).toBe(false);
  });

  it('setPageLock creates the stub for a never-read PAGE (twin of setDocLock)', () => {
    // Round 15 #3: the doc-level twin got the stub fix and the page-level
    // one did not — the UI confirmed a lock that was never stored. Twins
    // are now TESTED together so they cannot diverge again.
    const s = emptyStore();
    setPageLock(s, '/never-read.note', 4, true);
    expect(isPageLocked(s, '/never-read.note', 4)).toBe(true);
    // the stub reads like an unread page once unlocked
    setPageLock(s, '/never-read.note', 4, false);
    expect(isPageLocked(s, '/never-read.note', 4)).toBe(false);
  });

  it('removeDoc keeps the DOC lock on a stub (Clear transcript)', () => {
    const s = emptyStore();
    upsertPage(s, '/n.note', 0, entry('P1', {text: 'paid'}), 1);
    setDocLock(s, '/n.note', true);
    removeDoc(s, '/n.note');
    expect(getPage(s, '/n.note', 0)).toBeNull(); // pages gone
    expect(isDocLocked(s, '/n.note')).toBe(true); // decision kept
  });
});

/* ---- Relocation helpers (2026-08-03): moved files inherit, never re-pay ---- */

describe('buildPageIdDonors', () => {
  it('indexes identity-stamped, non-ephemeral, non-empty entries of OTHER docs', () => {
    const s = emptyStore();
    upsertPage(s, '/a.note', 0, {text: 'A0', source: 'mistral-ocr', at: 1, hash: 'P20260101000000001'}, 1);
    upsertPage(s, '/a.note', 1, {text: '  ', source: 'mistral-ocr', at: 1, hash: 'P20260101000000002'}, 1); // empty
    upsertPage(s, '/a.note', 2, {text: 'eph', source: 'mistral-ocr', at: 1, hash: 'P20260101000000003', eph: true}, 1);
    upsertPage(s, '/a.note', 3, {text: 'legacy', source: 'mistral-ocr', at: 1, hash: '12'}, 1); // not a PAGEID
    upsertPage(s, '/self.note', 0, {text: 'self', source: 'mistral-ocr', at: 1, hash: 'P20260101000000004'}, 1);
    const donors = buildPageIdDonors(s, '/self.note');
    expect([...donors.keys()]).toEqual(['P20260101000000001']);
    expect(donors.get('P20260101000000001')!.text).toBe('A0');
  });
});

describe('adoptPdfDoc', () => {
  const donorAt = '/Document/old/spec.pdf';
  const dest = '/Document/new/spec.pdf';
  const withDonor = (docHash = '5000', extra: object = {}): Store => {
    const s = emptyStore();
    upsertPage(s, donorAt, 0, {text: 'p1', source: 'mistral-ocr', at: 9, hash: '', va: 'd:5000', low: [{t: 'w', c: 0.4}]}, 9);
    upsertPage(s, donorAt, 1, {text: 'p2', source: 'medium', at: 9, hash: '', vh: 'mh:abc', lock: true}, 9);
    s.docs[donorAt].docHash = docHash;
    Object.assign(s.docs[donorAt], extra);
    return s;
  };

  it('adopts on same name + same printed bytes: deep copy, no markSz doorbell', () => {
    const s = withDonor('5000', {markSz: 777});
    expect(adoptPdfDoc(s, dest, 5000, 42)).toBe(true);
    const d = s.docs[dest];
    expect(d.docHash).toBe('5000');
    expect(d.markSz).toBeUndefined(); // annotations re-settle free at the new path
    expect(d.pages['0'].text).toBe('p1');
    expect(d.pages['0'].va).toBe('d:5000'); // same docHash → marker still valid
    expect(d.pages['1'].vh).toBe('mh:abc');
    expect(d.pages['1'].lock).toBe(true); // the freeze follows the document
    // DEEP copy: mutating the adopted entry leaves the donor intact.
    d.pages['0'].text = 'mutated';
    d.pages['0'].low![0].c = 0.9;
    expect(s.docs[donorAt].pages['0'].text).toBe('p1');
    expect(s.docs[donorAt].pages['0'].low![0].c).toBe(0.4);
  });

  it('strips the legacy |m suffix when matching the donor hash', () => {
    const s = withDonor('5000|m123');
    expect(adoptPdfDoc(s, dest, 5000, 42)).toBe(true);
    expect(s.docs[dest].docHash).toBe('5000');
  });

  it('refuses a different name, a different size, and a page-less donor', () => {
    expect(adoptPdfDoc(withDonor(), '/Document/new/other.pdf', 5000, 1)).toBe(false);
    expect(adoptPdfDoc(withDonor(), dest, 5001, 1)).toBe(false);
    const empty = emptyStore();
    empty.docs[donorAt] = {usedAt: 1, docHash: '5000', pages: {}, stars: [], kws: []};
    expect(adoptPdfDoc(empty, dest, 5000, 1)).toBe(false);
  });

  it('refuses when the destination holds real text or carries a doc lock', () => {
    const s1 = withDonor();
    upsertPage(s1, dest, 0, {text: 'mine', source: 'user', at: 5, hash: ''}, 5);
    expect(adoptPdfDoc(s1, dest, 5000, 1)).toBe(false);
    expect(s1.docs[dest].pages['0'].text).toBe('mine');
    const s2 = withDonor();
    setDocLock(s2, dest, true); // spec S6: frozen means frozen, even for free writes
    expect(adoptPdfDoc(s2, dest, 5000, 1)).toBe(false);
    expect(Object.keys(s2.docs[dest].pages)).toHaveLength(0);
  });

  // Audit 2 (2026-08-03): a TEXTLESS page at a NEVER-READ path is not data.
  // Refusing on it re-OCR'd a whole already-paid book on a simple move.
  it('adopts over a blank marker at a never-read destination (docHash still empty)', () => {
    const s = withDonor();
    upsertPage(s, dest, 0, {text: '', source: 'mistral-ocr', at: 3, hash: '', va: 'mh:x'}, 3);
    expect(s.docs[dest].docHash).toBe(''); // nothing was ever read here
    expect(adoptPdfDoc(s, dest, 5000, 42)).toBe(true);
    expect(s.docs[dest].pages['0'].text).toBe('p1'); // the donor's real text wins
  });

  it('still refuses when a LOCKED page sits at the destination, empty or not', () => {
    const s = withDonor();
    setPageLock(s, dest, 0, true); // stub on a never-read page (spec S6)
    expect(adoptPdfDoc(s, dest, 5000, 42)).toBe(false);
    expect(s.docs[dest].pages['0'].lock).toBe(true);
  });

  // Audit 3, critical #1: a PDF with NO printed text (blank grid template,
  // sketchbook) is a normal fully-paid document — its pages are '' and its
  // value lives entirely in the vh/va markers and the markSz doorbell.
  it('refuses a destination that was already READ, even with zero text anywhere', () => {
    const s = withDonor();
    upsertPage(s, dest, 0, {text: '', source: 'medium', at: 3, hash: '', vh: 'mh:mine'}, 3);
    s.docs[dest].docHash = '5000'; // read and covered: docHash is the proof
    s.docs[dest].markSz = 4242; // annotations settled here
    expect(adoptPdfDoc(s, dest, 5000, 42)).toBe(false);
    expect(s.docs[dest].pages['0'].vh).toBe('mh:mine'); // ITS pixels, kept
    expect(s.docs[dest].markSz).toBe(4242); // doorbell not re-armed
  });

  // Audit 3, critical #2: adoption must be self-terminating. A textless
  // donor used to leave the destination textless, so every readPdf adopted
  // again — dropping markSz and re-billing the annotated pages each tick.
  it('is idempotent even when the donor itself carries no text at all', () => {
    const s = emptyStore();
    upsertPage(s, donorAt, 0, {text: '', source: 'medium', at: 9, hash: '', vh: 'mh:a'}, 9);
    upsertPage(s, donorAt, 1, {text: '', source: 'medium', at: 9, hash: '', vh: 'mh:b'}, 9);
    s.docs[donorAt].docHash = '5000';
    expect(adoptPdfDoc(s, dest, 5000, 42)).toBe(true); // first move: inherits
    expect(s.docs[dest].docHash).toBe('5000'); // …and is stamped as read
    expect(adoptPdfDoc(s, dest, 5000, 43)).toBe(false); // every later tick: no-op
    expect(adoptPdfDoc(s, dest, 5000, 44)).toBe(false);
  });

  it('skips ephemeral donor pages; adopts nothing if only eph remains', () => {
    const s = emptyStore();
    upsertPage(s, donorAt, 0, {text: 'secret', source: 'mistral-ocr', at: 1, hash: '', eph: true}, 1);
    s.docs[donorAt].docHash = '5000';
    expect(adoptPdfDoc(s, dest, 5000, 1)).toBe(false);
  });
});

describe('clearDocRespectingLocks (user decision 2026-08-03: lock blocks Clear)', () => {
  const P = '/n/a.note';
  const filled = (): Store => {
    const s = emptyStore();
    upsertPage(s, P, 0, {text: 'zero', source: 'mistral-ocr', at: 1, hash: 'h0'}, 1);
    upsertPage(s, P, 1, {text: 'un', source: 'user', at: 1, hash: 'h1', lock: true}, 1);
    upsertPage(s, P, 2, {text: 'deux', source: 'medium', at: 1, hash: 'h2'}, 1);
    s.docs[P].docHash = '999';
    s.docs[P].markSz = 5;
    return s;
  };

  it('a locked DOCUMENT refuses the clear outright', () => {
    const s = filled();
    setDocLock(s, P, true);
    const r = clearDocRespectingLocks(s, P);
    expect(r).toEqual({changed: false, cleared: 0, keptLockedPages: 0, skippedLockedDoc: true});
    expect(getPage(s, P, 0)!.text).toBe('zero'); // nothing touched
  });

  it('locked PAGES survive a doc clear; docHash and doorbell reset for the re-read', () => {
    const s = filled();
    const r = clearDocRespectingLocks(s, P);
    expect(r).toEqual({changed: true, cleared: 2, keptLockedPages: 1, skippedLockedDoc: false});
    expect(getPage(s, P, 0)).toBeNull();
    expect(getPage(s, P, 1)!.text).toBe('un'); // frozen text kept
    expect(getPage(s, P, 1)!.lock).toBe(true);
    expect(getPage(s, P, 2)).toBeNull();
    expect(s.docs[P].docHash).toBe(''); // next read re-covers unlocked pages
    expect(s.docs[P].markSz).toBeUndefined();
  });

  it('no lock anywhere → full wipe (unchanged historical behavior)', () => {
    const s = filled();
    getPage(s, P, 1)!.lock = undefined;
    const r = clearDocRespectingLocks(s, P);
    expect(r.changed).toBe(true);
    expect(r.cleared).toBe(3);
    expect(s.docs[P]).toBeUndefined();
  });

  it('every page locked → nothing dropped, store untouched (no phantom persist)', () => {
    const s = emptyStore();
    upsertPage(s, P, 0, {text: 'a', source: 'user', at: 1, hash: 'h', lock: true}, 1);
    const before = JSON.stringify(s);
    const r = clearDocRespectingLocks(s, P);
    expect(r).toEqual({changed: false, cleared: 0, keptLockedPages: 1, skippedLockedDoc: false});
    expect(JSON.stringify(s)).toBe(before);
  });

  it('unknown doc → inert', () => {
    const s = emptyStore();
    expect(clearDocRespectingLocks(s, '/ghost.note').changed).toBe(false);
  });
});

describe('limbo (v1.0.1: remap drops stay adoptable)', () => {
  it('a dropped identity entry lands in limbo and feeds the donor index', () => {
    const s = emptyStore();
    setPageIds(s, '/n/src.note', ['P20260101000000001', 'P20260101000000002']);
    upsertPage(s, '/n/src.note', 0, {text: 'garde', source: 'mistral-ocr', at: 1, hash: 'P20260101000000001'}, 1);
    upsertPage(s, '/n/src.note', 1, {text: 'partie', source: 'medium', at: 2, hash: 'P20260101000000002'}, 1);
    remapDocPages(s, '/n/src.note', ['P20260101000000001']); // page 2 left
    expect(limboSize()).toBe(1);
    const donors = buildPageIdDonors(s, '/n/dest.note');
    expect(donors.get('P20260101000000002')!.text).toBe('partie');
    // Live entries still win over limbo.
    expect(donors.get('P20260101000000001')!.text).toBe('garde');
  });

  it('ephemeral and empty entries are never parked', () => {
    const s = emptyStore();
    setPageIds(s, '/n/src.note', ['P20260101000000003', 'P20260101000000004']);
    upsertPage(s, '/n/src.note', 0, {text: 'secret', source: 'mistral-ocr', at: 1, hash: 'P20260101000000003', eph: true}, 1);
    upsertPage(s, '/n/src.note', 1, {text: '   ', source: 'mistral-ocr', at: 1, hash: 'P20260101000000004'}, 1);
    remapDocPages(s, '/n/src.note', []);
    expect(limboSize()).toBe(0);
  });
});
