// CHARACTERIZATION tests for the paid READ orchestration (reading.ts):
// they pin the CURRENT behavior of syncPageIds / pagesNeedingRead /
// readNotePages / readPdf / pageStamp — no refactor implied. Native seams
// are mocked: noteTranscripts (footer reads), transcriptStoreIo (an
// in-memory Store driven by the REAL pure helpers) and fetchAdapter
// (routed by URL: /v1/ocr vs /v1/chat/completions). capturePageImage and
// ensureNoteFresh run REAL, driven by fake CaptureDeps.

import type {CaptureDeps} from './capture';
import type {FetchFn} from '../core/model/types';
import {
  fnvHex,
  pagesNeedingRead,
  readNotePages,
  readPdf,
  readPdfPageVision,
  finishVisionLive,
  pendingVisionPages,
  syncNotePages,
  pageStamp,
  isOffForRead,
  pdfPrintedCovered,
} from './reading';
import {fetchAdapter} from './fetchAdapter';
import {noteFailure, __resetFailLedgerForTests} from './failLedger';
import {readPageIds, readNotePageRevs} from './noteTranscripts';
import {mutateStore, flushStore} from './transcriptStoreIo';
import {
  clearLimbo,
  emptyStore,
  getPage,
  getDocHash,
  setDocHash,
  setDocLock,
  setPageIds,
  setOwed,
  getOwed,
  upsertPage,
  type PageEntry,
  type Store,
} from '../core/store/transcriptStore';

jest.mock('./fetchAdapter', () => ({fetchAdapter: jest.fn()}));
// Native seam: it lists directories and writes settings. The reading tests
// only care THAT a proven rename is followed through, with which paths.
jest.mock('./renameFollow', () => ({
  provenGone: jest.fn(async () => false),
  followRename: jest.fn(async () => undefined),
}));
// reading.ts uses only listDirNative from ./fs (renameFollow + transcriptStoreIo
// are mocked). Default [] = an empty/failed listing (proves no absence).
jest.mock('./fs', () => ({listDirNative: jest.fn(async () => [])}));
// The Off gate (audit 2026-07-18) reads settings; untracked = 'manual'.
// Default mode is Off (2026-08-12): an untracked path is never read, so these
// read-MECHANICS tests must present their docs as tracked. The folder keys
// cover every path constant used below (/Note/…, /Document/…). Tests that
// exercise Off/eph behaviour drive it through the offOk/eph params directly.
jest.mock('./settings', () => ({
  readSettings: jest.fn(async () => ({
    autoTargets: {
      '/Note': {mode: 'auto'},
      '/Document': {mode: 'auto'},
      '/Autre': {mode: 'auto'},
    },
  })),
}));
jest.mock('./noteTranscripts', () => ({
  readPageIds: jest.fn(),
  readLandscapePages: jest.fn(async () => new Set()),
  readNotePageRevs: jest.fn(),
  readNotePageCount: jest.fn(async () => null),
  readNoteMeta: jest.fn(async () => ({stars: [], kws: []})),
  // v0.36: the freshness guard lives in noteTranscripts too — a no-op
  // here, like the real one when the native range reader is absent.
  ensureNoteFresh: jest.fn(async () => undefined),
  invalidateNoteCache: jest.fn(),
  readFileSize: jest.fn(async () => null),
}));
jest.mock('./transcriptStoreIo', () => {
  const pure = jest.requireActual<
    typeof import('../core/store/transcriptStore')
  >('../core/store/transcriptStore');
  const state = {store: pure.emptyStore()};
  return {
    __state: state,
    loadStore: jest.fn(async () => state.store),
    isDegradedLoad: jest.fn(() => false),
  isDocReadOnly: jest.fn(() => false),
    mutateStore: jest.fn(async (fn: (s: unknown) => void) => {
      fn(state.store);
    }),
    flushStore: jest.fn(async () => undefined),
  };
});

const storeState = (
  jest.requireMock('./transcriptStoreIo') as unknown as {
    __state: {store: Store};
  }
).__state;
const fetchMock = fetchAdapter as jest.MockedFunction<FetchFn>;
const pageIdsMock = readPageIds as jest.MockedFunction<typeof readPageIds>;
const revsMock = readNotePageRevs as jest.MockedFunction<
  typeof readNotePageRevs
>;
const mutateMock = mutateStore as jest.Mock;
const flushMock = flushStore as jest.Mock;

const NOTE = '/Note/test.note';
const PDF = '/Document/doc.pdf';
const PNG = new Uint8Array([1, 2, 3]).buffer;
const PA = 'P20260101000000001';
const PB = 'P20260101000000002';
const PC = 'P20260101000000003';

const baseDeps = (over: Partial<CaptureDeps> = {}): CaptureDeps => ({
  getCurrentFilePath: async () => NOTE,
  getCurrentPageNum: async () => 0,
  getPluginDirPath: async () => '/plugin',
  generateNotePng: jest.fn(async () => ({success: true})),
  generateDocImage: jest.fn(async () => ({success: true})),
  getCurrentDocText: async () => ({result: ''}),
  getNoteTotalPageNum: async () => 2,
  saveCurrentNote: jest.fn(async () => ({success: true})),
  deleteFile: jest.fn(async () => true),
  fetchFn: async () => ({ok: true, arrayBuffer: async () => PNG}),
  ...over,
});

type FetchRes = Awaited<ReturnType<FetchFn>>;
const jsonRes = (data: unknown): FetchRes => ({
  ok: true,
  status: 200,
  json: async () => data,
  text: async () => '',
});
const httpErr = (status: number): FetchRes => ({
  ok: false,
  status,
  json: async () => null,
  text: async () => 'err',
});
const ocrRes = (markdown: string, words: Array<[string, number]>): FetchRes =>
  jsonRes({
    pages: [
      {
        index: 0,
        markdown,
        confidence_scores: {
          word_confidence_scores: words.map(([t, c]) => ({
            text: t,
            confidence: c,
          })),
        },
      },
    ],
  });
const chatRes = (text: string): FetchRes =>
  jsonRes({choices: [{message: {content: text}}]});
// Confident words → no escalation; all-low words → escalation (>30% <0.8).
const GOOD: Array<[string, number]> = [['hello', 0.95], ['world', 0.9]];
const MESSY: Array<[string, number]> = [['msy', 0.4], ['txt', 0.5]];

const route = (h: {ocr?: () => FetchRes; chat?: () => FetchRes}): void => {
  fetchMock.mockImplementation(async url => {
    if (url.includes('/v1/ocr') && h.ocr) {
      return h.ocr();
    }
    if (url.includes('/chat/completions') && h.chat) {
      return h.chat();
    }
    throw new Error(`unrouted ${url}`);
  });
};

const entry = (hash: string, over: Partial<PageEntry> = {}): PageEntry => ({
  text: 'stored text',
  source: 'mistral-ocr',
  at: 1,
  hash,
  ...over,
});
const idMap = (...ids: string[]): Map<number, string> =>
  new Map(ids.map((id, i) => [i, id] as [number, string]));

beforeEach(() => {
  jest.clearAllMocks();
  clearLimbo(); // module-level parked drops must not leak between tests
  __resetFailLedgerForTests(); // lot 3: the resume path now writes to it
  // readFileSize keeps whatever implementation a previous test installed
  // (clearAllMocks does not reset implementations): re-pin it so a leaked
  // .mark size cannot change another test's doc hash.
  (
    jest.requireMock('./noteTranscripts') as {readFileSize: jest.Mock}
  ).readFileSize.mockResolvedValue(null);
  storeState.store = emptyStore();
  pageIdsMock.mockResolvedValue(idMap(PA, PB));
  revsMock.mockResolvedValue(
    new Map([
      [0, 'a1'],
      [1, 'b1'],
    ]),
  );
});

