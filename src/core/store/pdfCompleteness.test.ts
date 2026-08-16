// Lot 1 (2026-08-16): the PDF completeness truth — pageCount stamped from the
// /v1/ocr response — and what it changes: a missing entry inside the range of
// a covered PDF is a CLEARED page (repairable Vision debt), no longer
// indistinguishable from a blank. Pure store tests.
import {
  emptyStore,
  sanitizeDocEntry,
  setPdfPageCount,
  docPageCount,
  pdfMissingPages,
  pageStage,
  upsertPage,
  type PageEntry,
  type Store,
} from './transcriptStore';

const PDF = '/Document/doc.pdf';

const entry = (text: string, over: Partial<PageEntry> = {}): PageEntry => ({
  text,
  source: 'mistral-ocr',
  at: 1,
  hash: '',
  ...over,
});

const covered = (pageCount?: number): Store => {
  const s = emptyStore();
  upsertPage(s, PDF, 0, entry('page zero text'), 1);
  s.docs[PDF]!.docHash = '123';
  if (pageCount !== undefined) {
    s.docs[PDF]!.pageCount = pageCount;
  }
  return s;
};

describe('pageCount stamping & totals', () => {
  it('setPdfPageCount stores the truth; docPageCount uses it over max-index+1', () => {
    const s = covered();
    expect(docPageCount(s, PDF)).toBe(1); // entries-only guess
    setPdfPageCount(s, PDF, 118);
    expect(s.docs[PDF]!.pageCount).toBe(118);
    expect(docPageCount(s, PDF)).toBe(118); // the OCR truth wins
  });

  it('rejects a non-positive or fractional count (never degrade the truth)', () => {
    const s = covered(10);
    setPdfPageCount(s, PDF, 0);
    setPdfPageCount(s, PDF, -3);
    setPdfPageCount(s, PDF, 2.5);
    expect(s.docs[PDF]!.pageCount).toBe(10);
  });

  it('sanitizeDocEntry round-trips pageCount and drops a corrupt one', () => {
    const ok = sanitizeDocEntry({usedAt: 0, docHash: '1', pages: {}, pageCount: 7});
    expect(ok!.pageCount).toBe(7);
    const bad = sanitizeDocEntry({usedAt: 0, docHash: '1', pages: {}, pageCount: '7'});
    expect(bad!.pageCount).toBeUndefined();
  });
});

describe('pdfMissingPages (cleared pages of a covered PDF)', () => {
  it('returns exactly the in-range indices with no entry', () => {
    const s = covered(3); // entry only at 0 → 1 and 2 are missing
    expect(pdfMissingPages(s, PDF)).toEqual([1, 2]);
  });

  it('no pageCount (legacy doc) → nothing: the old blank=done reading stands', () => {
    expect(pdfMissingPages(covered(), PDF)).toEqual([]);
  });

  it('uncovered doc (docHash cleared) → nothing: the whole-file OCR owns it', () => {
    const s = covered(3);
    s.docs[PDF]!.docHash = '';
    expect(pdfMissingPages(s, PDF)).toEqual([]);
  });

  it('doc-locked → nothing (frozen is frozen)', () => {
    const s = covered(3);
    s.docs[PDF]!.lock = true;
    expect(pdfMissingPages(s, PDF)).toEqual([]);
  });
});

describe('pageStage for a MISSING entry', () => {
  const ctx = (over: Partial<Parameters<typeof pageStage>[1]> = {}) => ({
    isPdf: true,
    docHash: '123',
    docLocked: false,
    pdfCovered: true,
    hasPageCount: true,
    ...over,
  });

  it("covered + pageCount truth → 'ocr' (repairable Vision debt)", () => {
    expect(pageStage(undefined, ctx())).toBe('ocr');
  });

  it("covered, LEGACY doc (no pageCount) → 'finished' (old semantics, no mass re-bill)", () => {
    expect(pageStage(undefined, ctx({hasPageCount: false}))).toBe('finished');
  });

  it("covered + pageCount but doc-locked → 'finished' (frozen)", () => {
    expect(pageStage(undefined, ctx({docLocked: true}))).toBe('finished');
  });

  it("not covered → 'queue' regardless (whole-file OCR territory)", () => {
    expect(pageStage(undefined, ctx({pdfCovered: false}))).toBe('queue');
    expect(
      pageStage(undefined, ctx({pdfCovered: false, hasPageCount: false})),
    ).toBe('queue');
  });
});
