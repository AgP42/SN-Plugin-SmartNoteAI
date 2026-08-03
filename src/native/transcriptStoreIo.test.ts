// CHARACTERIZATION tests for the SHARDED store IO (v0.56): index+shard
// load, index.bak recovery, legacy v1 migration, touched-only shard
// writes, the deletion diff, the 800 ms debounce, flush, subscriber
// notification and the clear path. Native seams (writeFileBase64,
// sn-plugin-lib, ./fs) are mocked; the pure Store helpers run real.
//
// ⚠ The touched-doc tracking lives in the CORE module (module-level
// Set): after jest.resetModules() the IO requires a FRESH core — the
// tests must use THAT instance (core = requireActual in beforeEach),
// not top-level imports, or mutations would mark a stale Set.

const mockWriteFileBase64 = jest.fn<Promise<{success?: boolean}>, [string, string]>();
const mockMakeDir = jest.fn<Promise<unknown>, [string]>();
const mockDeleteFile = jest.fn<Promise<boolean>, [string]>();
const mockGetPluginDirPath = jest.fn<Promise<unknown>, []>();
const mockReadTextFileUtf8 = jest.fn<Promise<string | null>, [string]>();
const mockListDir = jest.fn<
  Promise<{
    success?: boolean;
    entries?: Array<{name: string; isDir: boolean; size: number}>;
  }>,
  [string]
>();

jest.mock('react-native', () => ({
  NativeModules: {
    SmartNoteAiOverlay: {
      writeFileBase64: mockWriteFileBase64,
      listDir: mockListDir,
    },
  },
}));
jest.mock('sn-plugin-lib', () => ({
  FileUtils: {makeDir: mockMakeDir, deleteFile: mockDeleteFile},
  PluginManager: {getPluginDirPath: mockGetPluginDirPath},
}));
jest.mock('./fs', () => ({
  readTextFileUtf8: mockReadTextFileUtf8,
  // Delegates to the same mock: null reads count as transient (notFound
  // false), so the B2 keep-referenced behaviour stays pinned; NOT_FOUND
  // dropping has its own dedicated test.
  readTextFileUtf8Ex: jest.fn(async (p: string) => ({
    data: await mockReadTextFileUtf8(p),
    notFound: false,
  })),
  writeTextAtomic: jest.fn(async (p: string, content: string) => {
    const r = await mockWriteFileBase64(
      p,
      jest.requireActual('../core/util/base64').utf8ToBase64(content),
    );
    return r?.success === true;
  }),
}));

type Io = typeof import('./transcriptStoreIo');
type Core = typeof import('../core/store/transcriptStore');
let io: Io;
let core: Core;

const DIR = '/plugin/transcripts';
const INDEX = `${DIR}/index.json`;
const INDEX_BAK = `${DIR}/index.json.bak`;
const A = '/Note/a.note';
const B = '/Note/b.note';

const anEntry = {
  text: 'hello',
  source: 'mistral-ocr' as const,
  at: 1,
  hash: 'P20260101000000001',
};

const shardJson = (path: string, text = 'hello'): string =>
  JSON.stringify({
    v: 2,
    path,
    doc: {usedAt: 1, docHash: '', pages: {'0': {...anEntry, text}}},
  });

const indexJson = (paths: string[]): string =>
  JSON.stringify({
    v: 2,
    shards: Object.fromEntries(paths.map(p => [p, io.shardNameFor(p)])),
  });

// Serve a fake on-disk state keyed by full path.
const serveFiles = (files: Record<string, string>): void => {
  mockReadTextFileUtf8.mockImplementation(async p => files[p] ?? null);
};

const writesTo = (path: string): string[] =>
  mockWriteFileBase64.mock.calls.filter(c => c[0] === path).map(c => c[0]);

beforeEach(() => {
  jest.resetModules(); // fresh storeP / touched-set / lastPaths singletons
  jest.clearAllMocks();
  mockGetPluginDirPath.mockResolvedValue('/plugin');
  mockMakeDir.mockResolvedValue(undefined);
  mockDeleteFile.mockResolvedValue(true);
  mockWriteFileBase64.mockResolvedValue({success: true});
  mockReadTextFileUtf8.mockResolvedValue(null);
  mockListDir.mockResolvedValue({success: true, entries: []});
  io = jest.requireActual<Io>('./transcriptStoreIo');
  core = jest.requireActual<Core>('../core/store/transcriptStore');
});