describe('syncPageIds (via pagesNeedingRead / syncNotePages)', () => {
  it('FAST path: matching count + live order answers read-only (no mutateStore)', async () => {
    const s = storeState.store;
    setPageIds(s, NOTE, [PA, PB]);
    upsertPage(s, NOTE, 0, entry(PA, {rev: 'a1'}), 1);
    upsertPage(s, NOTE, 1, entry(PB, {rev: 'b1'}), 1);
    const needed = await pagesNeedingRead(baseDeps(), NOTE, [0, 1]);
    expect(needed).toEqual([]);
    // Guards the 3Hz-loop fix: no store touch → no subscriber notify.
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('SLOW path on count change: remaps by PAGEID, snapshots ids, re-baselines revs', async () => {
    const s = storeState.store;
    setPageIds(s, NOTE, [PA, PB, PC]);
    upsertPage(s, NOTE, 0, entry(PA, {text: 'A', rev: 'a1'}), 1);
    upsertPage(s, NOTE, 1, entry(PB, {text: 'B', rev: 'b1'}), 1);
    upsertPage(s, NOTE, 2, entry(PC, {text: 'C', rev: 'c1'}), 1);
    const deps = baseDeps({getNoteTotalPageNum: async () => 2}); // B deleted
    pageIdsMock.mockResolvedValue(idMap(PA, PC));
    // Structural reflow moved every page's block address.
    revsMock.mockResolvedValue(
      new Map([
        [0, 'a2'],
        [1, 'c2'],
      ]),
    );
    await syncNotePages(deps, NOTE);
    expect(s.docs[NOTE].pageIds).toEqual([PA, PC]);
    expect(getPage(s, NOTE, 1)!.text).toBe('C'); // followed its PAGEID
    expect(getPage(s, NOTE, 2)).toBeNull(); // deleted page dropped
    expect(getPage(s, NOTE, 0)!.rev).toBe('a2'); // re-baselined…
    expect(getPage(s, NOTE, 1)!.rev).toBe('c2');
    // …so the reflow is NOT mistaken for an edit of every page.
    expect(await pagesNeedingRead(deps, NOTE, [0, 1])).toEqual([]);
  });

  it('IN-PLACE EDIT survives a forced sync: rev NOT re-baselined, page re-read (device bug 2026-07-17)', async () => {
    const s = storeState.store;
    // Same structure (ids match the snapshot) but page 0's block address
    // moved: the user wrote on it since the last read.
    setPageIds(s, NOTE, [PA, PB]);
    upsertPage(s, NOTE, 0, entry(PA, {text: 'old read', rev: 'a1'}), 1);
    upsertPage(s, NOTE, 1, entry(PB, {text: 'ok', rev: 'b1'}), 1);
    revsMock.mockResolvedValue(
      new Map([
        [0, 'a2'], // ← edited in place
        [1, 'b1'],
      ]),
    );
    // The Auto flow forces the sync exactly like autoTranscriptTick does.
    await syncNotePages(baseDeps(), NOTE, true);
    // The entry's rev must still be the OLD address — re-baselining here
    // is what masked every edit from Auto (needing=0 forever).
    expect(getPage(s, NOTE, 0)!.rev).toBe('a1');
    expect(await pagesNeedingRead(baseDeps(), NOTE, [0, 1])).toEqual([0]);
  });

  it('pagesNeedingRead: new page needed, user entry never, missing rev backfilled once', async () => {
    const s = storeState.store;
    setPageIds(s, NOTE, [PA, PB, PC]);
    upsertPage(s, NOTE, 0, entry(PA), 1); // pre-v0.25.7: no rev
    upsertPage(s, NOTE, 2, entry(PC, {source: 'user', text: 'hand fix'}), 1);
    const deps = baseDeps({getNoteTotalPageNum: async () => 3});
    pageIdsMock.mockResolvedValue(idMap(PA, PB, PC));
    revsMock.mockResolvedValue(
      new Map([
        [0, 'a1'],
        [1, 'b1'],
        [2, 'c1'],
      ]),
    );
    const needed = await pagesNeedingRead(deps, NOTE, [0, 1, 2]);
    expect(needed).toEqual([1]); // only the page without an entry
    expect(mutateMock).toHaveBeenCalledTimes(1); // one backfill mutation
    expect(getPage(s, NOTE, 0)!.rev).toBe('a1'); // free rev backfill…
    expect(getPage(s, NOTE, 2)!.rev).toBe('c1'); // …user entries included
    mutateMock.mockClear();
    expect(await pagesNeedingRead(deps, NOTE, [0, 1, 2])).toEqual([1]);
    expect(mutateMock).not.toHaveBeenCalled(); // backfill is one-time
  });

});

describe('readNotePages', () => {
  it('always-vision (v0.38): every page OCR→Vision, stored medium with hash+rev, flushed', async () => {
    route({ocr: () => ocrRes('hi', GOOD), chat: () => chatRes('hello\nworld')});
    const out = await readNotePages(baseDeps(), 'key', 'SYS', NOTE, [0, 1]);
    expect(out).toEqual({ok: true, read: 2, failed: [], storedPages: [0, 1]});
    const e0 = getPage(storeState.store, NOTE, 0)!;
    expect(e0.text).toBe('hello world'); // reflow joined the wrap
    expect(e0.source).toBe('medium'); // vision, even on a confident page
    expect(e0.hash).toBe(PA);
    expect(e0.rev).toBe('a1');
    expect(getPage(storeState.store, NOTE, 1)!.hash).toBe(PB);
    expect(fetchMock).toHaveBeenCalledTimes(4); // OCR + Vision per page
    expect(flushMock).toHaveBeenCalled();
  });

  it('vision with non-empty OCR: hint call to chat/completions, stored as medium', async () => {
    route({
      ocr: () => ocrRes('msy txt', MESSY),
      chat: () => chatRes('clean text'),
    });
    const out = await readNotePages(baseDeps(), 'key', '', NOTE, [0]);
    expect(out).toEqual({ok: true, read: 1, failed: [], storedPages: [0]});
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      'https://api.mistral.ai/v1/ocr',
      'https://api.mistral.ai/v1/chat/completions',
    ]);
    expect(fetchMock.mock.calls[1][1].body).toContain('--- hint ---');
    const e = getPage(storeState.store, NOTE, 0)!;
    expect(e.source).toBe('medium');
    expect(e.text).toBe('clean text');
  });

  it('vision failure after escalation keeps the paid OCR text as mistral-ocr', async () => {
    route({ocr: () => ocrRes('msy txt', MESSY), chat: () => httpErr(500)});
    const out = await readNotePages(baseDeps(), 'key', '', NOTE, [0]);
    // visionRefused marks "the vision request never landed", so the page is
    // still owed a pass even though its OCR text was stored (review #2).
    expect(out).toEqual({
      ok: true,
      read: 1,
      failed: [],
      visionRefused: [0],
      storedPages: [0],
    });
    const e = getPage(storeState.store, NOTE, 0)!;
    expect(e.source).toBe('mistral-ocr');
    expect(e.text).toBe('msy txt');
    expect(e.low).toEqual([
      {t: 'msy', c: 0.4},
      {t: 'txt', c: 0.5},
    ]);
  });

  it('OCR 0 words + vision empty-but-ok → negative-caches an empty entry', async () => {
    route({ocr: () => ocrRes('', []), chat: () => chatRes('')});
    const out = await readNotePages(baseDeps(), 'key', '', NOTE, [0]);
    expect(out).toEqual({ok: true, read: 1, failed: [], storedPages: [0]});
    // Image-only vision read: an empty hint block would make models invent.
    expect(fetchMock.mock.calls[1][1].body).not.toContain('--- hint ---');
    const e = getPage(storeState.store, NOTE, 0)!;
    expect(e.text).toBe('');
    expect(e.source).toBe('mistral-ocr');
    expect(e.rev).toBe('a1'); // stamped → not re-read until the ink changes
  });

  it('OCR 0 words + vision NETWORK failure → failed, not cached', async () => {
    route({
      ocr: () => ocrRes('', []),
      chat: () => {
        throw new TypeError('Network request failed');
      },
    });
    const out = await readNotePages(baseDeps(), 'key', '', NOTE, [0]);
    expect(out.ok).toBe(false);
    expect(out.read).toBe(0);
    expect(out.failed).toEqual([0]);
    expect(out.reason).toMatch(/Network error/);
    expect(getPage(storeState.store, NOTE, 0)).toBeNull(); // retries later
    expect(flushMock).not.toHaveBeenCalled(); // nothing paid landed
  });

  it('shouldStop before start → Stopped., zero HTTP calls, zero renders', async () => {
    const deps = baseDeps();
    const out = await readNotePages(deps, 'key', '', NOTE, [0, 1], {
      shouldStop: () => true,
    });
    expect(out).toEqual({ok: false, read: 0, failed: [], reason: 'Stopped.'});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(deps.generateNotePng).not.toHaveBeenCalled();
  });

  it('a Network error on the first page stops burning renders on the rest', async () => {
    route({
      ocr: () => {
        throw new TypeError('Network request failed');
      },
    });
    const deps = baseDeps({getNoteTotalPageNum: async () => 3});
    pageIdsMock.mockResolvedValue(idMap(PA, PB, PC));
    revsMock.mockResolvedValue(
      new Map([
        [0, 'a1'],
        [1, 'b1'],
        [2, 'c1'],
      ]),
    );
    const out = await readNotePages(deps, 'key', '', NOTE, [0, 1, 2]);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/Network error/);
    // v0.36 (transport retry): the first failure now lands ~RETRY_DELAY_MS
    // later, so pages already in the PARALLEL_READS sliding window are
    // attempted too before the loop short-circuits. The guarantee is that
    // failures are reported and no page is silently skipped — with only 3
    // pages, all fit the window.
    expect(out.failed).toEqual([0, 1, 2]);
    expect(deps.generateNotePng).toHaveBeenCalledTimes(3);
  });

  it('render breaker (v0.87.2): 3 renders failing in a row abort the pass', async () => {
    route({ocr: () => ocrRes('hi', GOOD), chat: () => chatRes('t')});
    const deps = baseDeps({
      generateNotePng: jest.fn(async () => ({success: false})),
      getNoteTotalPageNum: async () => 8,
    });
    pageIdsMock.mockResolvedValue(idMap(PA, PB, PC, PA, PB, PC, PA, PB));
    const out = await readNotePages(deps, 'key', '', NOTE, [0, 1, 2, 3, 4, 5, 6, 7], {
      force: true,
    });
    // Exactly CONSEC_RENDER_BREAK attempts, not one per page: a render
    // failure means the host cannot render notes AT ALL right now.
    expect(deps.generateNotePng).toHaveBeenCalledTimes(3);
    expect(out.failed).toEqual([0, 1, 2]);
    expect(out.renderFailed).toEqual([0, 1, 2]);
    expect(out.renderAborted).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled(); // free failures, zero API spend
  });

  it('a dead network never renders beyond the sliding window (v0.36 retry)', async () => {
    route({
      ocr: () => {
        throw new TypeError('Network request failed');
      },
    });
    const pages = [0, 1, 2, 3, 4, 5];
    const ids = new Map(pages.map(p => [p, `${PA.slice(0, -1)}${p}`]));
    const deps = baseDeps({getNoteTotalPageNum: async () => pages.length});
    pageIdsMock.mockResolvedValue(ids);
    revsMock.mockResolvedValue(new Map(pages.map(p => [p, `r${p}`])));
    const out = await readNotePages(deps, 'key', '', NOTE, pages);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/Network error/);
    // The short-circuit caps the burn at the window (4) + at most one
    // page scheduled while the first failure was landing.
    expect(
      (deps.generateNotePng as jest.Mock).mock.calls.length,
    ).toBeLessThanOrEqual(5);
  });

  it('force re-reads a page the store already covers', async () => {
    const s = storeState.store;
    setPageIds(s, NOTE, [PA, PB]);
    upsertPage(s, NOTE, 0, entry(PA, {text: 'old', rev: 'a1'}), 1);
    // No chat route: the vision leg is refused, the paid OCR text stands.
    route({ocr: () => ocrRes('fresh text', GOOD)});
    const out = await readNotePages(baseDeps(), 'key', '', NOTE, [0], {
      force: true,
    });
    expect(out).toEqual({
      ok: true,
      read: 1,
      failed: [],
      visionRefused: [0],
      storedPages: [0],
    });
    expect(getPage(s, NOTE, 0)!.text).toBe('fresh text');
  });
});

