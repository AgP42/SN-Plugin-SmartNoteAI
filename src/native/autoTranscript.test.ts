// CHARACTERIZATION tests for the Auto pass (autoTranscript.ts): pin the
// scheduling rules — throttle, trigger scope, footer-signature skip,
// per-tick budget, current-page deferral, consent/key gate — with the
// paid engine ('./reading') MOCKED so no orchestration below is re-run;
// we assert the call patterns and the stamp bookkeeping only.
//
// Module-level state (lastTickAt, sessionPaidPages) survives between
// tests on purpose: Date.now is spied and advanced past the 20 s throttle
// in beforeEach, and mocked reads stay far below MAX_PAGES_PER_SESSION.

import type {CaptureDeps} from './capture';
import {
  autoTranscriptTick,
  MAX_PAGES_PER_TICK,
  getManualStale,
  setManualStale,
  getLastSyncAt,
  startAutoScheduler,
  pokeAuto,
  __setBootAtForTests,
} from './autoTranscript';
import {readSettings} from './settings';
import {getApiKey} from './secureKey';
import {
  pagesNeedingRead,
  readNotePages,
  readPdf,
  syncNotePages,
  finishVisionLive,
} from './reading';
import {readFooterRevs, readFileSize} from './noteTranscripts';
import {footerSignature} from '../core/notefile/footerSig';
import {
  emptyStore,
  getStamp,
  setStamp,
  setPageIds,
  setDocHash,
  type Store,
} from '../core/store/transcriptStore';

