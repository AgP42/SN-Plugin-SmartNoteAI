// Embedded User Guide seed (v0.60): PDF install + transcript seed are
// idempotent, the seeded pages survive a shard reload (source 'guide'
// must be in the sanitize whitelist), and the docHash matches the
// installed file so a Sync never re-bills the guide.

export {}; // module scope (const mock* names are file-global otherwise)

const mockCopyAsset = jest.fn<
  Promise<{success?: boolean; code?: string}>,
  [string, string]
>();

jest.mock('react-native', () => ({
  NativeModules: {
    SmartNoteAiOverlay: {copyAssetToFile: mockCopyAsset},
  },
}));
const mockDeleteFile = jest.fn(async () => true);
jest.mock('sn-plugin-lib', () => ({
  FileUtils: {deleteFile: mockDeleteFile},
  PluginManager: {getPluginDirPath: async () => '/plugin'},
}));
const mockMarkerRead = jest.fn<Promise<string | null>, [string]>();
const mockMarkerWrite = jest.fn<Promise<boolean>, [string, string]>(
  async () => true,
);
jest.mock('./fs', () => ({
  CONFIG_DIR: '/mystyle/SmartNoteAI',
  readTextFileUtf8: mockMarkerRead,
  writeTextAtomic: mockMarkerWrite,
}));

let mockStore: import('../core/store/transcriptStore').Store;
jest.mock('./transcriptStoreIo', () => ({
  loadStore: jest.fn(async () => mockStore),
  mutateStore: jest.fn(
    async (fn: (s: import('../core/store/transcriptStore').Store) => unknown) => {
      fn(mockStore);
    },
  ),
  flushStore: jest.fn(async () => {}),
}));

type Seed = typeof import('./guideSeed');
type Core = typeof import('../core/store/transcriptStore');
let seed: Seed;
let core: Core;

const PDF_BYTES = new Uint8Array(1234).buffer;
const realFetch = globalThis.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  seed = require('./guideSeed');
  core = require('../core/store/transcriptStore');
  mockStore = core.emptyStore();
  mockCopyAsset.mockResolvedValue({success: true, code: 'OK'});
  mockMarkerRead.mockResolvedValue(null); // default: no marker on disk
  globalThis.fetch = jest.fn(async () => ({
    ok: true,
    arrayBuffer: async () => PDF_BYTES,
  })) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('ensureUserGuide', () => {
  it('installs the PDF and seeds every page with source guide + the real docHash', async () => {
    await seed.ensureUserGuide();
    expect(mockCopyAsset).toHaveBeenCalledWith(
      seed.GUIDE_ASSET,
      seed.GUIDE_PDF_PATH,
    );
    const doc = mockStore.docs[seed.GUIDE_PDF_PATH];
    expect(doc).toBeDefined();
    expect(Object.keys(doc.pages).length).toBeGreaterThanOrEqual(8);
    expect(doc.pages['0'].source).toBe('guide');
    // v0.88.1: page 0 is the COVER; the first chapter sits on page 2.
    expect(doc.pages['0'].text).toContain('SmartNote AI - User Guide');
    expect(doc.pages['2'].text).toContain('# 1. Welcome to SmartNote AI');
    // docHash = byte length of the INSTALLED file → pdfCovered, never
    // "to sync", never billed.
    expect(doc.docHash).toBe('1234');
    const sum = core
      .docsSummary(mockStore)
      .find(d => d.path === seed.GUIDE_PDF_PATH);
    expect(sum?.pdfCovered).toBe(true);
  });

  it('rev semantics (v0.63): current rev untouched, outdated rev REPLACED', async () => {
    // Seed at the current rev, then hand-edit a page: a later ensure is
    // a no-op (the stamp matches — user copy respected).
    await seed.ensureUserGuide();
    core.upsertPage(
      mockStore,
      seed.GUIDE_PDF_PATH,
      0,
      core.makePageEntry('my edited copy', 'user', {hash: ''}, 1),
      1,
    );
    await seed.ensureUserGuide();
    expect(mockStore.docs[seed.GUIDE_PDF_PATH].pages['0'].text).toBe(
      'my edited copy',
    );
    // Simulate an install carrying an OLDER content rev: the next ensure
    // replaces file + transcript (stale instructions beat annotations —
    // deliberate contract, see guideSeed.ts).
    core.setStamp(mockStore, seed.GUIDE_PDF_PATH, 'guide-rev:1');
    await seed.ensureUserGuide();
    expect(mockStore.docs[seed.GUIDE_PDF_PATH].pages['0'].text).toContain(
      'SmartNote AI - User Guide',
    );
    expect(core.getStamp(mockStore, seed.GUIDE_PDF_PATH)).not.toBe(
      'guide-rev:1',
    );
  });

  it('no PDF on disk → no phantom seed', async () => {
    mockCopyAsset.mockResolvedValue({success: false, code: 'COPY_FAILED'});
    await seed.ensureUserGuide();
    expect(mockStore.docs[seed.GUIDE_PDF_PATH]).toBeUndefined();
  });

  it('the seeded pages SURVIVE a shard save/reload round-trip (whitelist)', async () => {
    await seed.ensureUserGuide();
    const doc = mockStore.docs[seed.GUIDE_PDF_PATH];
    const reparsed = core.sanitizeDocEntry(JSON.parse(JSON.stringify(doc)));
    expect(reparsed).not.toBeNull();
    expect(Object.keys(reparsed!.pages).length).toBe(
      Object.keys(doc.pages).length,
    );
    expect(reparsed!.pages['0'].source).toBe('guide');
  });
});

describe('reinstall freshness (round 15 #4)', () => {
  it('EMPTY store + stale marker: the old PDF is deleted, the marker written', async () => {
    // The reinstall scenario: store wiped, but an outdated guide PDF file
    // survives on disk. The store-based staleness signal saw nothing; the
    // marker FILE must drive the replacement.
    mockMarkerRead.mockResolvedValue('guide-rev:1'); // ancient
    await seed.ensureUserGuide();
    expect(mockDeleteFile).toHaveBeenCalled(); // old PDF dropped
    expect(mockMarkerWrite).toHaveBeenCalledWith(
      '/mystyle/SmartNoteAI/guide.rev',
      expect.stringMatching(/^guide-rev:\d+$/),
    );
  });

  it('marker current: the PDF is not deleted again', async () => {
    // First run writes the current stamp…
    mockMarkerRead.mockResolvedValue(null);
    await seed.ensureUserGuide();
    const written = mockMarkerWrite.mock.calls.find(c =>
      String(c[0]).endsWith('guide.rev'),
    );
    expect(written).toBeDefined();
    // …second run with that stamp on disk deletes nothing.
    jest.clearAllMocks();
    mockCopyAsset.mockResolvedValue({success: true, code: 'EXISTS'});
    mockMarkerRead.mockResolvedValue(String(written?.[1]));
    mockStore = core.emptyStore();
    await seed.ensureUserGuide();
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });
});