describe('readPdf', () => {
  const PDF_BYTES = new Uint8Array([9, 9, 9, 9, 9]).buffer; // docHash '5'
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    // readPdf reads the file through the GLOBAL fetch (not deps.fetchFn).
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      arrayBuffer: async () => PDF_BYTES,
    })) as unknown as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  const twoPageOcr = (): FetchRes =>
    jsonRes({
      pages: [
        {
          index: 0,
          markdown: 'clean page',
          confidence_scores: {
            word_confidence_scores: [
              {text: 'clean', confidence: 0.95},
              {text: 'page', confidence: 0.95},
            ],
          },
        },
        // 0 words extracted → flagged for escalation, OCR text as hint.
        {index: 1, markdown: 'raw ocr', confidence_scores: null},
      ],
    });

  it('unchanged docHash (byte length) → early return, no HTTP', async () => {
    setDocHash(storeState.store, PDF, '5');
    const out = await readPdf(baseDeps(), 'key', '', PDF);
    expect(out).toEqual({ok: true, read: 0, failed: []});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('changed PDF: OCR stores all pages, then EVERY page is read with Vision (Option A), hash stamped', async () => {
    route({ocr: twoPageOcr, chat: () => chatRes('vision text')});
    const deps = baseDeps();
    const out = await readPdf(deps, 'key', '', PDF);
    expect(out).toEqual({ok: true, read: 2, failed: [], storedPages: [0, 1]});
    const s = storeState.store;
    // Both pages now go through Vision (not just the flagged one).
    expect(getPage(s, PDF, 0)!.source).toBe('medium');
    expect(getPage(s, PDF, 0)!.text).toBe('vision text');
    expect(getPage(s, PDF, 0)!.hash).toBe(''); // PDFs carry no PAGEID
    expect(getPage(s, PDF, 1)!.source).toBe('medium');
    expect(getPage(s, PDF, 1)!.text).toBe('vision text');
    expect(getDocHash(s, PDF)).toBe('5');
    expect(deps.generateDocImage).toHaveBeenCalledTimes(2); // every page rendered
    expect(flushMock).toHaveBeenCalled();
  });

  it('aborted during Vision: OCR kept + docHash stamped, then the next read RESUMES Vision with NO re-OCR (Option A)', async () => {
    route({ocr: twoPageOcr, chat: () => chatRes('vision text')});
    const aborted = {aborted: true} as unknown as AbortSignal;
    await readPdf(baseDeps(), 'key', '', PDF, {signal: aborted});
    const s = storeState.store;
    // OCR stored, Vision skipped (aborted) → both pages still mistral-ocr.
    expect(getPage(s, PDF, 0)!.source).toBe('mistral-ocr');
    expect(getPage(s, PDF, 1)!.source).toBe('mistral-ocr');
    // Option A: docHash IS stamped after OCR, so the resume path kicks in.
    expect(getDocHash(s, PDF)).toBe('5');
    // A later read (not aborted) finishes Vision WITHOUT re-OCR.
    fetchMock.mockClear(); // forget the first read's OCR call
    route({
      ocr: () => {
        throw new Error('must not re-OCR on resume');
      },
      chat: () => chatRes('vision text'),
    });
    await readPdf(baseDeps(), 'key', '', PDF);
    expect(getPage(s, PDF, 0)!.source).toBe('medium');
    expect(getPage(s, PDF, 1)!.source).toBe('medium');
    expect(
      fetchMock.mock.calls.some(c => String(c[0]).includes('/v1/ocr')),
    ).toBe(false);
  });

  // v0.82: a CLEAN (non-flagged) page that carries a .mark annotation still
  // gets a composited Vision read, and the .mark size folds into the hash.
  const cleanTwoPageOcr = (): FetchRes =>
    jsonRes({
      pages: [
        {index: 0, markdown: 'p0', confidence_scores: {word_confidence_scores: [{text: 'p0', confidence: 0.95}]}},
        {index: 1, markdown: 'p1', confidence_scores: {word_confidence_scores: [{text: 'p1', confidence: 0.95}]}},
      ],
    });

  it('annotated PDF page → composited Vision read + .mark folded into docHash', async () => {
    const nt = jest.requireMock('./noteTranscripts') as {readFileSize: jest.Mock};
    nt.readFileSize.mockImplementation(async (p: string) =>
      p.endsWith('.mark') ? 42 : null,
    );
    route({ocr: cleanTwoPageOcr, chat: () => chatRes('annotation text')});
    const deps = baseDeps({
      getMarkPages: jest.fn(async () => ({result: [1], success: true})),
      generateMarkThumbnails: jest.fn(async () => ({success: true})),
      compositePng: jest.fn(async () => ({success: true})),
    });
    const out = await readPdf(deps, 'key', '', PDF);
    expect(out.ok).toBe(true);
    const s = storeState.store;
    // Option A: EVERY page is Vision-read; the annotated page composites .mark.
    expect(getPage(s, PDF, 0)!.source).toBe('medium');
    expect(getPage(s, PDF, 1)!.source).toBe('medium');
    expect(getPage(s, PDF, 1)!.text).toBe('annotation text');
    expect(deps.generateMarkThumbnails).toHaveBeenCalled();
    expect(deps.compositePng).toHaveBeenCalled();
    // Phase B: the hash is the PRINTED bytes only; the .mark size is the
    // doorbell, and the annotated page carries its own pixel identity.
    expect(getDocHash(s, PDF)).toBe('5');
    expect(s.docs[PDF].markSz).toBe(42);
    expect(getPage(s, PDF, 1)!.vh).toMatch(/^mh:/);
    nt.readFileSize.mockResolvedValue(null); // restore for other tests
  });

  // R2 (audit 2026-07-28): a PDF already fully OCR'd, then annotated, must NOT
  // be re-OCR'd end to end — only the annotated page is re-read with Vision.
  it('R2: annotation added to a covered PDF → Vision on the annotated page only, NO whole-doc re-OCR', async () => {
    const nt = jest.requireMock('./noteTranscripts') as {readFileSize: jest.Mock};
    nt.readFileSize.mockImplementation(async (p: string) =>
      p.endsWith('.mark') ? 42 : 5,
    );
    // Already covered at bytes=5 with NO annotation, both pages OCR'd.
    setDocHash(storeState.store, PDF, '5');
    upsertPage(storeState.store, PDF, 0, entry('', {text: 'p0 ocr'}), 1);
    upsertPage(storeState.store, PDF, 1, entry('', {text: 'p1 ocr'}), 1);
    route({ocr: twoPageOcr, chat: () => chatRes('annotation text')});
    const deps = baseDeps({
      getMarkPages: jest.fn(async () => ({result: [1], success: true})),
      generateMarkThumbnails: jest.fn(async () => ({success: true})),
      compositePng: jest.fn(async () => ({success: true})),
    });
    const out = await readPdf(deps, 'key', '', PDF);
    expect(out.ok).toBe(true);
    const s = storeState.store;
    // The whole-document /v1/ocr call is NEVER made.
    expect(
      fetchMock.mock.calls.some(c => String(c[0]).includes('/v1/ocr')),
    ).toBe(false);
    // The annotated page 1 got a fresh Vision read…
    expect(getPage(s, PDF, 1)!.source).toBe('medium');
    expect(getPage(s, PDF, 1)!.text).toBe('annotation text');
    // …and page 0's OVERDUE vision debt (it was OCR-only) settles in the
    // same pass — Option A owed it that read anyway. No re-OCR happened.
    expect(getPage(s, PDF, 0)!.source).toBe('medium');
    // The doorbell settles at the new mark size; the hash stays bytes-only.
    expect(getDocHash(s, PDF)).toBe('5');
    expect(s.docs[PDF].markSz).toBe(42);
    nt.readFileSize.mockResolvedValue(null); // restore for other tests
  });

  // v0.87 host split: skipVision = the caller knows the current host cannot
  // render PDF pages. The OCR leg (host-independent) must still run and
  // stamp; every Vision leg must be deferred, never worked around.
  // Round 2 #1: skipping by SOURCE killed the feature, because every PDF
  // page ends at 'medium' after the normal Vision pass. The skip must key
  // on the ANNOTATION REVISION instead.
  it('unified pass re-reads a Vision page whose annotation pixels changed', async () => {
    const nt = jest.requireMock('./noteTranscripts') as {readFileSize: jest.Mock};
    nt.readFileSize.mockImplementation(async (p: string) =>
      p.endsWith('.mark') ? 42 : 5,
    );
    setDocHash(storeState.store, PDF, '5');
    // Vision-read once, but at ANOTHER pixel state (stale vh).
    const stale = entry('', {text: 'p0 vision', source: 'medium'});
    stale.vh = 'mh:deadbeef';
    upsertPage(storeState.store, PDF, 0, stale, 1);
    route({chat: () => chatRes('annotation text')});
    const deps = baseDeps({
      getMarkPages: jest.fn(async () => ({result: [0], success: true})),
      generateMarkThumbnails: jest.fn(async () => ({success: true})),
      compositePng: jest.fn(async () => ({success: true})),
    });
    await readPdf(deps, 'key', '', PDF);
    const e = getPage(storeState.store, PDF, 0)!;
    expect(e.text).toBe('annotation text');
    // Phase B: the page carries the pixel identity its NEW text came from,
    // the doc hash stays bytes-only, and the doorbell settles.
    expect(e.vh).toMatch(/^mh:/);
    expect(e.vh).not.toBe('mh:deadbeef');
    expect(getDocHash(storeState.store, PDF)).toBe('5');
    expect(storeState.store.docs[PDF].markSz).toBe(42);
  });

  // …and the same page is not paid for twice at the same annotation state:
  // the render is free and local, the skip happens on ITS hash, and only
  // pages whose pixels actually changed reach the paid model.
  it('mark-only revision skips a page already read at THIS annotation state', async () => {
    const nt = jest.requireMock('./noteTranscripts') as {readFileSize: jest.Mock};
    nt.readFileSize.mockImplementation(async (p: string) =>
      p.endsWith('.mark') ? 42 : 5,
    );
    setDocHash(storeState.store, PDF, '5');
    const deps = baseDeps({
      // Audit 2026-08-16: these annotated pages have NO entry (no anti-bleed
      // baseline), so their repair only runs for the doc on screen.
      getCurrentFilePath: async () => PDF,
      getMarkPages: jest.fn(async () => ({result: [0, 1], success: true})),
      generateMarkThumbnails: jest.fn(async () => ({success: true})),
      compositePng: jest.fn(async () => ({success: true})),
    });
    // First pass: both pages read and stamped at their pixel hash.
    // (attended: entry-less annotated pages only repair on a user-initiated
    // read with the doc on screen — fix-audit 2026-08-16.)
    route({chat: () => chatRes('annotation text')});
    await readPdf(deps, 'key', '', PDF, {attended: true});
    const calls1 = fetchMock.mock.calls.length;
    expect(calls1).toBeGreaterThan(0);
    // Unstamp the doc so the pass re-enters (as after a partial failure):
    // the render runs again (free) but NO page reaches the paid model.
    setDocHash(storeState.store, PDF, '5');
    await readPdf(deps, 'key', '', PDF, {attended: true});
    expect(fetchMock.mock.calls.length).toBe(calls1); // zero new paid calls
  });

  it('unified pass NEVER touches a hand-corrected PDF page (no pixel proof exists)', async () => {
    const nt = jest.requireMock('./noteTranscripts') as {readFileSize: jest.Mock};
    nt.readFileSize.mockImplementation(async (p2: string) =>
      p2.endsWith('.mark') ? 42 : 5,
    );
    setDocHash(storeState.store, PDF, '5');
    upsertPage(storeState.store, PDF, 0,
               entry('', {text: 'my correction', source: 'user'}), 1);
    route({chat: () => chatRes('new annotation text')});
    const deps = baseDeps({
      getMarkPages: jest.fn(async () => ({result: [0], success: true})),
      generateMarkThumbnails: jest.fn(async () => ({success: true})),
      compositePng: jest.fn(async () => ({success: true})),
    });
    await readPdf(deps, 'key', '', PDF);
    // The correction replaced vision's text, so its pixel identity is gone:
    // without proof, the automatic pass leaves the page alone (explicit
    // Redo remains available, and refuses only on a LOCK).
    expect(getPage(storeState.store, PDF, 0)!.text).toBe('my correction');
    expect(getPage(storeState.store, PDF, 0)!.source).toBe('user');
  });

  // v0.94: the mark pass DOES refresh a hand-corrected page when the
  // annotation changed (proof of change); a LOCKED page is untouchable.
  it('mark-only revision never touches a LOCKED page', async () => {
    const nt = jest.requireMock('./noteTranscripts') as {readFileSize: jest.Mock};
    nt.readFileSize.mockImplementation(async (p: string) =>
      p.endsWith('.mark') ? 42 : 5,
    );
    setDocHash(storeState.store, PDF, '5');
    const locked = entry('', {text: 'my correction', source: 'user'});
    locked.lock = true;
    upsertPage(storeState.store, PDF, 0, locked, 1);
    route({chat: () => chatRes('vision text')});
    const deps = baseDeps({
      getMarkPages: jest.fn(async () => ({result: [0], success: true})),
      generateMarkThumbnails: jest.fn(async () => ({success: true})),
      compositePng: jest.fn(async () => ({success: true})),
    });
    await readPdf(deps, 'key', '', PDF);
    expect(getPage(storeState.store, PDF, 0)!.text).toBe('my correction');
    expect(getPage(storeState.store, PDF, 0)!.source).toBe('user');
  });

  // Self-caught before audit 9: Stop mid-pass broke the loop with no
  // failures recorded, and the doorbell settled over unattempted pages.
  it('an aborted recheck leaves the annotation doorbell OPEN', async () => {
    const nt = jest.requireMock('./noteTranscripts') as {readFileSize: jest.Mock};
    nt.readFileSize.mockImplementation(async (p: string) =>
      p.endsWith('.mark') ? 42 : 5,
    );
    setDocHash(storeState.store, PDF, '5');
    upsertPage(storeState.store, PDF, 0, entry('', {text: 'p0 ocr'}), 1);
    const ctl = new AbortController();
    ctl.abort(); // aborted before the first page
    const deps = baseDeps({
      getMarkPages: jest.fn(async () => ({result: [0], success: true})),
      generateMarkThumbnails: jest.fn(async () => ({success: true})),
      compositePng: jest.fn(async () => ({success: true})),
    });
    await readPdf(deps, 'key', '', PDF, {signal: ctl.signal});
    expect(storeState.store.docs[PDF].markSz).toBeUndefined(); // still open
  });

  // An SDK error listing the annotated pages must DEFER, never stamp.
  it('mark-only revision defers (no stamp) when the page list errors', async () => {
    const nt = jest.requireMock('./noteTranscripts') as {readFileSize: jest.Mock};
    nt.readFileSize.mockImplementation(async (p: string) =>
      p.endsWith('.mark') ? 42 : 5,
    );
    setDocHash(storeState.store, PDF, '5');
    const deps = baseDeps({
      getMarkPages: jest.fn(async () => {
        throw new Error('sdk hiccup');
      }),
    });
    const out = await readPdf(deps, 'key', '', PDF);
    // No paid call was made, and the DOORBELL stays open (markSz unset):
    // the annotation change is re-seen at the next pass.
    expect(out.ok).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(0);
    expect(storeState.store.docs[PDF].markSz).toBeUndefined();
  });

  describe('skipVision (v0.87)', () => {
    it('changed PDF: OCR runs and stamps, NO renders, pages stay mistral-ocr', async () => {
      route({
        ocr: twoPageOcr,
        chat: () => {
          throw new Error('must not vision without a PDF host');
        },
      });
      const deps = baseDeps();
      const out = await readPdf(deps, 'key', '', PDF, {skipVision: true});
      expect(out.ok).toBe(true);
      expect(out.read).toBe(2);
      const s = storeState.store;
      expect(getPage(s, PDF, 0)!.source).toBe('mistral-ocr');
      expect(getPage(s, PDF, 1)!.source).toBe('mistral-ocr');
      expect(getDocHash(s, PDF)).toBe('5'); // OCR coverage stamped
      expect(deps.generateDocImage).not.toHaveBeenCalled();
    });

    it('covered PDF with pending Vision: no resume (the debt waits for a PDF host)', async () => {
      setDocHash(storeState.store, PDF, '5');
      upsertPage(storeState.store, PDF, 0, entry('', {text: 'p0 ocr'}), 1);
      const deps = baseDeps();
      const out = await readPdf(deps, 'key', '', PDF, {skipVision: true});
      expect(out).toEqual({ok: true, read: 0, failed: []});
      expect(deps.generateDocImage).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('mark-only change is DEFERRED: no whole-doc re-OCR, hash NOT re-stamped', async () => {
      const nt = jest.requireMock('./noteTranscripts') as {
        readFileSize: jest.Mock;
      };
      nt.readFileSize.mockImplementation(async (p: string) =>
        p.endsWith('.mark') ? 42 : 5,
      );
      // Covered at bytes=5 without annotation; a .mark then appears.
      setDocHash(storeState.store, PDF, '5');
      upsertPage(storeState.store, PDF, 0, entry('', {text: 'p0 ocr'}), 1);
      route({
        ocr: () => {
          throw new Error('must not re-OCR a mark-only change');
        },
        chat: () => {
          throw new Error('must not vision without a PDF host');
        },
      });
      const out = await readPdf(baseDeps(), 'key', '', PDF, {skipVision: true});
      expect(out).toEqual({ok: true, read: 0, failed: []});
      expect(
        fetchMock.mock.calls.some(c => String(c[0]).includes('/v1/ocr')),
      ).toBe(false);
      // NOT re-stamped: the annotation must be re-seen (and Vision-read)
      // once a PDF host is available.
      expect(getDocHash(storeState.store, PDF)).toBe('5');
      nt.readFileSize.mockResolvedValue(null); // restore for other tests
    });
  });
});

describe('pageStamp', () => {
  it('PDF path → {hash: ""}; .note page → PAGEID + rev', async () => {
    expect(await pageStamp(baseDeps(), PDF, 0)).toEqual({hash: ''});
    expect(await pageStamp(baseDeps(), NOTE, 1)).toEqual({
      hash: PB,
      rev: 'b1',
    });
  });
});

// R3 (audit 2026-07-28): a vision-only retry must not re-pay the OCR it
// already has, and "Vision now" must not touch negative-cached blank pages.
describe('R3 — reuse stored OCR on a vision retry (no re-pay)', () => {
  it('readNotePages ocrHint: SKIPS the paid OCR call, Vision still runs, low words kept', async () => {
    route({
      ocr: () => {
        throw new Error('OCR must NOT be called when a hint is supplied');
      },
      chat: () => chatRes('vision text'),
    });
    const out = await readNotePages(baseDeps(), 'key', 'SYS', NOTE, [0], {
      force: true,
      ocrHint: () => ({text: 'stored ocr', low: [{t: 'x', c: 0.4}]}),
    });
    expect(out).toEqual({ok: true, read: 1, failed: [], storedPages: [0]});
    // Only the Vision leg was billed — no /v1/ocr at all.
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      'https://api.mistral.ai/v1/chat/completions',
    ]);
    // The reused OCR text rode as the vision hint.
    expect(fetchMock.mock.calls[0][1].body).toContain('stored ocr');
    const e = getPage(storeState.store, NOTE, 0)!;
    expect(e.source).toBe('medium');
    expect(e.text).toBe('vision text');
    expect(e.low).toEqual([{t: 'x', c: 0.4}]); // reused low words preserved
  });

  it('finishVisionLive: reuses each page OCR (no /v1/ocr) and SKIPS blank pages', async () => {
    // Page 0: real OCR text awaiting vision. Page 1: empty mistral-ocr = a
    // negative-cached blank that must be left alone, not re-paid.
    upsertPage(storeState.store, NOTE, 0, entry(PA, {text: 'ocr0', rev: 'a1'}), 1);
    upsertPage(storeState.store, NOTE, 1, entry(PB, {text: '', rev: 'b1'}), 1);
    route({
      ocr: () => {
        throw new Error('OCR must NOT be called by Vision now');
      },
      chat: () => chatRes('vision text'),
    });
    const deps = baseDeps();
    const out = await finishVisionLive(deps, 'key', 'SYS');
    expect(out.read).toBe(1);
    expect(out.notes).toBe(1);
    // No OCR call; only the one non-blank page rendered + visioned.
    expect(
      fetchMock.mock.calls.some(c => String(c[0]).includes('/v1/ocr')),
    ).toBe(false);
    expect(deps.generateNotePng).toHaveBeenCalledTimes(1);
    expect(getPage(storeState.store, NOTE, 0)!.source).toBe('medium');
    expect(getPage(storeState.store, NOTE, 0)!.text).toBe('vision text');
    // The blank page is untouched (still an empty negative-cache entry).
    const blank = getPage(storeState.store, NOTE, 1)!;
    expect(blank.source).toBe('mistral-ocr');
    expect(blank.text).toBe('');
  });

  it('finishVisionLive: PDFs too (Option A) — Vision-only pass reuses OCR, no /v1/ocr', async () => {
    upsertPage(storeState.store, PDF, 0, entry('', {text: 'pdf ocr 0'}), 1);
    upsertPage(storeState.store, PDF, 1, entry('', {text: 'pdf ocr 1'}), 1);
    route({
      ocr: () => {
        throw new Error('OCR must NOT be called by Vision now (PDF)');
      },
      chat: () => chatRes('pdf vision'),
    });
    const out = await finishVisionLive(baseDeps(), 'key', 'SYS');
    expect(out.read).toBe(2);
    expect(
      fetchMock.mock.calls.some(c => String(c[0]).includes('/v1/ocr')),
    ).toBe(false);
    expect(getPage(storeState.store, PDF, 0)!.source).toBe('medium');
    expect(getPage(storeState.store, PDF, 0)!.text).toBe('pdf vision');
    expect(getPage(storeState.store, PDF, 1)!.source).toBe('medium');
  });

  // Review 2026-08-01 #2: a 401/429/network failure must NOT write the
  // per-rev "vision cannot improve this page" marker, or a quota outage
  // excludes the page from every future drain, permanently.
  it('finishVisionLive marks va only when Vision RAN and did not improve', async () => {
    upsertPage(storeState.store, NOTE, 0, entry(PA, {text: 'ocr 0', rev: 'a1'}), 1);
    upsertPage(storeState.store, NOTE, 1, entry(PB, {text: 'ocr 1', rev: 'b1'}), 1);
    pageIdsMock.mockResolvedValue(idMap(PA, PB));
    revsMock.mockResolvedValue(new Map([[0, 'a1'], [1, 'b1']]));
    let call = 0;
    route({
      chat: () => {
        call += 1;
        return call === 1 ? chatRes('') : httpErr(401);
      },
    });
    await finishVisionLive(baseDeps(), 'key', 'SYS', {kind: 'note'});
    // page 0: Vision ran and had nothing to add -> remembered at this rev
    expect(getPage(storeState.store, NOTE, 0)!.va).toBe('a1');
    // page 1: the request never landed -> still owed a pass, never marked
    expect(getPage(storeState.store, NOTE, 1)!.va).toBeUndefined();
  });

  it('finishVisionLive settling a page INVALIDATES the engine owed count (round-7/lifecycle audit)', async () => {
    // The drain runs AFTER the note loop's recordOwed. Settling an OCR-only
    // page (ocr->finished via the va marker) makes owed.vision stale-HIGH with
    // no recompute path for a stamped note — the drain must drop owed so the
    // readers fall back to the now-correct structural count (permanent phantom
    // "✓ vision…" / canSync stuck otherwise).
    upsertPage(storeState.store, NOTE, 0, entry(PA, {text: 'ocr 0', rev: 'a1'}), 1);
    pageIdsMock.mockResolvedValue(idMap(PA));
    revsMock.mockResolvedValue(new Map([[0, 'a1']]));
    // Engine recorded owed.vision=1 for this OCR-only page just before the drain.
    setOwed(storeState.store, NOTE, {read: 0, vision: 1}, 1);
    route({chat: () => chatRes('')}); // Vision runs, nothing to add -> settle
    await finishVisionLive(baseDeps(), 'key', 'SYS', {kind: 'note'});
    expect(getPage(storeState.store, NOTE, 0)!.va).toBe('a1'); // settled
    expect(getOwed(storeState.store, NOTE)).toBeNull(); // owed dropped, not stale
  });

  it('finishVisionLive render breaker (v0.87.2): a doomed host stops after 3 renders, later docs untouched', async () => {
    // Two PDFs with a big pending-Vision backlog, but NO PDF host: every
    // render fails. The old behaviour attempted every single page (a 3742-
    // page run flooded logcat for ~10 min); now the pass stops after
    // CONSEC_RENDER_BREAK attempts and the SECOND doc is never tried.
    for (let p = 0; p < 6; p++) {
      upsertPage(storeState.store, PDF, p, entry('', {text: `ocr ${p}`}), 1);
      upsertPage(storeState.store, '/Document/two.pdf', p, entry('', {text: `ocr ${p}`}), 1);
    }
    route({
      chat: () => {
        throw new Error('no render must reach the API');
      },
    });
    const deps = baseDeps({
      generateDocImage: jest.fn(async () => ({success: false})),
    });
    const out = await finishVisionLive(deps, 'key', 'SYS', {kind: 'pdf'});
    expect(deps.generateDocImage).toHaveBeenCalledTimes(3); // breaker, doc 1
    expect(out.read).toBe(0);
    expect(out.pending).toBe(12); // everything stays pending, retried later
    expect(fetchMock).not.toHaveBeenCalled(); // zero API spend
    // Nothing was promoted — the debt is intact for a tick under a PDF host.
    expect(getPage(storeState.store, PDF, 0)!.source).toBe('mistral-ocr');
  });
});

