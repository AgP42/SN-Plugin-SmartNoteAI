import {classifyPipeline, type TrackedTotal} from './pipeline';
import {emptyStore, upsertPage, makePageEntry} from './transcriptStore';
import type {Store} from './transcriptStore';

const note = (total: number): TrackedTotal => ({total, isPdf: false, pdfCovered: false});
const put = (s: Store, path: string, page: number, source: 'mistral-ocr' | 'medium' | 'user', text = 'x') =>
  upsertPage(s, path, page, makePageEntry(text, source, {hash: 'h'}, 1), 1);

describe('classifyPipeline — strict 3-stage partition (batch removed)', () => {
  it('classifies each tracked page into exactly one stage; counts sum to tracked', () => {
    const s = emptyStore();
    // /a.note: 5 pages — 2 finished (vision), 1 ocr-only, 2 unread.
    put(s, '/a.note', 0, 'medium');
    put(s, '/a.note', 1, 'user');
    put(s, '/a.note', 2, 'mistral-ocr');
    const totals = new Map([['/a.note', note(5)]]);
    const r = classifyPipeline(s, totals);
    expect(r).toEqual({
      tracked: 5,
      queue: 2, // pages 3,4 (no entry)
      ocrDone: 1, // page 2
      finished: 2, // pages 0,1
    });
    expect(r.queue + r.ocrDone + r.finished).toBe(r.tracked);
  });

  it('unread pages are Queue; a read-blank page is Finished (K4, 2026-08-12)', () => {
    const s = emptyStore();
    put(s, '/a.note', 0, 'mistral-ocr', ''); // blank OCR (negative cache) → DONE
    const r = classifyPipeline(s, new Map([['/a.note', note(3)]]));
    expect(r.queue).toBe(2); // only the never-read pages 1,2
    expect(r.finished).toBe(1); // the blank page is done, not queued
  });

  it('a vision-SETTLED OCR page is Finished, not ocrDone (2026-08-12)', () => {
    const s = emptyStore();
    // OCR text, vision ran and had nothing to add (va === rev) → settled.
    put(s, '/a.note', 0, 'mistral-ocr');
    const doc = s.docs['/a.note'];
    const e = doc.pages['0'];
    e.rev = 'r0';
    e.va = 'r0';
    const r = classifyPipeline(s, new Map([['/a.note', note(1)]]));
    expect(r.finished).toBe(1);
    expect(r.ocrDone).toBe(0); // the "Force Vision" button offered no real work
  });

  it('an OCR-only page (vision failed once) is ocrDone, not finished', () => {
    const s = emptyStore();
    put(s, '/a.note', 0, 'mistral-ocr');
    const r = classifyPipeline(s, new Map([['/a.note', note(1)]]));
    expect(r.ocrDone).toBe(1);
    expect(r.finished).toBe(0);
  });

  it('PDFs: covered → Finished, else Queue', () => {
    const s = emptyStore();
    const totals = new Map<string, TrackedTotal>([
      ['/covered.pdf', {total: 10, isPdf: true, pdfCovered: true}],
      ['/new.pdf', {total: 3, isPdf: true, pdfCovered: false}],
    ]);
    const r = classifyPipeline(s, totals);
    expect(r.finished).toBe(10);
    expect(r.queue).toBe(3);
    expect(r.tracked).toBe(13);
    expect(r.queue + r.ocrDone + r.finished).toBe(13);
  });

  it('partition holds across a random mix', () => {
    const s = emptyStore();
    const totals = new Map<string, TrackedTotal>();
    for (let n = 0; n < 8; n++) {
      const path = `/n${n}.note`;
      const total = 3 + n;
      totals.set(path, note(total));
      for (let p = 0; p < total; p++) {
        const pick = (n + p) % 4;
        if (pick === 0) put(s, path, p, 'medium');
        else if (pick === 1) put(s, path, p, 'mistral-ocr');
        // pick 2,3 → no entry (Queue)
      }
    }
    const r = classifyPipeline(s, totals);
    expect(r.queue + r.ocrDone + r.finished).toBe(r.tracked);
    expect(r.finished).toBeLessThanOrEqual(r.tracked);
  });
});

// Sync-count redesign 2026-08-14: classifyPipeline reads the engine's
// authoritative doc.owed when present (same value the "N to sync" frame uses),
// so the bar and the frame can never disagree; it falls back to pageStage only
// for a doc the engine has not processed yet.
describe('classifyPipeline reads doc.owed (redesign 2026-08-14)', () => {
  it('queue = owed.read, ocrDone = owed.vision (disjoint), finished = the rest', () => {
    const s = emptyStore();
    put(s, '/a.note', 0, 'medium');
    put(s, '/a.note', 1, 'medium');
    put(s, '/a.note', 2, 'medium');
    // Engine recorded a DISJOINT owed: 1 page to re-read, 1 OTHER owing Vision.
    s.docs['/a.note'].owed = {read: 1, vision: 1, at: 1};
    const r = classifyPipeline(s, new Map([['/a.note', note(3)]]));
    expect(r.queue).toBe(1);
    expect(r.ocrDone).toBe(1);
    expect(r.finished).toBe(1); // 3 − 1 − 1
    expect(r.queue + r.ocrDone + r.finished).toBe(r.tracked);
  });

  it('falls back to structural queue when owed is absent', () => {
    const s = emptyStore();
    put(s, '/a.note', 0, 'mistral-ocr'); // OCR-only → ocrDone via pageStage
    const r = classifyPipeline(s, new Map([['/a.note', note(2)]]));
    expect(r.ocrDone).toBe(1);
    expect(r.queue).toBe(1); // page 1 never read
  });

  it('clamps a stale owed.read that exceeds the page total', () => {
    const s = emptyStore();
    put(s, '/a.note', 0, 'medium');
    s.docs['/a.note'].owed = {read: 99, vision: 0, at: 1};
    const r = classifyPipeline(s, new Map([['/a.note', note(1)]]));
    expect(r.queue + r.ocrDone + r.finished).toBe(1); // partition still holds
    expect(r.queue).toBe(1);
  });
});
