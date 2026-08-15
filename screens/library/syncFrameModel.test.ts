// The SYNCHRONISATION frame's money math (extracted Lot 2). Pins the
// behaviours the screen relied on: blank pages are done (not pending),
// pdfCovered short-circuits, the stale map only applies to Manual docs,
// files outside the store count via pageCounts, dedup between lib and
// tree, folder chips counted per mode.
import {computeSyncFrame} from './syncFrameModel';
import type {DocSummary} from '../../src/core/store/transcriptStore';
import type {AutoTarget} from '../../src/core/store/autoEngine';

const doc = (path: string, over: Partial<DocSummary> = {}): DocSummary =>
  ({
    path,
    name: path.split('/').pop() ?? path,
    folder: path.split('/').slice(0, -1).join('/'),
    pages: 0,
    read: 0,
    total: 0,
    // Unified stage counts (2026-08-12): the frame reads these, not total-read.
    queued: 0,
    ocrPending: 0,
    visioned: 0,
    ...over,
  } as DocSummary);

const T = (mode: 'auto' | 'manual' | 'off'): AutoTarget =>
  ({mode} as AutoTarget);

describe('computeSyncFrame', () => {
  it('aggregates per mode; read-but-blank pages are DONE, not pending', () => {
    const f = computeSyncFrame(
      [
        doc('/Note/a.note', {total: 10, queued: 3}), // 3 to sync
        doc('/Note/b.note', {total: 4, queued: 0, pages: 2}), // blanks read → 0
      ],
      {},
      {'/Note/a.note': T('manual'), '/Note/b.note': T('manual')},
      {},
    );
    expect(f.toSync).toBe(3);
    expect(f.upToDate).toBe(11);
    expect(f.canSync).toBe(true);
    expect(f.agg.manual.noteFiles).toBe(2);
  });

  it('splits tracked pages by file type (notePages / pdfPages) for the label', () => {
    const f = computeSyncFrame(
      [
        doc('/Note/a.note', {total: 30}),
        doc('/Note/b.note', {total: 12}),
        doc('/Doc/spec.pdf', {total: 50, pdfCovered: true}),
      ],
      {},
      {
        '/Note/a.note': T('manual'),
        '/Note/b.note': T('manual'),
        '/Doc/spec.pdf': T('manual'),
      },
      {},
    );
    expect(f.agg.manual.noteFiles).toBe(2);
    expect(f.agg.manual.notePages).toBe(42); // 30 + 12
    expect(f.agg.manual.pdfFiles).toBe(1);
    expect(f.agg.manual.pdfPages).toBe(50);
    expect(f.agg.manual.pages).toBe(92); // total unchanged
  });

  it('a docHash-covered PDF is fully read whatever its entry count', () => {
    const f = computeSyncFrame(
      [doc('/Document/spec.pdf', {total: 50, queued: 0, pdfCovered: true})],
      {},
      {'/Document/spec.pdf': T('manual')},
      {},
    );
    expect(f.toSync).toBe(0);
    expect(f.agg.manual.pdfFiles).toBe(1);
  });

  it('OCR-only pages are Vision-pending, not "up to date" (LibraryScreen:1928)', () => {
    // 4 pages read as OCR, Vision still owed on 2 of them: NOT done, and Sync
    // must stay available (the tree used to show "✓ / 0 to sync / Sync off").
    const f = computeSyncFrame(
      [doc('/Note/a.note', {total: 4, queued: 0, ocrPending: 2, pages: 4})],
      {},
      {'/Note/a.note': T('manual')},
      {},
    );
    expect(f.toSync).toBe(0); // no PAID read owed
    expect(f.agg.manual.visionPending).toBe(2);
    expect(f.canSync).toBe(true); // Vision leg is work → button enabled
    expect(f.upToDate).toBe(2); // 4 pages − 0 paid − 2 vision-owed
  });

  it('the engine owed count overrides the structural queued (redesign 2026-08-14)', () => {
    // owed.read is authoritative: even if the structural queued says 0 (all
    // pages have entries), an owed.read of 9 (e.g. 9 edited pages the engine
    // found) wins — and vice-versa. It applies to EVERY mode (owed is written
    // for auto docs too), unlike the old manual-only stale map.
    const f = computeSyncFrame(
      [
        doc('/Note/m.note', {total: 10, queued: 0, owed: {read: 9, vision: 0}}),
        doc('/Note/a.note', {total: 10, queued: 5, owed: {read: 0, vision: 0}}),
      ],
      {},
      {'/Note/m.note': T('manual'), '/Note/a.note': T('manual')},
      {},
    );
    expect(f.toSync).toBe(9); // 9 (owed) + 0 (owed wins over queued:5)
  });

  it('read and vision are SEPARATE disjoint stages, counted independently', () => {
    // owed = {read:2, vision:3}: 2 pages need a paid read, 3 OTHER pages owe only
    // Vision — disjoint by construction, so the total pending is 2 + 3 = 5.
    const f = computeSyncFrame(
      [doc('/Note/a.note', {total: 5, owed: {read: 2, vision: 3}})],
      {},
      {'/Note/a.note': T('manual')},
      {},
    );
    expect(f.toSync).toBe(2); // paid read
    expect(f.agg.manual.visionPending).toBe(3); // separate Vision leg
    expect(f.upToDate).toBe(0); // 5 − 2 − 3
  });

  it('a changed PDF (owed.read == total) does NOT also count Vision', () => {
    // Whole-doc re-read redoes Vision too, so owed.vision is 0 — counted once (5),
    // not 5+5 (round-5/6 audit: the edited-OCR double-count is impossible now the
    // engine writes a DISJOINT vision count).
    const f = computeSyncFrame(
      [doc('/Doc/p.pdf', {total: 5, owed: {read: 5, vision: 0}})],
      {},
      {'/Doc/p.pdf': T('manual')},
      {},
    );
    expect(f.toSync).toBe(5);
    expect(f.agg.manual.visionPending).toBe(0); // subsumed by the full re-read
  });

  it('falls back to STRUCTURAL ocrPending for Vision when owed is absent', () => {
    // A doc the engine has not processed yet: no owed → structural queued/
    // ocrPending (themselves disjoint via pageStage).
    const f = computeSyncFrame(
      [doc('/Note/a.note', {total: 4, queued: 0, ocrPending: 2})], // owed absent
      {},
      {'/Note/a.note': T('manual')},
      {},
    );
    expect(f.toSync).toBe(0);
    expect(f.agg.manual.visionPending).toBe(2); // structural fallback
  });

  it('falls back to structural queued when the engine has not set owed yet', () => {
    const f = computeSyncFrame(
      [doc('/Note/fresh.note', {total: 6, queued: 6})], // owed absent
      {},
      {'/Note/fresh.note': T('manual')},
      {},
    );
    expect(f.toSync).toBe(6); // structural estimate until the first pass
  });

  it('a tracked file the store never saw counts via pageCounts (all pending)', () => {
    const f = computeSyncFrame(
      [],
      {'/Note': [{name: 'new.note', isDir: false}]},
      {'/Note/new.note': T('auto')},
      {'/Note/new.note': 6},
    );
    expect(f.agg.auto.toRead).toBe(6);
    expect(f.autoPendingNames).toEqual(['new.note (6)']);
  });

  it('no double count when a doc is in the lib AND in the tree; untracked files ignored', () => {
    const f = computeSyncFrame(
      [doc('/Note/a.note', {total: 2, queued: 2})],
      {'/Note': [{name: 'a.note', isDir: false}, {name: 'libre.note', isDir: false}]},
      {'/Note/a.note': T('manual')},
      {},
    );
    expect(f.agg.manual.notes).toBe(1); // a.note once, libre.note untracked
    expect(f.toSync).toBe(2);
  });

  it('counts folder chips per mode; a PDF with no local count is pdfUnknown', () => {
    const f = computeSyncFrame(
      [],
      {'/Document': [{name: 'x.pdf', isDir: false}]},
      {
        '/Document/x.pdf': T('manual'),
        '/Note/Pro': T('auto'),
        '/Note/Perso': T('off'),
      },
      {},
    );
    expect(f.agg.manual.pdfUnknown).toBe(1);
    expect(f.canSync).toBe(true); // unknown PDFs keep Sync available
    expect(f.foldersCnt).toEqual({auto: 1, manual: 0, off: 1});
  });
});