/* ---- Relocation (2026-08-03): moved notes/pages/PDFs inherit, never re-pay ---- */

describe('relocation by PAGEID (pagesNeedingRead)', () => {
  const OLD_NOTE = '/Note/archived/test.note';

  it('a whole note moved to a new folder recovers EVERY page for free', async () => {
    const s = storeState.store;
    // The old path's entries are still in the store (orphan after the move).
    upsertPage(s, OLD_NOTE, 0, entry(PA, {text: 'Un', rev: 'x1', low: [{t: 'w', c: 0.5}]}), 1);
    upsertPage(s, OLD_NOTE, 1, entry(PB, {text: 'Deux', source: 'medium', rev: 'x2'}), 1);
    const needed = await pagesNeedingRead(baseDeps(), NOTE, [0, 1]);
    expect(needed).toEqual([]); // nothing billed
    expect(getPage(s, NOTE, 0)!.text).toBe('Un');
    expect(getPage(s, NOTE, 1)!.text).toBe('Deux');
    expect(getPage(s, NOTE, 1)!.source).toBe('medium');
    // The ORIGINAL read datetime travels with the page (user report
    // 2026-08-03: the relocated pages must not show "now").
    expect(getPage(s, NOTE, 0)!.at).toBe(1);
    // Fresh stamps at the DESTINATION (its own footer addresses).
    expect(getPage(s, NOTE, 0)!.hash).toBe(PA);
    expect(getPage(s, NOTE, 0)!.rev).toBe('a1');
    // Copy, not steal: the donor keeps its entries.
    expect(getPage(s, OLD_NOTE, 0)!.text).toBe('Un');
    // Deep copy: low[] is not aliased.
    getPage(s, NOTE, 0)!.low![0].c = 0.9;
    expect(getPage(s, OLD_NOTE, 0)!.low![0].c).toBe(0.5);
  });

  it('a single page moved from another transcribed note is recovered, the rest read normally', async () => {
    const s = storeState.store;
    upsertPage(s, '/Note/other.note', 3, entry(PB, {text: 'Migrée', rev: 'z9'}), 1);
    // NOTE page 0 already valid; page 1 is the newcomer (PAGEID PB).
    setPageIds(s, NOTE, [PA, PB]);
    upsertPage(s, NOTE, 0, entry(PA, {rev: 'a1'}), 1);
    const needed = await pagesNeedingRead(baseDeps(), NOTE, [0, 1]);
    expect(needed).toEqual([]);
    expect(getPage(s, NOTE, 1)!.text).toBe('Migrée');
    expect(getPage(s, NOTE, 1)!.rev).toBe('b1'); // destination stamp
  });

  it('translates the vision-added-nothing marker to the destination rev', async () => {
    const s = storeState.store;
    upsertPage(s, OLD_NOTE, 0, entry(PA, {text: 'V', rev: 'x1', va: 'x1'}), 1);
    upsertPage(s, OLD_NOTE, 1, entry(PB, {text: 'W', rev: 'x2'}), 1);
    await pagesNeedingRead(baseDeps(), NOTE, [0, 1]);
    expect(getPage(s, NOTE, 0)!.va).toBe('a1'); // rev-keyed, translated
    expect(getPage(s, NOTE, 1)!.va).toBeUndefined();
  });

  it('the page LOCK travels with the page — a rename never unfreezes a correction', async () => {
    const s = storeState.store;
    upsertPage(s, OLD_NOTE, 0, entry(PA, {text: 'corrigé à la main', source: 'user', lock: true}), 1);
    upsertPage(s, OLD_NOTE, 1, entry(PB, {text: 'libre'}), 1);
    await pagesNeedingRead(baseDeps(), NOTE, [0, 1]);
    expect(getPage(s, NOTE, 0)!.lock).toBe(true); // frozen, like adoptPdfDoc
    expect(getPage(s, NOTE, 1)!.lock).toBeUndefined(); // and only that page
  });

  it('the pixel identity (vh) travels with the page — no bootstrap read after a move', async () => {
    const s = storeState.store;
    upsertPage(s, OLD_NOTE, 0, entry(PA, {text: 'Un', rev: 'x1', vh: 'nh:cafe1234'}), 1);
    upsertPage(s, OLD_NOTE, 1, entry(PB, {text: 'Deux', rev: 'x2'}), 1); // pre-1.0.4 donor, no vh
    await pagesNeedingRead(baseDeps(), NOTE, [0, 1]);
    expect(getPage(s, NOTE, 0)!.vh).toBe('nh:cafe1234'); // copied verbatim
    expect(getPage(s, NOTE, 1)!.vh).toBeUndefined(); // absent stays absent
  });

  it('an in-place edit is NEVER hijacked by a donor: same PAGEID on the entry → re-read', async () => {
    const s = storeState.store;
    setPageIds(s, NOTE, [PA, PB]);
    upsertPage(s, NOTE, 0, entry(PA, {text: 'stale', rev: 'a0'}), 1); // edited (rev moved)
    upsertPage(s, NOTE, 1, entry(PB, {rev: 'b1'}), 1);
    upsertPage(s, '/Note/other.note', 0, entry(PA, {text: 'donor'}), 1);
    expect(await pagesNeedingRead(baseDeps(), NOTE, [0, 1])).toEqual([0]);
    expect(getPage(s, NOTE, 0)!.text).toBe('stale'); // untouched, will be re-read
  });

  describe('rename follow-through', () => {
    const renameMock = jest.requireMock('./renameFollow') as {
      provenGone: jest.Mock;
      followRename: jest.Mock;
    };

    it('donor file PROVEN gone → the rename is followed through', async () => {
      const s = storeState.store;
      upsertPage(s, OLD_NOTE, 0, entry(PA, {text: 'Un'}), 1);
      upsertPage(s, OLD_NOTE, 1, entry(PB, {text: 'Deux'}), 1);
      renameMock.provenGone.mockResolvedValueOnce(true);
      await pagesNeedingRead(baseDeps(), NOTE, [0, 1]);
      expect(renameMock.provenGone).toHaveBeenCalledWith(OLD_NOTE);
      expect(renameMock.followRename).toHaveBeenCalledWith(OLD_NOTE, NOTE);
    });

    it('donor file still there (a COPY) → nothing is migrated or removed', async () => {
      const s = storeState.store;
      upsertPage(s, OLD_NOTE, 0, entry(PA, {text: 'Un'}), 1);
      upsertPage(s, OLD_NOTE, 1, entry(PB, {text: 'Deux'}), 1);
      renameMock.provenGone.mockResolvedValueOnce(false);
      await pagesNeedingRead(baseDeps(), NOTE, [0, 1]);
      expect(renameMock.followRename).not.toHaveBeenCalled();
      expect(getPage(s, OLD_NOTE, 0)!.text).toBe('Un'); // donor intact
    });

    it('only SOME of the donor moved → not a rename, never followed', async () => {
      const s = storeState.store;
      upsertPage(s, OLD_NOTE, 0, entry(PA, {text: 'Un'}), 1);
      upsertPage(s, OLD_NOTE, 1, entry(PB, {text: 'Deux'}), 1);
      upsertPage(s, OLD_NOTE, 2, entry(PC, {text: 'Trois'}), 1); // stays behind
      renameMock.provenGone.mockResolvedValue(true);
      await pagesNeedingRead(baseDeps(), NOTE, [0, 1]);
      expect(renameMock.followRename).not.toHaveBeenCalled();
    });
  });

  it('a locked destination doc is frozen — no free write either (spec S6)', async () => {
    const s = storeState.store;
    upsertPage(s, OLD_NOTE, 0, entry(PA, {text: 'Un'}), 1);
    setDocLock(s, NOTE, true);
    expect(await pagesNeedingRead(baseDeps(), NOTE, [0, 1])).toEqual([]);
    expect(getPage(s, NOTE, 0)).toBeNull(); // nothing materialized
  });
});