jest.mock('./settings', () => ({readSettings: jest.fn(), updateSettings: jest.fn(async () => true)}));
jest.mock('./secureKey', () => ({getApiKey: jest.fn()}));
jest.mock('./fs', () => ({listDirNative: jest.fn(async () => [])}));
jest.mock('./reading', () => ({
  isNotePath: (p: string) => /\.note$/i.test(p),
  pagesNeedingRead: jest.fn(async () => []),
  readNotePages: jest.fn(async () => ({ok: true, read: 0, failed: []})),
  readPdf: jest.fn(async () => ({ok: true, read: 0, failed: []})),
  syncNotePages: jest.fn(async () => undefined),
  // The PDF pre-gate folds the .mark size into the hash exactly like readPdf.
  markFilePath: (p: string) => `${p}.mark`,
  pdfDocHash: (pdfSize: number) => `${pdfSize}`,
  // Phase B helpers — same tolerant logic as the real ones.
  pdfPrintedCovered: (doc: {docHash: string} | undefined, bytes: number) => {
    if (doc === undefined) {
      return false;
    }
    const bar = doc.docHash.indexOf('|');
    return (bar >= 0 ? doc.docHash.slice(0, bar) : doc.docHash) === String(bytes);
  },
  pdfMarkSzOf: (doc: {docHash: string; markSz?: number} | undefined) => {
    if (doc === undefined) {
      return 0;
    }
    if (doc.markSz !== undefined) {
      return doc.markSz;
    }
    const m = doc.docHash.match(/\|m(\d+)$/);
    return m !== null ? Number(m[1]) : 0;
  },
  pendingVisionPages: jest.fn(() => []),
  pagesOwedVision: jest.fn(() => []),
  finishVisionLive: jest.fn(async () => ({
    read: 0,
    pending: 0,
    truncated: 0,
    notes: 0,
  })),
}));
jest.mock('./noteTranscripts', () => ({
  readLandscapePages: jest.fn(async () => new Set()),
  readFooterRevs: jest.fn(async () => new Map()),
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
const settingsMock = readSettings as jest.MockedFunction<typeof readSettings>;
const keyMock = getApiKey as jest.MockedFunction<typeof getApiKey>;
const needMock = pagesNeedingRead as jest.MockedFunction<
  typeof pagesNeedingRead
>;
const readMock = readNotePages as jest.MockedFunction<typeof readNotePages>;
const syncMock = syncNotePages as jest.MockedFunction<typeof syncNotePages>;
const revsMock = readFooterRevs as jest.MockedFunction<
  typeof readFooterRevs
>;
const readPdfMock = readPdf as jest.MockedFunction<typeof readPdf>;
const fileSizeMock = readFileSize as jest.MockedFunction<typeof readFileSize>;
const fvMock = finishVisionLive as jest.MockedFunction<typeof finishVisionLive>;
const pendingVisionMock = (
  jest.requireMock('./reading') as {pendingVisionPages: jest.Mock}
).pendingVisionPages;

const NOTE = '/Note/tracked.note';
const REVS = new Map([
  [0, 'r0'],
  [1, 'r1'],
  [2, 'r2'],
]);
// Stamps carry the 'v2:' epoch prefix (2026-07-18): pre-epoch stamps are
// deliberately invalid so the poisoned ones from the buggy stamping are
// re-checked once.
const SIG = 'v2:' + footerSignature(REVS);

// Default host = the NOTE app (an untracked note is open): most suites pin
// note-side behaviour, and since the v0.87 host split an UNKNOWN host means
// "no renders" — the old `null` default would skip every note. The unknown
// host has its own tests below.
const deps = (over: Partial<CaptureDeps> = {}): CaptureDeps => ({
  getCurrentFilePath: async () => '/Note/other-open.note',
  getCurrentPageNum: async () => null,
  getPluginDirPath: async () => '/plugin',
  generateNotePng: async () => ({success: true}),
  generateDocImage: async () => ({success: true}),
  getCurrentDocText: async () => ({result: ''}),
  getNoteTotalPageNum: async () => 3,
  saveCurrentNote: jest.fn(async () => ({success: true})),
  deleteFile: async () => true,
  fetchFn: async () => ({ok: true, arrayBuffer: async () => new ArrayBuffer(1)}),
  ...over,
});

let nowMs = 1_000_000_000;
let dateSpy: jest.SpyInstance<number, []>;
beforeAll(() => {
  dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
});
afterAll(() => {
  dateSpy.mockRestore();
});

beforeEach(() => {
  jest.clearAllMocks();
  nowMs += 60_000; // past MIN_TICK_GAP_MS, each test starts unthrottled
  __setBootAtForTests(0); // startup grace elapsed (pinned in its own test)
  storeState.store = emptyStore();
  settingsMock.mockResolvedValue({autoTargets: {[NOTE]: {mode: 'auto'}}});
  keyMock.mockResolvedValue({
    key: 'sk-test',
    legacyFilePresent: false,
    migrated: false,
  });
  needMock.mockResolvedValue([]);
  readMock.mockResolvedValue({ok: true, read: 0, failed: []});
  readPdfMock.mockResolvedValue({ok: true, read: 0, failed: []});
  syncMock.mockResolvedValue(undefined);
  revsMock.mockResolvedValue(REVS);
  // Re-pin the drain defaults: tests below swap implementations and
  // clearAllMocks does not restore factory ones.
  fvMock.mockImplementation(async () => ({
    read: 0,
    pending: 0,
    truncated: 0,
    notes: 0,
  }));
  pendingVisionMock.mockImplementation(() => []);
});

describe('autoTranscriptTick scheduling', () => {
  it('startup grace (v0.67): automatic ticks wait 60s after boot, force does not', async () => {
    __setBootAtForTests(nowMs); // process just started
    const auto = await autoTranscriptTick(deps());
    expect(auto.ran).toBe(false); // cold storm deferred
    const forced = await autoTranscriptTick(deps(), {force: true, trigger: 'sync'});
    expect(forced.ran).toBe(true); // the user's own button never waits
    nowMs += 61_000; // grace elapsed
    const later = await autoTranscriptTick(deps());
    expect(later.ran).toBe(true);
  });

  it('throttles: a second tick within 20s no-ops; force bypasses', async () => {
    const d = deps();
    const first = await autoTranscriptTick(d);
    expect(first.ran).toBe(true);
    settingsMock.mockClear();
    nowMs += 5_000;
    const second = await autoTranscriptTick(d);
    expect(second).toEqual({ran: false, notesChecked: 0, pagesRead: 0});
    expect(settingsMock).not.toHaveBeenCalled(); // gated before any IO
    const forced = await autoTranscriptTick(d, {force: true});
    expect(forced.ran).toBe(true);
    expect(settingsMock).toHaveBeenCalledTimes(1);
  });

  it('nothing tracked → ran:false, no reads', async () => {
    settingsMock.mockResolvedValue({});
    const out = await autoTranscriptTick(deps());
    expect(out).toEqual({ran: false, notesChecked: 0, pagesRead: 0});
    expect(needMock).not.toHaveBeenCalled();
    expect(readMock).not.toHaveBeenCalled();
  });

  it("trigger 'background' skips manual targets; 'sync' includes them", async () => {
    settingsMock.mockResolvedValue({autoTargets: {[NOTE]: {mode: 'manual'}}});
    needMock.mockResolvedValue([0]);
    const bg = await autoTranscriptTick(deps());
    expect(bg.ran).toBe(true);
    expect(bg.notesChecked).toBe(1); // seen, but left for an explicit Sync
    // v0.53: the background pass now computes the FREE stale count (rev
    // compare via pagesNeedingRead) so an edited Manual page shows as
    // "to sync" — but the PAID read still waits for a Sync button.
    expect(needMock).toHaveBeenCalled();
    expect(readMock).not.toHaveBeenCalled();

    nowMs += 60_000;
    readMock.mockResolvedValue({ok: true, read: 1, failed: []});
    const sync = await autoTranscriptTick(deps(), {trigger: 'sync'});
    expect(needMock).toHaveBeenCalledWith(expect.anything(), NOTE, [0, 1, 2]);
    expect(readMock).toHaveBeenCalledWith(
      expect.anything(),
      'sk-test',
      expect.any(String),
      NOTE,
      [0],
    );
    expect(sync.pagesRead).toBe(1);
  });

  it('unchanged footer signature skips the note; a changed one re-syncs and re-stamps', async () => {
    setStamp(storeState.store, NOTE, SIG);
    const out = await autoTranscriptTick(deps());
    expect(out.ran).toBe(true);
    expect(syncMock).not.toHaveBeenCalled(); // zero IO beyond the footer
    expect(needMock).not.toHaveBeenCalled();

    nowMs += 60_000;
    const moved = new Map(REVS);
    moved.set(2, 'MOVED');
    revsMock.mockResolvedValue(moved);
    needMock.mockResolvedValue([2]);
    readMock.mockResolvedValue({ok: true, read: 1, failed: []});
    await autoTranscriptTick(deps());
    expect(syncMock).toHaveBeenCalledWith(expect.anything(), NOTE, true);
    expect(readMock).toHaveBeenCalledWith(
      expect.anything(),
      'sk-test',
      expect.any(String),
      NOTE,
      [2],
    );
    // Whole backlog fit the budget AND read ok → the NEW sig is stamped.
    expect(getStamp(storeState.store, NOTE)).toBe('v2:' + footerSignature(moved));
  });

  it('a page that FAILS to read is NOT stamped → the note is retried (device bug 2026-07-18)', async () => {
    // Fresh sig, a page needs reading, but the read fails (render/API).
    const moved = new Map(REVS);
    moved.set(2, 'X');
    revsMock.mockResolvedValue(moved);
    needMock.mockResolvedValue([2]);
    readMock.mockResolvedValue({ok: false, read: 0, failed: [2], reason: 'render failed'});
    await autoTranscriptTick(deps(), {force: true});
    // Stamping on ATTEMPT would have marked the note covered and skipped it
    // forever (the "2 pages to read that never drains" symptom). It must
    // stay UNstamped so the next tick retries.
    expect(getStamp(storeState.store, NOTE)).not.toBe('v2:' + footerSignature(moved));

    // v0.47: plain `force` (Sync now) TRUSTS the stamp — bypassing it made
    // every Sync now re-walk the whole Manual library (minutes of bridge
    // IO for 2 pages, device report 2026-07-18). The deep bypass is now
    // opt-in via `deepRecheck` (the free "Check all notes for changes").
    setStamp(storeState.store, NOTE, 'v2:' + footerSignature(moved));
    needMock.mockClear();
    needMock.mockResolvedValue([2]);
    readMock.mockResolvedValue({ok: true, read: 1, failed: []});
    await autoTranscriptTick(deps(), {force: true, trigger: 'sync'});
    expect(needMock).not.toHaveBeenCalled(); // stamped + unchanged → skipped
    await autoTranscriptTick(deps(), {
      force: true,
      trigger: 'sync',
      deepRecheck: true,
    });
    expect(needMock).toHaveBeenCalled(); // the deep path still re-checks
  });

  it('a stamped note whose STORE shows unread pages is re-checked (v0.52 phantom fix)', async () => {
    // The stamp asserts "covered" from the footer alone; if the store
    // loses entries AFTER stamping (remap on a partial parse, eviction),
    // the note was skipped forever while the frame counted the hole
    // ("2 pages to sync" that no Sync could drain).
    const moved = new Map(REVS);
    revsMock.mockResolvedValue(moved);
    setStamp(storeState.store, NOTE, 'v2:' + footerSignature(moved));
    // Structural snapshot says 3 pages; the store has NO entries → 3
    // pending from the store's point of view.
    setPageIds(storeState.store, NOTE, [
      'P20260101000000000001aaaaaaaaaaaa',
      'P20260101000000000002bbbbbbbbbbbb',
      'P20260101000000000003cccccccccccc',
    ]);
    needMock.mockClear();
    needMock.mockResolvedValue([]);
    await autoTranscriptTick(deps(), {force: true, trigger: 'sync'});
    expect(needMock).toHaveBeenCalled(); // stamp matched, store overruled it
  });

  it('caps a tick at MAX_PAGES_PER_TICK and postpones the rest (stamp NOT written)', async () => {
    const d = deps({getNoteTotalPageNum: async () => 150});
    const all = Array.from({length: 150}, (_, i) => i);
    needMock.mockResolvedValue(all);
    readMock.mockImplementation(async (_d, _k, _p, _n, todo) => ({
      ok: true,
      read: todo.length,
      failed: [],
    }));
    const out = await autoTranscriptTick(d);
    expect(readMock).toHaveBeenCalledTimes(1);
    expect(readMock.mock.calls[0][4]).toEqual(
      all.slice(0, MAX_PAGES_PER_TICK),
    );
    expect(out.pagesRead).toBe(MAX_PAGES_PER_TICK);
    // Postponed backlog → no stamp, the note retries next tick.
    expect(getStamp(storeState.store, NOTE)).toBe('');
  });

  it('defers the currently displayed page (read once you leave it)', async () => {
    const d = deps({
      getCurrentFilePath: async () => NOTE,
      getCurrentPageNum: async () => 2,
    });
    needMock.mockResolvedValue([0, 1, 2]);
    readMock.mockResolvedValue({ok: true, read: 2, failed: []});
    const out = await autoTranscriptTick(d);
    expect(d.saveCurrentNote).toHaveBeenCalled(); // current note flushed
    expect(readMock.mock.calls[0][4]).toEqual([0, 1]); // p2 filtered out
    expect(out.pagesRead).toBe(2);
    // A5 (audit 2026-07-18): the deferred page is NOT covered, so the note
    // must stay UNstamped — a stamp here froze it at "1 page to read".
    expect(getStamp(storeState.store, NOTE)).toBe('');
  });

  it('includeCurrent (v0.87.1): a config-view poke reads the current page too', async () => {
    // Device repro 2026-07-30: the edited page WAS the note's current page,
    // and sitting in the Library never releases the deferral (the note
    // behind stays on that page). Config-view pokes say the note cannot
    // receive ink → the background tick reads the page like Sync now does.
    const d = deps({
      getCurrentFilePath: async () => NOTE,
      getCurrentPageNum: async () => 2,
    });
    needMock.mockResolvedValue([2]);
    readMock.mockResolvedValue({ok: true, read: 1, failed: []});
    const out = await autoTranscriptTick(d, {force: true, includeCurrent: true});
    expect(readMock.mock.calls[0][4]).toEqual([2]); // NOT deferred
    expect(out.pagesRead).toBe(1);
    expect(getStamp(storeState.store, NOTE)).toBe(SIG); // fully covered
  });

  it("pre-epoch stamp (no 'v2:') is invalid → the note is re-checked and re-stamped", async () => {
    // The 2026-07-17 code stamped notes whose pages were never read; the
    // epoch bump invalidates every such stamp in one shot.
    setStamp(storeState.store, NOTE, footerSignature(REVS)); // old format
    needMock.mockResolvedValue([]);
    const out = await autoTranscriptTick(deps());
    expect(out.ran).toBe(true);
    expect(needMock).toHaveBeenCalled(); // NOT skipped despite matching revs
    expect(getStamp(storeState.store, NOTE)).toBe(SIG); // re-stamped as v2
  });

  it('a page failing repeatedly is retried at most 3 times, then skipped without a stamp (A4)', async () => {
    const NOTE2 = '/Note/cursed.note';
    settingsMock.mockResolvedValue({autoTargets: {[NOTE2]: {mode: 'auto'}}});
    needMock.mockResolvedValue([1]);
    readMock.mockResolvedValue({ok: false, read: 0, failed: [1], reason: 'blank render'});
    for (let i = 0; i < 3; i++) {
      await autoTranscriptTick(deps(), {force: true});
      nowMs += 60_000;
    }
    expect(readMock).toHaveBeenCalledTimes(3);
    // 4th tick: the page is over the failure cap → no paid attempt at all,
    // and the note stays unstamped (visible as still-to-read, not billed).
    await autoTranscriptTick(deps(), {force: true});
    expect(readMock).toHaveBeenCalledTimes(3);
    expect(getStamp(storeState.store, NOTE2)).toBe('');
  });

  it('no consent needed any more: the paid read runs without the dialog flag (user decision 2026-07-19)', async () => {
    storeState.store = emptyStore(); // globalConsent absent — must not matter
    needMock.mockResolvedValue([0]);
    const out = await autoTranscriptTick(deps());
    expect(out.ran).toBe(true);
    expect(readMock).toHaveBeenCalled(); // the accidental-reset Auto starvation is dead
  });

  it('missing API key: paid read skipped, stamp unwritten', async () => {
    keyMock.mockResolvedValue({
      key: null,
      legacyFilePresent: false,
      migrated: false,
    });
    needMock.mockResolvedValue([0]);
    const out = await autoTranscriptTick(deps());
    expect(out.ran).toBe(true);
    expect(readMock).not.toHaveBeenCalled();
    expect(getStamp(storeState.store, NOTE)).toBe('');
  });
});

describe('manualStale after a paid pass (audit 2026-07-19 E1)', () => {
  it('a Sync covering the whole manual backlog PURGES the stale counter', async () => {
    settingsMock.mockResolvedValue({autoTargets: {[NOTE]: {mode: 'manual'}}});
    setManualStale(NOTE, 2);
    needMock.mockResolvedValue([0, 1]);
    readMock.mockResolvedValue({ok: true, read: 2, failed: []});
    await autoTranscriptTick(deps(), {trigger: 'sync'});
    // "N to sync · ~X €" used to keep showing pages already paid for.
    expect(getManualStale().has(NOTE)).toBe(false);
  });

  it('a PARTIAL paid pass leaves the honest residual count', async () => {
    settingsMock.mockResolvedValue({autoTargets: {[NOTE]: {mode: 'manual'}}});
    setManualStale(NOTE, 2);
    needMock.mockResolvedValue([0, 1]);
    readMock.mockResolvedValue({ok: false, read: 1, failed: [1]});
    await autoTranscriptTick(deps(), {trigger: 'sync'});
    expect(getManualStale().get(NOTE)).toBe(1); // one page still owed
  });
});

// The PDF pre-gate must fold the .mark size in exactly like readPdf's own
// covered-check, or an annotation added to an already-read PDF (its bytes
// unchanged) is silently skipped by Auto and "Sync now".
describe('PDF .mark change gate (audit 2026-07-28)', () => {
  const PDF = '/Document/book.pdf';
  beforeEach(() => {
    settingsMock.mockResolvedValue({autoTargets: {[PDF]: {mode: 'auto'}}});
  });
  afterEach(() => {
    fileSizeMock.mockResolvedValue(null); // restore for other suites
  });

  it('a NEW annotation (PDF bytes unchanged) is NOT skipped — readPdf runs', async () => {
    setDocHash(storeState.store, PDF, '100'); // read before, no annotation yet
    fileSizeMock.mockImplementation(async (p: string) =>
      p.endsWith('.mark') ? 42 : 100,
    );
    await autoTranscriptTick(deps(), {trigger: 'sync', force: true});
    expect(readPdfMock).toHaveBeenCalledTimes(1);
  });

  it('a genuinely unchanged PDF (same bytes AND same .mark, no pending Vision) is skipped', async () => {
    setDocHash(storeState.store, PDF, '100|m42');
    fileSizeMock.mockImplementation(async (p: string) =>
      p.endsWith('.mark') ? 42 : 100,
    );
    await autoTranscriptTick(deps(), {trigger: 'sync', force: true});
    expect(readPdfMock).not.toHaveBeenCalled();
  });

  it('a covered PDF with pending Vision is left to the DRAIN (v0.87.4 — never the uncapped resume)', async () => {
    setDocHash(storeState.store, PDF, '100|m42');
    fileSizeMock.mockImplementation(async (p: string) =>
      p.endsWith('.mark') ? 42 : 100,
    );
    pendingVisionMock.mockReturnValue([2, 5]); // Vision pending
    const d = deps({getCurrentFilePath: async () => '/Document/open.pdf'});
    await autoTranscriptTick(d, {trigger: 'sync', force: true});
    // The tick must NOT call readPdf (its resume path has no budget, no
    // visionFails cap — audit 2026-07-30 #1); the capped drain owns it.
    expect(readPdfMock).not.toHaveBeenCalled();
    expect(fvMock).toHaveBeenCalledTimes(1);
  });
});

// v0.87 host split: a note needs a NOTE host for both legs; a PDF's OCR is
// host-independent (/v1/ocr on the bytes) and only its Vision legs render.
describe('host split (v0.87)', () => {
  const PDF = '/Document/book.pdf';
  afterEach(() => {
    fileSizeMock.mockResolvedValue(null);
  });

  it('v0.87.4 probe: under a PDF host the FIRST note read probes; renderAborted stands the rest down', async () => {
    const NOTE2 = '/Note/second.note';
    settingsMock.mockResolvedValue({
      autoTargets: {[NOTE]: {mode: 'auto'}, [NOTE2]: {mode: 'auto'}},
    });
    needMock.mockResolvedValue([0]);
    readMock.mockResolvedValue({
      ok: false,
      read: 0,
      failed: [0],
      renderFailed: [0],
      renderAborted: true,
      reason: 'no note host',
    });
    const d = deps({getCurrentFilePath: async () => '/Document/open.pdf'});
    const out = await autoTranscriptTick(d, {force: true});
    expect(out.ran).toBe(true);
    // One probe attempt only — the second note is NOT tried this tick.
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it('v0.87.4 probe: an UNKNOWN host still attempts (the breaker bounds the cost)', async () => {
    needMock.mockResolvedValue([0]);
    readMock.mockResolvedValue({ok: true, read: 1, failed: []});
    const d = deps({getCurrentFilePath: async () => null});
    const out = await autoTranscriptTick(d, {force: true});
    expect(out.ran).toBe(true);
    expect(readMock).toHaveBeenCalledTimes(1); // probed, and it worked
  });

  it('a changed PDF gets its OCR under a NOTE host — Vision deferred (skipVision)', async () => {
    settingsMock.mockResolvedValue({autoTargets: {[PDF]: {mode: 'auto'}}});
    fileSizeMock.mockImplementation(async (p: string) =>
      p.endsWith('.mark') ? 0 : 100,
    );
    readPdfMock.mockResolvedValue({ok: true, read: 7, failed: []});
    const out = await autoTranscriptTick(deps(), {force: true});
    expect(readPdfMock).toHaveBeenCalledTimes(1);
    expect(readPdfMock.mock.calls[0][4]).toEqual(
      expect.objectContaining({skipVision: true}),
    );
    expect(out.pagesRead).toBe(7);
  });

  it('a changed PDF gets its OCR even under an UNKNOWN host', async () => {
    settingsMock.mockResolvedValue({autoTargets: {[PDF]: {mode: 'auto'}}});
    fileSizeMock.mockImplementation(async (p: string) =>
      p.endsWith('.mark') ? 0 : 100,
    );
    readPdfMock.mockResolvedValue({ok: true, read: 3, failed: []});
    const d = deps({getCurrentFilePath: async () => null});
    await autoTranscriptTick(d, {force: true});
    expect(readPdfMock).toHaveBeenCalledTimes(1);
    expect(readPdfMock.mock.calls[0][4]).toEqual(
      expect.objectContaining({skipVision: true}),
    );
  });

  it('render failures do NOT consume the paid-failure budget (page retried past 3 ticks)', async () => {
    needMock.mockResolvedValue([1]);
    readMock.mockResolvedValue({
      ok: false,
      read: 0,
      failed: [1],
      renderFailed: [1],
      reason: 'Could not render the page',
    });
    for (let i = 0; i < 4; i++) {
      await autoTranscriptTick(deps(), {force: true});
      nowMs += 60_000;
    }
    // With the failures counted (pre-v0.87) the 4th tick skipped the page;
    // free render failures must keep it eligible.
    expect(readMock).toHaveBeenCalledTimes(4);
  });
});

// v0.87 Vision drain: no OCR-only page left behind — the tick finishes the
// Vision leg for the host it can render, budget-bounded, capped per page.
describe('vision drain (v0.87)', () => {
  it('runs after the pass, BOTH kinds (no filter — v0.87.4 probe), with the remaining budget', async () => {
    fvMock.mockResolvedValue({read: 2, pending: 0, truncated: 0, notes: 1});
    const out = await autoTranscriptTick(deps(), {force: true});
    expect(fvMock).toHaveBeenCalledTimes(1);
    const opts = fvMock.mock.calls[0][3] as {kind?: string; limit: number};
    expect(opts.kind).toBeUndefined(); // both kinds — the breakers probe
    expect(opts.limit).toBe(MAX_PAGES_PER_TICK);
    expect(out.pagesRead).toBe(2); // drain reads count in the tick result
  });

  it('does not run without a key', async () => {
    keyMock.mockResolvedValue({key: null, legacyFilePresent: false, migrated: false});
    await autoTranscriptTick(deps(), {force: true});
    expect(fvMock).not.toHaveBeenCalled();
  });

  it('a page whose vision fails 3 times is filtered out of later drains', async () => {
    const P = '/Note/stubborn.note';
    fvMock.mockImplementation(async (_d, _k, _v, opts) => {
      // Simulate the drain attempting page 1 of P and failing (vision empty
      // or API error — either way the entry stays 'mistral-ocr').
      if (opts?.pageFilter?.(P, 1) !== false) {
        opts?.onPageOutcome?.(P, 1, false);
      }
      return {read: 0, pending: 1, truncated: 0, notes: 1};
    });
    for (let i = 0; i < 3; i++) {
      await autoTranscriptTick(deps(), {force: true});
      nowMs += 60_000;
    }
    // 4th tick: the page is over the cap — the filter must exclude it.
    let filtered: boolean | undefined;
    fvMock.mockImplementation(async (_d, _k, _v, opts) => {
      filtered = opts?.pageFilter?.(P, 1);
      return {read: 0, pending: 0, truncated: 0, notes: 0};
    });
    await autoTranscriptTick(deps(), {force: true});
    expect(filtered).toBe(false);
    // Other pages stay eligible.
    fvMock.mockImplementation(async (_d, _k, _v, opts) => {
      filtered = opts?.pageFilter?.(P, 2);
      return {read: 0, pending: 0, truncated: 0, notes: 0};
    });
    nowMs += 60_000;
    await autoTranscriptTick(deps(), {force: true});
    expect(filtered).toBe(true);
  });
});

// v0.87.3 (device 2026-07-30): pokes must never be silently lost — neither
// to a tick already running (the Library's includeCurrent poke vanished into
// the startup walk) nor to RN's frozen JS timers (a pen-up debounce scheduled
// while writing never fired and then ate every later poke).
describe('poke queue & frozen-timer flush (v0.87.3)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('an explicit poke landing during a running tick is replayed after it', async () => {
    jest.useFakeTimers({doNotFake: ['Date']});
    const d = deps({
      getCurrentFilePath: async () => NOTE,
      getCurrentPageNum: async () => 2,
    });
    startAutoScheduler(d);
    // Tick A blocks inside its settings read → `running` stays true.
    let release: ((s: Awaited<ReturnType<typeof readSettings>>) => void) | null =
      null;
    settingsMock.mockReturnValueOnce(
      new Promise(r => {
        release = r;
      }),
    );
    const tickA = autoTranscriptTick(d, {force: true});
    await Promise.resolve();
    await Promise.resolve();
    // The Library poke lands mid-tick — pre-v0.87.3 it was dropped for good.
    pokeAuto('view:library', {force: true, includeCurrent: true});
    await jest.advanceTimersByTimeAsync(1500); // debounce fires → queued
    release!({}); // tick A: nothing tracked → ends, replays the queue
    await tickA;
    settingsMock.mockResolvedValue({autoTargets: {[NOTE]: {mode: 'auto'}}});
    needMock.mockResolvedValue([2]);
    readMock.mockResolvedValue({ok: true, read: 1, failed: []});
    await jest.advanceTimersByTimeAsync(1500); // replayed debounce
    await jest.advanceTimersByTimeAsync(700); // current-note flush sleep
    await jest.advanceTimersByTimeAsync(1000); // let the tick settle
    // includeCurrent survived the queue: the CURRENT page 2 was read, not
    // deferred — that is the exact page the device bug left unsynced.
    expect(readMock).toHaveBeenCalledWith(
      expect.anything(),
      'sk-test',
      expect.any(String),
      NOTE,
      [2],
    );
  });

  it('a frozen debounce is flushed inline by the next poke', async () => {
    jest.useFakeTimers({doNotFake: ['Date']});
    const d = deps();
    startAutoScheduler(d);
    pokeAuto('pen-up'); // debounce scheduled… and its timer never fires
    nowMs += 60_000; // well past POKE_STALE_MS, still frozen
    const before = getLastSyncAt();
    pokeAuto('pen-up'); // JS is running (native event) → inline flush
    // NO timer advance at all: the tick must have started without one.
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
    }
    expect(getLastSyncAt()).toBeGreaterThan(before);
  });
});

// v0.87 "Sync now is an order": a manual sync that could not finish keeps
// draining on background ticks until the debt (Vision included) is gone.
describe('manualSyncWanted (v0.87)', () => {
  it('an interrupted manual Sync finishes on background ticks, then releases', async () => {
    settingsMock.mockResolvedValue({autoTargets: {[NOTE]: {mode: 'manual'}}});
    needMock.mockResolvedValue([0, 1]);
    readMock.mockResolvedValue({ok: false, read: 1, failed: [1], reason: 'HTTP 429'});
    await autoTranscriptTick(deps(), {
      trigger: 'sync',
      modeFilter: 'manual',
      force: true,
    });
    expect(readMock).toHaveBeenCalledTimes(1);

    // Background tick: normally free-only for manual — the order stands.
    nowMs += 60_000;
    needMock.mockResolvedValue([1]);
    readMock.mockResolvedValue({ok: true, read: 1, failed: []});
    await autoTranscriptTick(deps());
    expect(readMock).toHaveBeenCalledTimes(2); // PAID read on a background tick

    // Fully covered on that tick → the order was released: the next
    // background tick is free-only again (stamp-skip, no paid read).
    nowMs += 60_000;
    needMock.mockResolvedValue([0]);
    await autoTranscriptTick(deps());
    expect(readMock).toHaveBeenCalledTimes(2);
  });
});