afterEach(async () => {
  await io.flushStore(); // never leak a pending debounce timer
  jest.useRealTimers();
});

describe('loadStore (sharded)', () => {
  it('rebuilds the store from index + shards', async () => {
    serveFiles({
      [INDEX]: indexJson([A, B]),
      [`${DIR}/docs/${io.shardNameFor(A)}`]: shardJson(A, 'aaa'),
      [`${DIR}/docs/${io.shardNameFor(B)}`]: shardJson(B, 'bbb'),
    });
    const s = await io.loadStore();
    expect(Object.keys(s.docs).sort()).toEqual([A, B]);
    expect(s.docs[A].pages['0'].text).toBe('aaa');
  });

  it('recovers the shard list from index.json.bak when the index is corrupt', async () => {
    serveFiles({
      [INDEX]: '{torn',
      [INDEX_BAK]: indexJson([A]),
      [`${DIR}/docs/${io.shardNameFor(A)}`]: shardJson(A),
    });
    const s = await io.loadStore();
    expect(Object.keys(s.docs)).toEqual([A]);
  });

  it('skips a corrupt or path-mismatched shard (one doc lost, not the library)', async () => {
    serveFiles({
      [INDEX]: indexJson([A, B]),
      [`${DIR}/docs/${io.shardNameFor(A)}`]: '{torn-mid-write',
      // path inside ≠ indexed path → rejected (collision guard)
      [`${DIR}/docs/${io.shardNameFor(B)}`]: shardJson('/Note/evil.note'),
    });
    const s = await io.loadStore();
    expect(Object.keys(s.docs)).toEqual([]);
  });
});

describe('pre-shard store.json (Phase C: migration REMOVED, never destroyed)', () => {
  it('a present store.json forces a memory-only session, files untouched', async () => {
    const legacy = core.emptyStore();
    core.upsertPage(legacy, A, 0, {...anEntry}, 1);
    serveFiles({[`${DIR}/store.json`]: core.serializeStore(legacy)});
    const s = await io.loadStore();
    // Not migrated (unsupported), not deleted, nothing written around it.
    expect(s.docs).toEqual({});
    await io.mutateStore(st => core.upsertPage(st, B, 0, {...anEntry}, 2));
    await io.flushStore();
    const paths = mockWriteFileBase64.mock.calls.map(c => c[0]);
    expect(paths).not.toContain(INDEX); // degraded: no index commit
    expect(mockDeleteFile.mock.calls.map(c => c[0])).not.toContain(
      `${DIR}/store.json`,
    );
  });

  it('no index and no legacy file → plain empty library', async () => {
    const s = await io.loadStore();
    expect(s.docs).toEqual({});
  });
});