describe('vision "The page is blank." answers (collecte ①)', () => {
  it('a bare blank statement is stored as the EMPTY marker, not as text', async () => {
    const s = storeState.store;
    setPageIds(s, NOTE, [PA, PB]);
    route({
      ocr: () => ocrRes('', []), // OCR ran, saw nothing
      chat: () => chatRes('The page is blank.'),
    });
    const out = await readNotePages(baseDeps(), 'k', 'sys', NOTE, [0]);
    expect(out.ok).toBe(true);
    const e = getPage(s, NOTE, 0)!;
    expect(e.text).toBe(''); // negative-cache, not the sentence
    expect(e.source).toBe('mistral-ocr');
  });

  it('real content containing the word blank is stored untouched', async () => {
    const s = storeState.store;
    setPageIds(s, NOTE, [PA, PB]);
    route({
      ocr: () => ocrRes('notes', GOOD),
      chat: () => chatRes('The page is blank at the top, then: appeler Karim'),
    });
    await readNotePages(baseDeps(), 'k', 'sys', NOTE, [0]);
    expect(getPage(s, NOTE, 0)!.text).toContain('appeler Karim');
  });
});

describe('manual PDF Redo on a blank page (readPdfPageVision)', () => {
  // An ANNOTATED page (its ink layer is what makes an entry legitimate).
  const annDeps = () =>
    baseDeps({
      getMarkPages: jest.fn(async () => ({result: [0], success: true})),
    });

  it('a blank answer SUCCEEDS with an honest reason — never an error the user can re-tap forever', async () => {
    setDocHash(storeState.store, PDF, 'dh1');
    route({chat: () => chatRes('The page is blank.')});
    const out = await readPdfPageVision(baseDeps(), 'k', 'sys', PDF, 0);
    expect(out.ok).toBe(true); // used to be ok:false "Vision returned nothing."
    expect(out.reason).toContain('blank'); // the tap gets an answer
  });

  it('a PLAIN page with no entry gets NO invented entry (audit 2: it would block adoptPdfDoc)', async () => {
    const s = storeState.store;
    setDocHash(s, PDF, 'dh1');
    route({chat: () => chatRes('The page is blank.')});
    await readPdfPageVision(baseDeps(), 'k', 'sys', PDF, 0);
    // Inventing a page here would make a later move of this PDF re-OCR the
    // WHOLE file (adoption refuses a destination that already has pages).
    expect(getPage(s, PDF, 0)).toBeNull();
  });

  it('an ANNOTATED page with no entry gets the durable marker, like the automatic pass', async () => {
    const s = storeState.store;
    setDocHash(s, PDF, 'dh1');
    route({chat: () => chatRes('The page is blank.')});
    await readPdfPageVision(annDeps(), 'k', 'sys', PDF, 0);
    const e = getPage(s, PDF, 0)!;
    expect(e.text).toBe(''); // negative-cache
    expect(e.source).toBe('mistral-ocr');
    expect(e.va).toMatch(/^mh:/); // keyed to ITS pixels, not the doc
  });

  it('an Off-consent (eph) read marks that marker ephemeral — the boot wipe must reach it', async () => {
    const s = storeState.store;
    setDocHash(s, PDF, 'dh1');
    route({chat: () => chatRes('The page is blank.')});
    await readPdfPageVision(annDeps(), 'k', 'sys', PDF, 0, {
      offOk: true,
      eph: true,
    });
    expect(getPage(s, PDF, 0)!.eph).toBe(true); // audit 1 #1
  });

  it('a normal read never marks it ephemeral', async () => {
    const s = storeState.store;
    setDocHash(s, PDF, 'dh1');
    route({chat: () => chatRes('The page is blank.')});
    await readPdfPageVision(annDeps(), 'k', 'sys', PDF, 0);
    expect(getPage(s, PDF, 0)!.eph).toBeUndefined();
  });

  it('an existing OCR text is KEPT when the vision recheck comes back empty', async () => {
    const s = storeState.store;
    setDocHash(s, PDF, 'dh1');
    upsertPage(s, PDF, 0, entry('', {text: 'texte ocr'}), 1);
    route({chat: () => chatRes('')});
    const out = await readPdfPageVision(baseDeps(), 'k', 'sys', PDF, 0);
    expect(out.ok).toBe(true);
    expect(out.reason).toContain('nothing to add'); // distinct from blank
    const e = getPage(s, PDF, 0)!;
    expect(e.text).toBe('texte ocr'); // vision added nothing — text intact
    expect(e.va).toBe('d:dh1');
  });
});

