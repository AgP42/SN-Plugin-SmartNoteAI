// The chat context flow (phase 4 §2.3 extraction). Pins the three
// money/privacy behaviors that used to live untested inside
// ChatPanel.send(): the >100-page estimate gate (no read happens), the
// batch-pending page filter, and the Off ephemeral wipe running in a
// finally even when the read throws.

import {gatherContext, parseScope} from './gatherContext';
import {readNotePages, pagesNeedingRead} from './reading';
import {mutateStore, flushStore} from './transcriptStoreIo';

jest.mock('./capture', () => ({
  captureDocText: jest.fn(async () => ''),
}));
jest.mock('./reading', () => ({
  isNotePath: (p: string) => /\.note$/i.test(p),
  markFilePath: (p: string) => `${p}.mark`,
  pagesNeedingRead: jest.fn(async (_d: unknown, _p: string, w: number[]) => w),
  readNotePages: jest.fn(async () => ({ok: true, read: 1, failed: []})),
  readPdf: jest.fn(async () => ({ok: true, read: 1, failed: []})),
  pageTextsFromStore: jest.fn(async (_p: string, pages: number[]) =>
    pages.map(p => ({page: p, text: `t${p}`})),
  ),
}));
jest.mock('./noteTranscripts', () => ({
  readStoredTranscripts: jest.fn(async () => new Map()),
  readFileSize: jest.fn(async () => null),
}));
jest.mock('./transcriptStoreIo', () => ({
  isDegradedLoad: jest.fn(() => false),
  isDocReadOnly: jest.fn(() => false),
  loadStore: jest.fn(async () => ({docs: {}})),
  mutateStore: jest.fn(async () => undefined),
  flushStore: jest.fn(async () => undefined),
}));

// The one native call gatherContext makes directly (v0.54.1: the
// once-per-send flush moved here from readNotePages).
const deps = {saveCurrentNote: jest.fn(async () => undefined)} as never;
const capture = {notePath: '/Note/a.note', page: 0, totalPages: 3};
const baseOpts = {
  isOff: false,
  skipEstimate: false,
  freshVisionSystem: async () => 'sys',
  freshPdfVisionSystem: async () => 'pdfsys',
  shouldStop: () => false,
  signal: new AbortController().signal,
  onProgress: () => {},
};

afterEach(() => jest.clearAllMocks());

describe('gatherContext', () => {
  it('parseScope: 1-indexed strings → 0-indexed bounds, garbage → page 1', () => {
    expect(parseScope('range', '3', '7')).toEqual({mode: 'range', start: 2, end: 6});
    expect(parseScope('page', '', 'x')).toEqual({mode: 'page', start: 0, end: 0});
  });

  it('returns the estimate WITHOUT reading when >100 pages are needed', async () => {
    (pagesNeedingRead as jest.Mock).mockResolvedValueOnce(
      Array.from({length: 150}, (_, i) => i),
    );
    const g = await gatherContext(
      deps,
      {...capture, totalPages: 200},
      parseScope('note', '1', '1'),
      'q',
      'a',
      'key',
      baseOpts,
    );
    expect(g.kind).toBe('estimate');
    expect((g as {count: number}).count).toBe(150);
    expect(readNotePages).not.toHaveBeenCalled();
  });

  it('Off: wipes exactly the pages the run WROTE (audit C1), in a finally', async () => {
    // 3 pages in context, but the run only wrote page 2 (0 and 1 were
    // already covered by an earlier paid read / a hand edit — they must
    // SURVIVE the ephemeral wipe).
    (readNotePages as jest.Mock).mockResolvedValueOnce({
      ok: true,
      read: 1,
      failed: [],
      storedPages: [2],
    });
    const g = await gatherContext(
      deps,
      capture,
      parseScope('note', '1', '1'),
      'q',
      'a',
      'key',
      {...baseOpts, isOff: true},
    );
    expect(g.kind).toBe('ok');
    expect(mutateStore).toHaveBeenCalledTimes(1); // the removePages wipe
    expect(flushStore).toHaveBeenCalledTimes(1); // flushed to disk NOW
    // The wipe mutator ran against removePages with ONLY the written page:
    // replay it on a fake store and check which pages it removes.
    const mutator = (mutateStore as jest.Mock).mock.calls[0][0];
    const fake = {
      docs: {
        '/Note/a.note': {
          pages: {0: {text: 'old paid'}, 1: {text: 'edit'}, 2: {text: 'new'}},
          lastUsed: 0,
        },
      },
    };
    mutator(fake);
    expect(Object.keys(fake.docs['/Note/a.note'].pages)).toEqual(['0', '1']);
  });

  it('Off: a throw before any write reported back wipes NOTHING (C1: never guess)', async () => {
    (readNotePages as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    await expect(
      gatherContext(
        deps,
        capture,
        parseScope('page', '1', '1'),
        'q',
        'a',
        'key',
        {...baseOpts, isOff: true},
      ),
    ).rejects.toThrow('boom');
    // Wiping a guessed page list destroyed pre-existing paid/user entries
    // (the old `?? pages` fallback) — nothing known written ⇒ no wipe.
    expect(mutateStore).not.toHaveBeenCalled();
    expect(flushStore).not.toHaveBeenCalled();
  });
});

// User decision 2026-08-16: the chat path NEVER pays vision. A covered PDF
// answers instantly from the store; a changed one runs OCR only — readPdf is
// always called with skipVision so the resume can never drain the backlog
// behind the chat banner (device logs: "PDF resume: 15/35" behind a 0/1).
it('PDF chat: readPdf is called with skipVision (no vision resume ever)', async () => {
  const readPdfMock = jest.requireMock('./reading').readPdf as jest.Mock;
  const g = await gatherContext(
    deps,
    {notePath: '/Document/d.pdf', page: 0, totalPages: 3},
    parseScope('page', '1', '1'),
    'q',
    'a',
    'key',
    baseOpts,
  );
  expect(g.kind).toBe('ok');
  expect(readPdfMock).toHaveBeenCalledTimes(1);
  expect(readPdfMock.mock.calls[0][3]).toBe('/Document/d.pdf');
  expect(readPdfMock.mock.calls[0][4]).toEqual(
    expect.objectContaining({skipVision: true}),
  );
});
