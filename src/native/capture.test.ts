import {
  captureCurrent,
  captureDocText,
  capturePageImage,
  type CaptureDeps,
} from './capture';

const PNG = new Uint8Array([1, 2, 3, 4]).buffer;

const baseDeps = (over: Partial<CaptureDeps> = {}): CaptureDeps => ({
  getCurrentFilePath: async () => '/notes/x.note',
  getCurrentPageNum: async () => 3,
  getPluginDirPath: async () => '/plugin',
  generateNotePng: async () => ({success: true}),
  generateDocImage: async () => ({success: true}),
  getCurrentDocText: async () => ({result: 'pdf text'}),
  getNoteTotalPageNum: async () => ({result: 12}),
  saveCurrentNote: async () => ({success: true}),
  deleteFile: jest.fn(async () => true),
  fetchFn: async () => ({ok: true, arrayBuffer: async () => PNG}),
  ...over,
});

describe('captureCurrent (v0.36 slim: location only, no render)', () => {
  it('locates a .note page with its total page count', async () => {
    const deps = baseDeps();
    const cap = await captureCurrent(deps);
    expect(cap).toEqual({notePath: '/notes/x.note', page: 3, totalPages: 12});
    // No render, no scratch file.
    expect(deps.deleteFile).not.toHaveBeenCalled();
  });

  // Regression: getNoteTotalPageNum returns 1 for a PDF ON-DEVICE (the
  // 2026-07-23 fix wrongly assumed otherwise; the earlier test mocked it to 5
  // and hid the bug). The reliable count is the store's docPageCount.
  it('a PDF gets its page count from the STORE, not getNoteTotalPageNum (device returns 1 → "p4/1" bug)', async () => {
    const cap = await captureCurrent(
      baseDeps({
        getCurrentFilePath: async () => '/docs/y.pdf',
        getNoteTotalPageNum: async () => 1, // what the SDK really returns for a PDF
        getDocPageCount: async () => 5, // the store knows the real count
      }),
    );
    expect(cap).toEqual({notePath: '/docs/y.pdf', page: 3, totalPages: 5});
  });

  it('an unread PDF (store count 0) falls back to 1 — count genuinely unknown yet', async () => {
    const cap = await captureCurrent(
      baseDeps({
        getCurrentFilePath: async () => '/docs/z.pdf',
        getNoteTotalPageNum: async () => 1,
        getDocPageCount: async () => 0,
      }),
    );
    expect(cap?.totalPages).toBe(1);
  });

  it('a .note keeps using getNoteTotalPageNum (reliable there) — store not consulted', async () => {
    const getDocPageCount = jest.fn(async () => 999);
    const cap = await captureCurrent(baseDeps({getDocPageCount}));
    expect(cap?.totalPages).toBe(12);
    expect(getDocPageCount).not.toHaveBeenCalled();
  });

  it('returns null when there is no current file/page', async () => {
    expect(
      await captureCurrent(baseDeps({getCurrentFilePath: async () => null})),
    ).toBeNull();
    expect(
      await captureCurrent(baseDeps({getCurrentPageNum: async () => null})),
    ).toBeNull();
  });
});

describe('captureDocText', () => {
  it('returns the trimmed embedded text, empty on failure', async () => {
    expect(await captureDocText(baseDeps(), 2)).toBe('pdf text');
    expect(
      await captureDocText(
        baseDeps({
          getCurrentDocText: async () => {
            throw new Error('boom');
          },
        }),
        2,
      ),
    ).toBe('');
  });
});

describe('capturePageImage', () => {
  it('renders, reads the PNG as base64 and deletes the scratch', async () => {
    const deps = baseDeps();
    const b64 = await capturePageImage(deps, '/notes/x.note', 0);
    expect(b64 !== null && b64.length > 0).toBe(true);
    expect(deps.deleteFile).toHaveBeenCalled();
  });

  it('returns null and cleans up when the render fails', async () => {
    const deps = baseDeps({generateNotePng: async () => ({success: false})});
    expect(await capturePageImage(deps, '/notes/x.note', 0)).toBeNull();
    expect(deps.deleteFile).toHaveBeenCalled();
  });

  it('skipSave skips the per-page note flush (bulk callers save once)', async () => {
    const save = jest.fn(async () => ({success: true}));
    await capturePageImage(baseDeps({saveCurrentNote: save}), '/n.note', 0, {
      skipSave: true,
    });
    expect(save).not.toHaveBeenCalled();
  });
});

describe('capturePageImage rotate (audit 2026-07-19 D2)', () => {
  // rotateNative() reads NativeModules directly (not via deps).
  const RN = require('react-native');
  afterEach(() => {
    delete RN.NativeModules.SmartNoteAiOverlay;
  });

  it('a FAILED rotate aborts the capture — no paid read on a bad image', async () => {
    RN.NativeModules.SmartNoteAiOverlay = {
      rotatePng: jest.fn(async () => ({success: false})),
    };
    const deps = baseDeps();
    expect(
      await capturePageImage(deps, '/notes/x.note', 0, {rotateDeg: 90}),
    ).toBeNull();
    expect(deps.deleteFile).toHaveBeenCalled(); // scratch cleaned up
  });

  it('a successful rotate proceeds to the base64 read', async () => {
    RN.NativeModules.SmartNoteAiOverlay = {
      rotatePng: jest.fn(async () => ({success: true})),
    };
    const b64 = await capturePageImage(baseDeps(), '/notes/x.note', 0, {
      rotateDeg: 90,
    });
    expect(typeof b64).toBe('string');
    expect((b64 ?? '').length).toBeGreaterThan(0);
  });
});