describe('a CUT vision answer never wins (device report 2026-08-12)', () => {
  const cutRes = (text: string): FetchRes =>
    jsonRes({choices: [{message: {content: text}, finish_reason: 'length'}]});

  it('keeps the complete OCR text when the model stopped at its ceiling', async () => {
    const s = storeState.store;
    setPageIds(s, NOTE, [PA, PB]);
    route({
      ocr: () => ocrRes('le texte complet de la page', GOOD),
      chat: () => cutRes('le texte complet de la pa'),
    });
    await readNotePages(baseDeps(), 'k', 'sys', NOTE, [0]);
    const e = getPage(s, NOTE, 0)!;
    expect(e.text).toContain('le texte complet de la page'); // OCR kept
    expect(e.source).toBe('mistral-ocr');
    // N2 (full-scope audit): SETTLED at this rev — a retry at the same 4000
    // ceiling would only re-truncate and re-bill. It re-opens if the ink
    // changes (va keyed to the rev), never on the identical image.
    expect(e.va).toBe('a1');
  });

  it('an untruncated answer still wins as before', async () => {
    const s = storeState.store;
    setPageIds(s, NOTE, [PA, PB]);
    route({
      ocr: () => ocrRes('texte ocr', GOOD),
      chat: () => chatRes('texte vision complet'),
    });
    await readNotePages(baseDeps(), 'k', 'sys', NOTE, [0]);
    expect(getPage(s, NOTE, 0)!.source).toBe('medium');
  });

  it('OCR failed too: the CUT half is kept AND settled (no wasteful retry)', async () => {
    // With no OCR fallback, the truncated half is kept (partial beats blank) as
    // 'mistral-ocr' (never a final 'medium'), and N2: SETTLED — re-running
    // Vision at the same ceiling would only re-truncate and re-bill.
    const s = storeState.store;
    setPageIds(s, NOTE, [PA, PB]);
    route({
      ocr: () => httpErr(500), // OCR leg down → no fallback text
      chat: () => cutRes('la moitié transcrite avant le'),
    });
    await readNotePages(baseDeps(), 'k', 'sys', NOTE, [0]);
    const e = getPage(s, NOTE, 0)!;
    expect(e.text).toBe('la moitié transcrite avant le'); // partial kept
    expect(e.source).toBe('mistral-ocr'); // NOT 'medium'
    expect(e.va).toBe('a1'); // settled at this rev — no same-ceiling retry
  });
});

describe('vision landed but added nothing (release audit 2026-08-12)', () => {
  it('marks the page settled so the SAME tick\'s drain cannot re-bill it', async () => {
    const s = storeState.store;
    setPageIds(s, NOTE, [PA, PB]);
    route({
      ocr: () => ocrRes('du texte ocr', GOOD),
      chat: () => chatRes(''), // vision ran, had nothing to add
    });
    await readNotePages(baseDeps(), 'k', 'sys', NOTE, [0]);
    const e = getPage(s, NOTE, 0)!;
    expect(e.source).toBe('mistral-ocr');
    expect(e.text).toContain('du texte ocr');
    // The marker the drain reads: without it the page was collected again
    // and a second Vision call was paid on the identical image.
    expect(e.va).toBe(e.rev ?? '');
  });
});

describe('pdfPrintedCovered strips the legacy |m suffix (changed-PDF gate, audit 2026-08-14)', () => {
  it('a legacy "bytes|m<n>" docHash is covered when the bytes match', () => {
    // The "Check for changes" gate must NOT flag an unchanged legacy-suffix PDF
    // as changed — a raw h!==String(size) false-positived it into a permanent
    // owed.read phantom Sync-now could never clear.
    expect(pdfPrintedCovered({docHash: '1000|m50'}, 1000)).toBe(true);
    expect(pdfPrintedCovered({docHash: '1000'}, 1000)).toBe(true);
    expect(pdfPrintedCovered({docHash: '1000|m50'}, 1200)).toBe(false); // real change
    expect(pdfPrintedCovered(undefined, 1000)).toBe(false);
  });
});

describe('unchanged pixels settle free (collecte ②: write-then-erase)', () => {
  // The test renders go through the JS pipeline (bytesToBase64 of the PNG
  // fixture) — the pixel tag is deterministic.
  const PNG_B64 = require('../core/util/base64').bytesToBase64(
    new Uint8Array([1, 2, 3]),
  );
  const TAG = `nh64:${fnvHex(PNG_B64)}`;

  it('rev moved but pixels identical → rev re-stamped, zero API calls', async () => {
    const s = storeState.store;
    setPageIds(s, NOTE, [PA, PB]);
    upsertPage(s, NOTE, 0, entry(PA, {text: 'garde', rev: 'a0', vh: TAG, va: 'a0'}), 1);
    upsertPage(s, NOTE, 1, entry(PB, {rev: 'b1'}), 1);
    route({}); // any API call would throw 'unrouted'
    const out = await readNotePages(baseDeps(), 'k', 'sys', NOTE, [0, 1]);
    expect(out.ok).toBe(true);
    expect(out.read).toBe(0); // nothing billed
    const e = getPage(s, NOTE, 0)!;
    expect(e.text).toBe('garde'); // untouched
    expect(e.rev).toBe('a1'); // re-baselined to the live address
    expect(e.va).toBe('a1'); // the rev-keyed marker followed
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the pixel-skip settle INVALIDATES a stale owed (no phantom "N to sync")', async () => {
    // The rev re-stamp settles the page (pagesNeedingRead no longer flags it),
    // so a recorded owed.read=1 would persist as a phantom for direct callers
    // (readThenExport / gatherContext don't recompute owed).
    const s = storeState.store;
    setPageIds(s, NOTE, [PA]);
    upsertPage(s, NOTE, 0, entry(PA, {text: 'garde', rev: 'a0', vh: TAG, va: 'a0'}), 1);
    setOwed(s, NOTE, {read: 1, vision: 0}, 1);
    route({});
    await readNotePages(baseDeps(), 'k', 'sys', NOTE, [0]);
    expect(getPage(s, NOTE, 0)!.rev).toBe('a1'); // settled
    expect(getOwed(s, NOTE)).toBeNull(); // owed dropped, not stale
  });

  it('pixels actually changed → normal paid re-read, and the new vh is stamped', async () => {
    const s = storeState.store;
    setPageIds(s, NOTE, [PA, PB]);
    upsertPage(s, NOTE, 0, entry(PA, {text: 'vieux', rev: 'a0', vh: 'nh64:autre'}), 1);
    upsertPage(s, NOTE, 1, entry(PB, {rev: 'b1'}), 1);
    route({ocr: () => ocrRes('nouveau texte', GOOD), chat: () => chatRes('nouveau texte vision')});
    const out = await readNotePages(baseDeps(), 'k', 'sys', NOTE, [0, 1]);
    expect(out.read).toBe(1);
    const e = getPage(s, NOTE, 0)!;
    expect(e.text).toContain('nouveau');
    expect(e.vh).toBe(TAG); // stamped from this run's render
  });

  it('force (explicit Redo) always re-reads, identical pixels or not', async () => {
    const s = storeState.store;
    setPageIds(s, NOTE, [PA, PB]);
    upsertPage(s, NOTE, 0, entry(PA, {text: 'garde', rev: 'a1', vh: TAG}), 1);
    route({ocr: () => ocrRes('relu', GOOD), chat: () => chatRes('relu vision')});
    const out = await readNotePages(baseDeps(), 'k', 'sys', NOTE, [0], {force: true});
    expect(out.read).toBe(1);
    expect(getPage(s, NOTE, 0)!.text).toContain('relu');
  });
});