describe('touched-only persistence', () => {
  it('writes ONLY the touched shard (plus the index + its mirror)', async () => {
    serveFiles({
      [INDEX]: indexJson([A, B]),
      [`${DIR}/docs/${io.shardNameFor(A)}`]: shardJson(A),
      [`${DIR}/docs/${io.shardNameFor(B)}`]: shardJson(B),
    });
    await io.loadStore();
    await io.mutateStore(s => core.upsertPage(s, A, 1, {...anEntry}, 5));
    await io.flushStore();
    const paths = mockWriteFileBase64.mock.calls.map(c => c[0]);
    expect(paths).toContain(`${DIR}/docs/${io.shardNameFor(A)}`);
    expect(paths).not.toContain(`${DIR}/docs/${io.shardNameFor(B)}`); // untouched
    expect(paths).toContain(INDEX);
    expect(paths).toContain(INDEX_BAK);
  });

  it('debounces the write 800 ms after the LAST mutation', async () => {
    jest.useFakeTimers();
    await io.mutateStore(s => core.upsertPage(s, A, 0, {...anEntry}, 1));
    expect(mockWriteFileBase64).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(500);
    await io.mutateStore(s => core.upsertPage(s, A, 1, {...anEntry}, 2));
    await jest.advanceTimersByTimeAsync(799); // window restarted
    expect(mockWriteFileBase64).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
    // One coalesced persist: the A shard once, then index + mirror.
    expect(writesTo(`${DIR}/docs/${io.shardNameFor(A)}`)).toHaveLength(1);
    expect(writesTo(INDEX)).toHaveLength(1);
  });

  it('a refused shard write is retried on the next persist', async () => {
    mockWriteFileBase64.mockImplementation(async p =>
      p.includes('/docs/') ? {success: false} : {success: true},
    );
    await io.mutateStore(s => core.upsertPage(s, A, 0, {...anEntry}, 1));
    await io.flushStore();
    expect(writesTo(`${DIR}/docs/${io.shardNameFor(A)}`)).toHaveLength(1);
    mockWriteFileBase64.mockResolvedValue({success: true});
    await io.flushStore(); // no new mutation — the retry mark drives it
    expect(writesTo(`${DIR}/docs/${io.shardNameFor(A)}`)).toHaveLength(2);
  });

  it('mutator returning false = "nothing changed": no notify, no persist', async () => {
    const fn = jest.fn();
    io.subscribeStore(fn);
    await io.mutateStore(() => false);
    expect(fn).not.toHaveBeenCalled();
    await io.flushStore();
    // flush still writes the (tiny) index, but no shard was written
    expect(
      mockWriteFileBase64.mock.calls.filter(c => c[0].includes('/docs/')),
    ).toHaveLength(0);
    await io.mutateStore(() => {});
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('mutateStore notifies subscribers; unsubscribe stops them', async () => {
    const fn = jest.fn();
    const off = io.subscribeStore(fn);
    await io.mutateStore(() => {});
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    await io.mutateStore(() => {});
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('content self-versioning (v0.58 — the store decides its own fresh starts)', () => {
  const b64ToJson = (b64: string): any =>
    JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  const lastIndexWrite = (): any => {
    const calls = mockWriteFileBase64.mock.calls.filter(c => c[0] === INDEX);
    return b64ToJson(calls[calls.length - 1][1]);
  };

  it('adopts a pre-v0.58 index WITHOUT contentV (no wipe) and stamps it on the next persist', async () => {
    serveFiles({
      [INDEX]: indexJson([A]), // no contentV field
      [`${DIR}/docs/${io.shardNameFor(A)}`]: shardJson(A),
    });
    const s = await io.loadStore();
    expect(Object.keys(s.docs)).toEqual([A]); // NOT wiped
    await io.mutateStore(st => core.touchDoc(st, A, 9));
    await io.flushStore();
    expect(lastIndexWrite().contentV).toBe(32);
  });

  it('a foreign contentV NEVER wipes: memory-only session, files untouched', async () => {
    const idx = JSON.parse(indexJson([A]));
    idx.contentV = 31;
    serveFiles({
      [INDEX]: JSON.stringify(idx),
      [`${DIR}/docs/${io.shardNameFor(A)}`]: shardJson(A),
    });
    const s = await io.loadStore();
    expect(s.docs).toEqual({}); // unknown format: served empty…
    await io.flushStore();
    // …but NOTHING on disk is deleted or overwritten (Phase C, decision G:
    // the old fresh-start deleted every paid shard over a version field).
    expect(mockDeleteFile.mock.calls.map(c => c[0])).not.toContain(
      `${DIR}/docs/${io.shardNameFor(A)}`,
    );
    const paths = mockWriteFileBase64.mock.calls.map(c => c[0]);
    expect(paths).not.toContain(INDEX);
  });
});

describe('persist lock (audit C2 2026-07-19)', () => {
  it('a flush during a running persist WAITS instead of interleaving', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(r => {
      release = r;
    });
    let firstWrite = true;
    mockWriteFileBase64.mockImplementation(async () => {
      if (firstWrite) {
        firstWrite = false;
        await gate; // stall persist #1 inside its FIRST write (A's shard)
      }
      return {success: true};
    });
    await io.mutateStore(s => core.upsertPage(s, A, 0, {...anEntry}, 1));
    const f1 = io.flushStore(); // persist #1 starts, stalls
    for (let i = 0; i < 20; i++) {
      await Promise.resolve(); // let it reach the stalled write
    }
    await io.mutateStore(s => core.upsertPage(s, B, 0, {...anEntry}, 2));
    const f2 = io.flushStore(); // must QUEUE behind #1, not run into it
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
    // Without the lock, persist #2 would already have written B's shard
    // (and could then race #1's deletion diff / index commit).
    expect(writesTo(`${DIR}/docs/${io.shardNameFor(B)}`)).toHaveLength(0);
    release();
    await f1;
    await f2;
    expect(writesTo(`${DIR}/docs/${io.shardNameFor(B)}`)).toHaveLength(1);
    // Index committed once per persist, in order.
    expect(writesTo(INDEX)).toHaveLength(2);
  });
});

describe('deletion diff', () => {
  it('deletes the shard file of a doc that left the store', async () => {
    serveFiles({
      [INDEX]: indexJson([A]),
      [`${DIR}/docs/${io.shardNameFor(A)}`]: shardJson(A),
    });
    await io.loadStore();
    await io.mutateStore(s => core.removePages(s, A, [0])); // doc emptied → deleted
    await io.flushStore();
    expect(mockDeleteFile.mock.calls.map(c => c[0])).toContain(
      `${DIR}/docs/${io.shardNameFor(A)}`,
    );
  });
});

describe('clearStoreFile', () => {
  it('wipes memory, deletes every shard, commits an empty index, notifies', async () => {
    serveFiles({
      [INDEX]: indexJson([A, B]),
      [`${DIR}/docs/${io.shardNameFor(A)}`]: shardJson(A),
      [`${DIR}/docs/${io.shardNameFor(B)}`]: shardJson(B),
    });
    await io.loadStore();
    const fn = jest.fn();
    io.subscribeStore(fn);
    await io.clearStoreFile();
    expect((await io.loadStore()).docs).toEqual({});
    const deleted = mockDeleteFile.mock.calls.map(c => c[0]);
    expect(deleted).toContain(`${DIR}/docs/${io.shardNameFor(A)}`);
    expect(deleted).toContain(`${DIR}/docs/${io.shardNameFor(B)}`);
    expect(writesTo(INDEX)).toHaveLength(1); // the empty-index commit
    expect(fn).toHaveBeenCalled();
  });
});

describe('audit 2026-07-19 lot B — read failure ≠ absence', () => {
  const fileEntry = (name: string) => ({name, isDir: false, size: 100});

  it('B1: index + .bak dead → index REBUILT from the shard files themselves', async () => {
    serveFiles({
      [INDEX]: '{torn',
      [INDEX_BAK]: '{also-torn',
      [`${DIR}/docs/${io.shardNameFor(A)}`]: shardJson(A, 'aaa'),
      [`${DIR}/docs/${io.shardNameFor(B)}`]: shardJson(B, 'bbb'),
    });
    mockListDir.mockResolvedValue({
      success: true,
      entries: [fileEntry(io.shardNameFor(A)), fileEntry(io.shardNameFor(B))],
    });
    const s = await io.loadStore();
    expect(Object.keys(s.docs).sort()).toEqual([A, B]);
    // A later persist recommits a full index.
    await io.mutateStore(st => core.upsertPage(st, A, 1, {...anEntry}, 9));
    await io.flushStore();
    const idx = JSON.parse(
      Buffer.from(
        mockWriteFileBase64.mock.calls.filter(c => c[0] === INDEX).pop()![1],
        'base64',
      ).toString('utf8'),
    );
    expect(Object.keys(idx.shards).sort()).toEqual([A, B]);
  });

  it('B1: shard files exist but none readable → DEGRADED, no index commit', async () => {
    serveFiles({
      [INDEX]: '{torn',
      // the shard files are listed but unreadable (transient IO)
    });
    mockListDir.mockResolvedValue({
      success: true,
      entries: [fileEntry(io.shardNameFor(A))],
    });
    const s = await io.loadStore();
    expect(s.docs).toEqual({});
    await io.mutateStore(st => core.upsertPage(st, B, 0, {...anEntry}, 1));
    await io.flushStore();
    // The B shard is written (paid data lands) but the index is NOT —
    // committing it would disown the unreadable shards for good — and
    // since audit 9 #0, a degraded session writes NOTHING at all: paid
    // reads are gated off, and a shard write could overwrite the very
    // files the next boot might read back healthy.
    const paths = mockWriteFileBase64.mock.calls.map(c => c[0]);
    expect(paths).not.toContain(`${DIR}/docs/${io.shardNameFor(B)}`);
    expect(paths).not.toContain(INDEX);
  });

  it('B2: an unreadable shard keeps its index entry across persists', async () => {
    serveFiles({
      [INDEX]: indexJson([A, B]),
      [`${DIR}/docs/${io.shardNameFor(A)}`]: shardJson(A),
      // B's shard read fails this session
    });
    const s = await io.loadStore();
    expect(Object.keys(s.docs)).toEqual([A]); // B not loaded…
    await io.mutateStore(st => core.upsertPage(st, A, 1, {...anEntry}, 5));
    await io.flushStore();
    const idx = JSON.parse(
      Buffer.from(
        mockWriteFileBase64.mock.calls.filter(c => c[0] === INDEX).pop()![1],
        'base64',
      ).toString('utf8'),
    );
    expect(Object.keys(idx.shards).sort()).toEqual([A, B]); // …but stays referenced
    // and its file is NOT collected by the deletion diff
    expect(mockDeleteFile.mock.calls.map(c => c[0])).not.toContain(
      `${DIR}/docs/${io.shardNameFor(B)}`,
    );
  });

  it('B3: a NEW doc whose shard write failed stays out of the index (no ghost ref)', async () => {
    mockWriteFileBase64.mockImplementation(async p =>
      p.includes(io.shardNameFor(B)) ? {success: false} : {success: true},
    );
    await io.loadStore();
    await io.mutateStore(st => {
      core.upsertPage(st, A, 0, {...anEntry}, 1);
      core.upsertPage(st, B, 0, {...anEntry}, 1);
    });
    await io.flushStore();
    const idx = JSON.parse(
      Buffer.from(
        mockWriteFileBase64.mock.calls.filter(c => c[0] === INDEX).pop()![1],
        'base64',
      ).toString('utf8'),
    );
    expect(Object.keys(idx.shards)).toEqual([A]); // B's file never landed
    // Once the disk heals, the next persist writes B AND references it.
    mockWriteFileBase64.mockResolvedValue({success: true});
    await io.flushStore();
    const idx2 = JSON.parse(
      Buffer.from(
        mockWriteFileBase64.mock.calls.filter(c => c[0] === INDEX).pop()![1],
        'base64',
      ).toString('utf8'),
    );
    expect(Object.keys(idx2.shards).sort()).toEqual([A, B]);
  });

  it('B4: legacy store present but unreadable → files KEPT, no index commit', async () => {
    serveFiles({
      [`${DIR}/store.json`]: '{torn',
      // store.json.bak unreadable too
    });
    const s = await io.loadStore();
    expect(s.docs).toEqual({});
    await io.mutateStore(st => core.upsertPage(st, A, 0, {...anEntry}, 1));
    await io.flushStore();
    expect(mockDeleteFile.mock.calls.map(c => c[0])).not.toContain(
      `${DIR}/store.json`,
    );
    const paths = mockWriteFileBase64.mock.calls.map(c => c[0]);
    expect(paths).not.toContain(INDEX); // degraded — nothing disowned
  });
});

// ================================================================
// FLOW TESTS (2026-08-03, after the pre-reinstall audit): the classes the
// 15 review rounds kept finding by luck become permanent regressions.
// ================================================================
describe('backup → restore round-trip (the writer/reader pair)', () => {
  // THE constant, not a copy: the whole point of this suite is that the
  // writer and the reader can never diverge again. Read lazily — the io
  // module is re-required per test (resetModules).
  const bdir = () => io.LIBRARY_BACKUP_DIR;

  it('a clean backup restores every doc, with honest zero counts', async () => {
    serveFiles({
      [`${bdir()}/index.json`]: indexJson([A, B]),
      [`${bdir()}/docs/${io.shardNameFor(A)}`]: shardJson(A, 'from backup A'),
      [`${bdir()}/docs/${io.shardNameFor(B)}`]: shardJson(B, 'from backup B'),
    });
    const r = await io.importLibrary();
    expect(r).toEqual({ok: true, docs: 2, skippedPages: 0, unreadableDocs: 0});
    const s = await io.loadStore();
    expect(core.getPage(s, A, 0)?.text).toBe('from backup A');
    expect(core.getPage(s, B, 0)?.text).toBe('from backup B');
  });

  it('a torn shard is COUNTED and REPORTED, never silent success', async () => {
    serveFiles({
      [`${bdir()}/index.json`]: indexJson([A, B]),
      [`${bdir()}/docs/${io.shardNameFor(A)}`]: shardJson(A),
      [`${bdir()}/docs/${io.shardNameFor(B)}`]: '{torn',
    });
    const r = await io.importLibrary();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.docs).toBe(1);
      expect(r.unreadableDocs).toBe(1); // the lie of round 15 #1, pinned
    }
  });

  it('a damaged backup index is an ERROR — never the stale legacy fallback', async () => {
    serveFiles({
      [`${bdir()}/index.json`]: '{damaged',
      // a months-old legacy file lurks — it must NOT be restored silently
      [io.LIBRARY_BACKUP_PATH]: JSON.stringify({v: 1, docs: {}}),
    });
    const r = await io.importLibrary();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('index.json is unreadable');
    }
  });

  it('the legacy one-JSON file still restores when NO directory exists', async () => {
    const legacy = core.emptyStore();
    core.upsertPage(legacy, A, 0, {...anEntry, text: 'legacy text'}, 1);
    serveFiles({[io.LIBRARY_BACKUP_PATH]: core.serializeStore(legacy)});
    const r = await io.importLibrary();
    expect(r.ok).toBe(true);
    const s = await io.loadStore();
    expect(core.getPage(s, A, 0)?.text).toBe('legacy text');
  });
});

describe('clearAllRespectingLocks (2026-08-03: locks survive even Clear ALL)', () => {
  it('spares locked docs and pages; wipes the rest', async () => {
    const s = await io.loadStore();
    const {upsertPage, setDocLock} = core;
    upsertPage(s, '/n/free.note', 0, {text: 'x', source: 'mistral-ocr', at: 1, hash: 'h'}, 1);
    upsertPage(s, '/n/frozen.note', 0, {text: 'gardé', source: 'user', at: 1, hash: 'h'}, 1);
    setDocLock(s, '/n/frozen.note', true);
    upsertPage(s, '/n/mixed.note', 0, {text: 'drop', source: 'mistral-ocr', at: 1, hash: 'h'}, 1);
    upsertPage(s, '/n/mixed.note', 1, {text: 'page gelée', source: 'user', at: 1, hash: 'h2', lock: true}, 1);
    const r = await io.clearAllRespectingLocks();
    expect(r.skippedLockedDocs).toBe(1);
    expect(r.keptLockedPages).toBe(1);
    const after = await io.loadStore();
    expect(after.docs['/n/free.note']).toBeUndefined();
    expect(after.docs['/n/frozen.note'].pages['0'].text).toBe('gardé');
    expect(after.docs['/n/mixed.note'].pages['1'].text).toBe('page gelée');
    expect(after.docs['/n/mixed.note'].pages['0']).toBeUndefined();
  });

  it('with no locks anywhere it behaves like the historical full wipe', async () => {
    const s = await io.loadStore();
    const {upsertPage} = core;
    upsertPage(s, '/n/a.note', 0, {text: 'x', source: 'mistral-ocr', at: 1, hash: 'h'}, 1);
    const r = await io.clearAllRespectingLocks();
    expect(r.skippedLockedDocs).toBe(0);
    expect(r.keptLockedPages).toBe(0);
    expect(Object.keys((await io.loadStore()).docs)).toHaveLength(0);
  });
});
