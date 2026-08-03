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
    ...over,
  } as DocSummary);

const T = (mode: 'auto' | 'manual' | 'off'): AutoTarget =>
  ({mode} as AutoTarget);

describe('computeSyncFrame', () => {
  it('aggregates per mode; read-but-blank pages are DONE, not pending', () => {
    const f = computeSyncFrame(
      [
        doc('/Note/a.note', {total: 10, read: 7}), // 3 to sync
        doc('/Note/b.note', {total: 4, read: 4, pages: 2}), // blanks read → 0
      ],
      {},
      {'/Note/a.note': T('manual'), '/Note/b.note': T('manual')},
      {},
      new Map(),
    );
    expect(f.toSync).toBe(3);
    expect(f.upToDate).toBe(11);
    expect(f.canSync).toBe(true);
    expect(f.agg.manual.noteFiles).toBe(2);
  });

  it('a docHash-covered PDF is fully read whatever its entry count', () => {
    const f = computeSyncFrame(
      [doc('/Document/spec.pdf', {total: 50, read: 3, pdfCovered: true})],
      {},
      {'/Document/spec.pdf': T('manual')},
      {},
      new Map(),
    );
    expect(f.toSync).toBe(0);
    expect(f.agg.manual.pdfFiles).toBe(1);
  });

  it('the stale map overrides structure for Manual docs only', () => {
    const targets = {
      '/Note/m.note': T('manual'),
      '/Note/auto.note': T('auto'),
    };
    const stale = new Map([
      ['/Note/m.note', 9],
      ['/Note/auto.note', 9], // must be IGNORED (doc is Auto)
    ]);
    const f = computeSyncFrame(
      [
        doc('/Note/m.note', {total: 10, read: 10}),
        doc('/Note/auto.note', {total: 10, read: 10}),
      ],
      {},
      targets,
      {},
      stale,
    );
    expect(f.toSync).toBe(9); // manual: stale wins over "all read"
    expect(f.agg.auto.toRead).toBe(0); // auto: structure wins
  });

  it('a tracked file the store never saw counts via pageCounts (all pending)', () => {
    const f = computeSyncFrame(
      [],
      {'/Note': [{name: 'new.note', isDir: false}]},
      {'/Note/new.note': T('auto')},
      {'/Note/new.note': 6},
      new Map(),
    );
    expect(f.agg.auto.toRead).toBe(6);
    expect(f.autoPendingNames).toEqual(['new.note (6)']);
  });

  it('no double count when a doc is in the lib AND in the tree; untracked files ignored', () => {
    const f = computeSyncFrame(
      [doc('/Note/a.note', {total: 2, read: 0})],
      {'/Note': [{name: 'a.note', isDir: false}, {name: 'libre.note', isDir: false}]},
      {'/Note/a.note': T('manual')},
      {},
      new Map(),
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
      new Map(),
    );
    expect(f.agg.manual.pdfUnknown).toBe(1);
    expect(f.canSync).toBe(true); // unknown PDFs keep Sync available
    expect(f.foldersCnt).toEqual({auto: 1, manual: 0, off: 1});
  });
});