describe('blank-page skip (v1.0.2: no ink → no paid read)', () => {
  it('a 0-element page is negative-cached with stamps, without any API call', async () => {
    const s = storeState.store;
    setPageIds(s, NOTE, [PA, PB]);
    const counts = new Map([[0, 5], [1, 0]]); // page 1 is blank
    const deps = baseDeps({
      getElementCounts: jest.fn(async (p: number) => ({result: counts.get(p)})),
    });
    route({ocr: () => ocrRes('du texte', GOOD), chat: () => chatRes('vision text')});
    const out = await readNotePages(deps, 'k', 'sys', NOTE, [0, 1]);
    expect(out.ok).toBe(true);
    expect(out.read).toBe(2); // both covered — one paid, one free
    expect(getPage(s, NOTE, 0)!.text).toContain('vision text');
    const blank = getPage(s, NOTE, 1)!;
    expect(blank.text).toBe(''); // the negative-cache marker
    expect(blank.source).toBe('mistral-ocr');
    expect(blank.hash).toBe(PB); // stamped: not re-read until the ink changes
    expect(blank.rev).toBe('b1');
    // The blank page never reached the network: only page 0's OCR+Vision.
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it('a probe failure falls through to the normal paid read', async () => {
    const s = storeState.store;
    setPageIds(s, NOTE, [PA, PB]);
    const deps = baseDeps({
      getElementCounts: jest.fn(async () => {
        throw new Error('sdk down');
      }),
    });
    route({ocr: () => ocrRes('lu quand même', GOOD), chat: () => chatRes('v')});
    const out = await readNotePages(deps, 'k', 'sys', NOTE, [0]);
    expect(out.read).toBe(1);
    expect(getPage(s, NOTE, 0)!.text.length).toBeGreaterThan(0);
  });

  it('absent probe (old bridge / fakes) reads every page normally', async () => {
    setPageIds(storeState.store, NOTE, [PA, PB]);
    route({ocr: () => ocrRes('normal', GOOD), chat: () => chatRes('v')});
    const out = await readNotePages(baseDeps(), 'k', 'sys', NOTE, [0]);
    expect(out.read).toBe(1);
  });
});

describe('relocation survives the source remap (limbo, v1.0.1)', () => {
  // Device repro 2026-08-03 18:12: the tick remapped the SOURCE note
  // first ("0 moved, 3 dropped"), deleting the donor entries 400 ms
  // before the destination looked for them — 3 pages re-billed.
  it('entries dropped by the source remap are still adopted by the destination', async () => {
    const s = storeState.store;
    const SRC = '/Note/source.note';
    setPageIds(s, SRC, [PA, PB, PC]);
    upsertPage(s, SRC, 0, entry(PA, {text: 'reste', rev: 's1'}), 1);
    upsertPage(s, SRC, 1, entry(PB, {text: 'partie B', rev: 's2'}), 1);
    upsertPage(s, SRC, 2, entry(PC, {text: 'partie C', rev: 's3'}), 1);
    // The move: B and C left SRC. The source is remapped FIRST (the
    // unfavorable tick order) — its entries for B and C are dropped.
    const {remapDocPages} = jest.requireActual(
      '../core/store/transcriptStore',
    ) as typeof import('../core/store/transcriptStore');
    const r = remapDocPages(s, SRC, [PA]);
    expect(r.dropped).toBe(2);
    expect(getPage(s, SRC, 1)).toBeNull(); // donors GONE from the docs
    // NOW the destination (NOTE, pages PA'=PB, PC at 0/1) syncs.
    pageIdsMock.mockResolvedValue(idMap(PB, PC));
    revsMock.mockResolvedValue(new Map([[0, 'd1'], [1, 'd2']]));
    const needed = await pagesNeedingRead(baseDeps(), NOTE, [0, 1]);
    expect(needed).toEqual([]); // recovered from the LIMBO — not re-billed
    expect(getPage(s, NOTE, 0)!.text).toBe('partie B');
    expect(getPage(s, NOTE, 1)!.text).toBe('partie C');
    expect(getPage(s, NOTE, 1)!.rev).toBe('d2'); // destination stamps
  });
});

describe('PDF adoption by identity (readPdf)', () => {
  const NEW_PDF = '/Document/moved/doc.pdf';
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    // The no-adopt path falls through to the OCR leg, which reads the file
    // bytes through the GLOBAL fetch.
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array(16).buffer,
    })) as unknown as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it('a moved PDF inherits its transcripts — zero API calls', async () => {
    const s = storeState.store;
    upsertPage(s, PDF, 0, entry('', {text: 'page pdf', source: 'mistral-ocr', va: 'd:5000'}), 1);
    setDocHash(s, PDF, '5000');
    (
      jest.requireMock('./noteTranscripts') as {readFileSize: jest.Mock}
    ).readFileSize.mockImplementation(async (p: string) =>
      p === NEW_PDF ? 5000 : null,
    );
    route({}); // any API call would throw 'unrouted'
    const r = await readPdf(baseDeps(), 'k', 'sys', NEW_PDF, {
      skipVision: true,
    });
    expect(r.ok).toBe(true);
    expect(r.read).toBe(0);
    expect(getPage(s, NEW_PDF, 0)!.text).toBe('page pdf');
    expect(getDocHash(s, NEW_PDF)).toBe('5000');
    expect(getPage(s, PDF, 0)!.text).toBe('page pdf'); // donor intact
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a different byte length does NOT adopt (the changed file is re-read)', async () => {
    const s = storeState.store;
    upsertPage(s, PDF, 0, entry('', {text: 'old'}), 1);
    setDocHash(s, PDF, '5000');
    (
      jest.requireMock('./noteTranscripts') as {readFileSize: jest.Mock}
    ).readFileSize.mockImplementation(async (p: string) =>
      p === NEW_PDF ? 6000 : null,
    );
    route({ocr: () => ocrRes('fresh text', GOOD)});
    const r = await readPdf(baseDeps(), 'k', 'sys', NEW_PDF, {
      skipVision: true,
    });
    expect(r.ok).toBe(true);
    expect(getPage(s, NEW_PDF, 0)!.text).toContain('fresh text');
  });

  // 2026-08-10: a RENAMED PDF changes basename, so the same-name adoption
  // can never match it — the whole already-paid book was re-OCR'd.
  // The bytes-only renamed-PDF inference was DROPPED (owner decision,
  // simplification audit 2026-08-16): a renamed PDF is read fresh — a
  // bounded one-time re-bill instead of ~100 lines of guarded guessing on
  // the weakest identity in the store. Same-name adoption stays (above).
  it('a renamed PDF (same folder, same bytes, donor gone) is simply read fresh', async () => {
    const s = storeState.store;
    const RENAMED = '/Document/doc 2026.pdf';
    upsertPage(s, PDF, 0, entry('', {text: 'texte payé'}), 1);
    setDocHash(s, PDF, '5000');
    (
      jest.requireMock('./noteTranscripts') as {readFileSize: jest.Mock}
    ).readFileSize.mockImplementation(async (p: string) =>
      p === RENAMED ? 5000 : null,
    );
    route({ocr: () => ocrRes('lu à neuf', GOOD)});
    await readPdf(baseDeps(), 'k', 'sys', RENAMED, {skipVision: true});
    expect(getPage(s, RENAMED, 0)!.text).toContain('lu à neuf'); // re-billed once
    expect(getPage(s, PDF, 0)!.text).toBe('texte payé'); // donor untouched
  });

  // Audit 3 #3: an Off-consent read promises to store nothing, and its wipe
  // only removes the pages THAT run stored — adopted entries carry no eph
  // flag, so adopting into an Off doc would settle transcripts permanently.
  it('an Off-consent (eph) read never adopts — nothing settles into an Off document', async () => {
    const s = storeState.store;
    upsertPage(s, PDF, 0, entry('', {text: 'page pdf', source: 'mistral-ocr'}), 1);
    setDocHash(s, PDF, '5000');
    (
      jest.requireMock('./noteTranscripts') as {readFileSize: jest.Mock}
    ).readFileSize.mockImplementation(async (p: string) =>
      p === NEW_PDF ? 5000 : null,
    );
    route({ocr: () => ocrRes('lu une fois', GOOD)});
    await readPdf(baseDeps(), 'k', 'sys', NEW_PDF, {
      skipVision: true,
      offOk: true,
      eph: true,
    });
    // Whatever this run stored is eph (wiped after the answer); nothing was
    // inherited from the donor behind the user's back.
    const e = getPage(s, NEW_PDF, 0);
    expect(e?.text).not.toBe('page pdf');
    expect(getPage(s, PDF, 0)!.text).toBe('page pdf'); // donor untouched
  });
});

// K1 (release audit 2026-08-12, critical/privacy): a per-file Off decision is
// keyed by PATH; a rename strands the key so the new path re-inherits its
// folder's (possibly permissive) mode. The default-Off change closes this for
// UNTRACKED folders; isOffForRead closes it inside an Auto/Manual folder. The
// solo audit had cleared orphanedModeFor as "correct" but missed that it was
// never wired into the read gates — this pins that it now is.
describe('isOffForRead — an Off decision survives a rename', () => {
  const settingsMock = jest.requireMock('./settings') as {
    readSettings: jest.Mock;
  };
  const fsMock = jest.requireMock('./fs') as {listDirNative: jest.Mock};
  const renameMock = jest.requireMock('./renameFollow') as {
    provenGone: jest.Mock;
  };

  it('an explicitly Off path is Off (fast path, no folder listing)', async () => {
    settingsMock.readSettings.mockResolvedValueOnce({
      autoTargets: {'/Priv/a.note': {mode: 'off'}},
    });
    expect(await isOffForRead('/Priv/a.note')).toBe(true);
    expect(fsMock.listDirNative).not.toHaveBeenCalled();
  });

  it('an explicit non-Off decision AT the path wins over an Off folder', async () => {
    settingsMock.readSettings.mockResolvedValueOnce({
      autoTargets: {'/X': {mode: 'off'}, '/X/a.note': {mode: 'manual'}},
    });
    expect(await isOffForRead('/X/a.note')).toBe(false);
  });

  it('no stricter sibling in the folder → no listing, not Off', async () => {
    settingsMock.readSettings.mockResolvedValueOnce({
      autoTargets: {'/X': {mode: 'auto'}},
    });
    expect(await isOffForRead('/X/new.note')).toBe(false);
    expect(fsMock.listDirNative).not.toHaveBeenCalled();
  });

  it('a renamed Off note inside an Auto folder is STILL Off', async () => {
    // /Notes = Auto; Diary.note explicitly Off; renamed to Journal.note.
    settingsMock.readSettings.mockResolvedValueOnce({
      autoTargets: {'/Notes': {mode: 'auto'}, '/Notes/Diary.note': {mode: 'off'}},
    });
    fsMock.listDirNative.mockResolvedValueOnce([
      {name: 'Journal.note', isDir: false}, // Diary gone, this is the rename
    ]);
    renameMock.provenGone.mockResolvedValueOnce(true); // Diary.note proven absent
    expect(await isOffForRead('/Notes/Journal.note')).toBe(true);
  });

  it('two untracked siblings → ambiguous → refuses to force Off', async () => {
    settingsMock.readSettings.mockResolvedValueOnce({
      autoTargets: {'/Notes': {mode: 'auto'}, '/Notes/Diary.note': {mode: 'off'}},
    });
    fsMock.listDirNative.mockResolvedValueOnce([
      {name: 'Journal.note', isDir: false},
      {name: 'Other.note', isDir: false},
    ]);
    renameMock.provenGone.mockResolvedValueOnce(true);
    expect(await isOffForRead('/Notes/Journal.note')).toBe(false);
  });

  it('an empty/failed listing proves no absence → not Off', async () => {
    settingsMock.readSettings.mockResolvedValueOnce({
      autoTargets: {'/Notes': {mode: 'auto'}, '/Notes/Diary.note': {mode: 'off'}},
    });
    fsMock.listDirNative.mockResolvedValueOnce([]); // [] = empty OR failed
    expect(await isOffForRead('/Notes/Journal.note')).toBe(false);
  });
});

// ————— Lot 1+2 (2026-08-16): cleared-page repair & anti-bleed —————
describe('cleared-page repair (pageCount truth) & anti-bleed gates', () => {
  // 16 distinct ≥4-char tokens: a substantial host-independent OCR baseline.
  const RICH_OCR =
    'transformation indice energie regularite mental comportement semaine ' +
    'critere positif objectif balance centimetre evolution physique action hebdomadaire';
  const FOREIGN =
    'reunion alstom siemens faiveley stadler locomotive retrofit planning ' +
    'contrat freight direction projet documents techniques securite valider';

  const coveredPdf = (pageCount: number): void => {
    storeState.store.docs[PDF] = {
      usedAt: 0,
      docHash: '123',
      pageCount,
      pages: {},
    };
  };

  it('pendingVisionPages counts a CLEARED page of a covered PDF — legacy docs unchanged', () => {
    coveredPdf(3);
    upsertPage(storeState.store, PDF, 0, entry('', {text: 'k', source: 'medium'}), 1);
    upsertPage(storeState.store, PDF, 2, entry('', {text: 'k', source: 'medium'}), 1);
    expect(pendingVisionPages(storeState.store, PDF)).toEqual([1]);
    delete storeState.store.docs[PDF]!.pageCount; // legacy doc: no truth
    expect(pendingVisionPages(storeState.store, PDF)).toEqual([]);
  });

  it('the drain REPAIRS a cleared page: renders it, vision-reads it (empty hint), stores it', async () => {
    coveredPdf(2);
    upsertPage(storeState.store, PDF, 0, entry('', {text: 'kept', source: 'medium'}), 1);
    route({chat: () => chatRes('repaired page text')});
    // The repair only runs for the doc ON SCREEN and on a USER-INITIATED
    // pass (anti-bleed, audit + fix-audit 2026-08-16).
    const deps = baseDeps({getCurrentFilePath: async () => PDF});
    const out = await finishVisionLive(deps, 'key', 'SYS', {
      kind: 'pdf',
      attendedHint: true,
    });
    expect(out.read).toBe(1);
    const e = getPage(storeState.store, PDF, 1)!;
    expect(e.source).toBe('medium');
    expect(e.text).toBe('repaired page text');
    expect(deps.generateDocImage).toHaveBeenCalledTimes(1);
    expect(pendingVisionPages(storeState.store, PDF)).toEqual([]); // debt settled
  });

  it('a cleared page is NOT collected while ANOTHER doc is on screen or the pass is unattended (anti-bleed, no budget burn)', async () => {
    coveredPdf(2);
    upsertPage(storeState.store, PDF, 0, entry('', {text: 'kept', source: 'medium'}), 1);
    route({chat: () => chatRes('should never be called')});
    // Wrong host AND attended → filtered at collection (never enters budget).
    const deps = baseDeps(); // getCurrentFilePath → NOTE ≠ PDF
    const out = await finishVisionLive(deps, 'key', 'SYS', {
      kind: 'pdf',
      attendedHint: true,
    });
    expect(out.read).toBe(0);
    expect(getPage(storeState.store, PDF, 1)).toBeNull(); // nothing stored
    expect(deps.generateDocImage).not.toHaveBeenCalled(); // not even rendered
    // Right host but UNATTENDED (background tick) → also withheld.
    const deps2 = baseDeps({getCurrentFilePath: async () => PDF});
    await finishVisionLive(deps2, 'key', 'SYS', {kind: 'pdf'});
    expect(deps2.generateDocImage).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.filter(c => String(c[0]).includes('/chat/')).length,
    ).toBe(0); // zero paid calls either way
    // The debt REMAINS visible to every counter (not silently dropped).
    expect(pendingVisionPages(storeState.store, PDF)).toEqual([1]);
  });

  it('a cleared page whose vision finds NOTHING gets its negative-cache stub back (no re-bill loop)', async () => {
    coveredPdf(1);
    route({chat: () => chatRes('')}); // vision ran, nothing there
    const out = await finishVisionLive(
      baseDeps({getCurrentFilePath: async () => PDF}),
      'key',
      'SYS',
      {kind: 'pdf', attendedHint: true},
    );
    expect(out.read).toBe(0);
    const e = getPage(storeState.store, PDF, 0)!;
    expect(e).not.toBeNull();
    expect(e.text).toBe('');
    expect(e.source).toBe('mistral-ocr');
    expect(e.va).toBe('d:123'); // settled at this docHash
    expect(pendingVisionPages(storeState.store, PDF)).toEqual([]); // never re-billed
  });

  it('bleed-gate: vision text sharing NOTHING with a substantial OCR is rejected, page untouched', async () => {
    upsertPage(storeState.store, PDF, 0, entry('', {text: RICH_OCR}), 1);
    storeState.store.docs[PDF]!.docHash = '123';
    route({chat: () => chatRes(FOREIGN)});
    const out = await finishVisionLive(baseDeps(), 'key', 'SYS', {kind: 'pdf'});
    expect(out.read).toBe(0);
    const e = getPage(storeState.store, PDF, 0)!;
    expect(e.source).toBe('mistral-ocr'); // NOT promoted
    expect(e.text).toBe(RICH_OCR); // NOT overwritten
    // Audit #5/#9/#14: the rejection SETTLES the page durably (safe OCR text
    // kept, no vision re-bill every session / every chat resume) — the escape
    // is the explicit Redo with the PDF open.
    expect(e.va).toBe('d:123');
    fetchMock.mockClear();
    await finishVisionLive(baseDeps(), 'key', 'SYS', {kind: 'pdf'});
    expect(
      fetchMock.mock.calls.filter(c => String(c[0]).includes('/chat/')).length,
    ).toBe(0); // second pass: no paid retry
  });

  it('bleed-tripwire: the same content-bearing render for two pages defers the second for FREE', async () => {
    upsertPage(storeState.store, PDF, 0, entry('', {text: 'aa'}), 1);
    upsertPage(storeState.store, PDF, 1, entry('', {text: 'bb'}), 1);
    storeState.store.docs[PDF]!.docHash = '123';
    route({chat: () => chatRes('short vision')});
    // Every render returns the SAME >60 KB image — the host-stuck signature.
    const big = new Uint8Array(60_100).fill(7).buffer;
    const deps = baseDeps({
      fetchFn: async () => ({ok: true, arrayBuffer: async () => big}),
    });
    const out = await finishVisionLive(deps, 'key', 'SYS', {kind: 'pdf'});
    expect(out.read).toBe(1); // page 0 read normally
    expect(getPage(storeState.store, PDF, 1)!.source).toBe('mistral-ocr'); // deferred
    // The duplicate render never reached the paid API.
    expect(
      fetchMock.mock.calls.filter(c => String(c[0]).includes('/chat/')).length,
    ).toBe(1);
  });

  it('Redo (readPdfPageVision): a contested vision text is NOT fed back as hint; OCR text still is', async () => {
    upsertPage(
      storeState.store,
      PDF,
      0,
      entry('', {text: 'contaminatedwork text from another doc', source: 'medium'}),
      1,
    );
    storeState.store.docs[PDF]!.docHash = '123';
    route({chat: () => chatRes('clean fresh transcription')});
    const out = await readPdfPageVision(baseDeps(), 'key', 'SYS', PDF, 0);
    expect(out.ok).toBe(true);
    const chatCall = fetchMock.mock.calls.find(c =>
      String(c[0]).includes('/chat/'),
    )!;
    const body = String((chatCall[1] as {body?: unknown})?.body ?? '');
    expect(body).not.toContain('contaminatedwork'); // no parroting seed
    expect(getPage(storeState.store, PDF, 0)!.text).toBe(
      'clean fresh transcription',
    );

    // …while a trusted OCR text IS still passed (quality preserved).
    fetchMock.mockClear();
    upsertPage(
      storeState.store,
      PDF,
      0,
      entry('', {text: 'trustedocr baseline words', source: 'mistral-ocr'}),
      1,
    );
    route({chat: () => chatRes('improved from ocr')});
    await readPdfPageVision(baseDeps(), 'key', 'SYS', PDF, 0);
    const call2 = fetchMock.mock.calls.find(c => String(c[0]).includes('/chat/'))!;
    expect(String((call2[1] as {body?: unknown})?.body ?? '')).toContain(
      'trustedocr',
    );
  });
});

// Lot 3 (2026-08-16): the covered-PDF resume pass answers to the SAME
// per-page vision cap as the tick's drain — it used to be uncapped
// (audit 2026-07-30 #1 / fix-audit D14: a deterministically failing page
// was re-billed on every covered read, forever).
it('resume pass: a vision-capped page is not re-billed and holds the doorbell', async () => {
  upsertPage(storeState.store, PDF, 0, entry('', {text: 'ocr text pending vision'}), 1);
  setDocHash(storeState.store, PDF, '5');
  storeState.store.docs[PDF]!.markSz = 41; // doorbell rings (live mark = 42)
  const nt = jest.requireMock('./noteTranscripts') as {readFileSize: jest.Mock};
  nt.readFileSize.mockImplementation(async (p2: string) =>
    p2.endsWith('.mark') ? 42 : 5,
  );
  noteFailure('vision', PDF, 0);
  noteFailure('vision', PDF, 0);
  noteFailure('vision', PDF, 0); // capped
  route({
    chat: () => {
      throw new Error('capped page must not reach the paid model');
    },
  });
  const r = await readPdf(baseDeps(), 'key', 'SYS', PDF);
  expect(r.ok).toBe(true);
  expect(r.read).toBe(0);
  expect(getPage(storeState.store, PDF, 0)!.source).toBe('mistral-ocr');
  expect(storeState.store.docs[PDF]!.markSz).toBe(41); // doorbell HELD open
});

// Fix-audit lot-3 #0: a PAID OCR that parses to zero pages is a FAILURE at
// the source (ok:false) — the tick's doc counter keys on ok alone, so a
// successful covered no-op can never park a healthy document again.
it('readPdf: OCR parsing to 0 pages returns ok:false (paid, nothing stored)', async () => {
  const nt = jest.requireMock('./noteTranscripts') as {readFileSize: jest.Mock};
  nt.readFileSize.mockImplementation(async () => 5);
  const realFetch = globalThis.fetch;
  globalThis.fetch = jest.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5]).buffer,
  })) as unknown as typeof fetch;
  route({ocr: () => jsonRes({pages: []})});
  const r = await readPdf(baseDeps(), 'key', 'SYS', PDF);
  globalThis.fetch = realFetch;
  expect(r.ok).toBe(false);
  expect(String((r as {reason?: string}).reason)).toContain('no readable pages');
  expect(getDocHash(storeState.store, PDF)).toBe(''); // nothing stamped
});

// Fix-audit lot-3 #2: an explicit Redo that stores clears the page's vision
// backoff — the page it just proved readable is reachable again.
it('readPdfPageVision success clears the vision fail ledger for that page', async () => {
  upsertPage(storeState.store, PDF, 0, entry('', {text: 'ocr'}), 1);
  storeState.store.docs[PDF]!.docHash = '123';
  noteFailure('vision', PDF, 0);
  noteFailure('vision', PDF, 0);
  noteFailure('vision', PDF, 0); // capped
  route({chat: () => chatRes('fresh redo text')});
  const out = await readPdfPageVision(baseDeps(), 'key', 'SYS', PDF, 0);
  expect(out.ok).toBe(true);
  const {failCount} = jest.requireActual('./failLedger') as typeof import('./failLedger');
  expect(failCount('vision', PDF, 0)).toBe(0);
});
