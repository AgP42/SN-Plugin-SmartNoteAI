// File-IO glue. The logic under test is NOT the bridge itself but the
// contracts built on top of it: the NOT_FOUND / transient-error split
// (a deleted shard is DROPPED, an IO error is RETRIED — the v0.88 index
// rule), the native → fetch fallback chains, the BOM strip, and the
// utf8 → base64 write fallback.

const mockNative: {
  readFileUtf8?: jest.Mock;
  writeFileUtf8?: jest.Mock;
  writeFileBase64?: jest.Mock;
  listDir?: jest.Mock;
  listStorageVolumes?: jest.Mock;
} = {};

jest.mock('react-native', () => ({
  NativeModules: {SmartNoteAiOverlay: mockNative},
}));

import {
  readTextFile,
  readTextFileUtf8,
  readTextFileUtf8Ex,
  writeTextFileUtf8,
  writeTextAtomic,
  listDirNative,
  listStorageVolumesNative,
} from './fs';

const fetchWith = (bytes: number[] | null): jest.Mock => {
  const f = jest.fn(async () => {
    if (bytes === null) {
      return {ok: false};
    }
    return {
      ok: true,
      arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    };
  });
  global.fetch = f as unknown as typeof fetch;
  return f;
};

beforeEach(() => {
  for (const k of Object.keys(mockNative)) {
    delete mockNative[k as keyof typeof mockNative];
  }
  fetchWith(null);
});

describe('readTextFile (ASCII config reader)', () => {
  it('strips a UTF-8 BOM (desktop-synced key files)', async () => {
    fetchWith([0xef, 0xbb, 0xbf, ...Array.from('sk-key', c => c.charCodeAt(0))]);
    expect(await readTextFile('/x/key.txt')).toBe('sk-key');
  });

  it('null on HTTP failure or thrown fetch', async () => {
    expect(await readTextFile('/x/missing.txt')).toBeNull();
    global.fetch = jest.fn(async () => {
      throw new Error('io');
    }) as unknown as typeof fetch;
    expect(await readTextFile('/x/err.txt')).toBeNull();
  });
});

describe('readTextFileUtf8Ex — the NOT_FOUND / transient split (v0.88)', () => {
  it('NOT_FOUND from the native module → notFound:true (shard may be dropped)', async () => {
    mockNative.readFileUtf8 = jest.fn(async () => ({
      success: false,
      code: 'NOT_FOUND',
    }));
    expect(await readTextFileUtf8Ex('/s/shard.json')).toEqual({
      data: null,
      notFound: true,
    });
  });

  it('READ_FAILED → falls to the fetch path; still-unreadable stays notFound:false (retry class)', async () => {
    mockNative.readFileUtf8 = jest.fn(async () => ({
      success: false,
      code: 'READ_FAILED',
    }));
    expect(await readTextFileUtf8Ex('/s/shard.json')).toEqual({
      data: null,
      notFound: false,
    });
  });

  it('without the native module the answer is conservative (never notFound:true)', async () => {
    fetchWith(null);
    expect(await readTextFileUtf8Ex('/s/shard.json')).toEqual({
      data: null,
      notFound: false,
    });
  });

  it('a successful native read returns the data verbatim', async () => {
    mockNative.readFileUtf8 = jest.fn(async () => ({
      success: true,
      data: 'contenu été 🎉',
    }));
    expect(await readTextFileUtf8Ex('/s/shard.json')).toEqual({
      data: 'contenu été 🎉',
      notFound: false,
    });
  });
});

describe('readTextFileUtf8 fallback chain', () => {
  it('prefers the native reader', async () => {
    mockNative.readFileUtf8 = jest.fn(async () => ({success: true, data: 'natif'}));
    const f = fetchWith([1, 2, 3]);
    expect(await readTextFileUtf8('/x/a.json')).toBe('natif');
    expect(f).not.toHaveBeenCalled();
  });

  it('falls back to fetch + UTF-8 decode when the native read fails', async () => {
    mockNative.readFileUtf8 = jest.fn(async () => ({success: false, code: 'READ_FAILED'}));
    fetchWith(Array.from(Buffer.from('été', 'utf8')));
    expect(await readTextFileUtf8('/x/a.json')).toBe('été');
  });

  it('native NOT_FOUND short-circuits to null (no pointless fetch)', async () => {
    mockNative.readFileUtf8 = jest.fn(async () => ({success: false, code: 'NOT_FOUND'}));
    const f = fetchWith([1]);
    expect(await readTextFileUtf8('/x/gone.json')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});

describe('writes', () => {
  it('writeTextFileUtf8: false when the native method is absent (callers keep their fallback)', async () => {
    expect(await writeTextFileUtf8('/x/a.json', 'data')).toBe(false);
  });

  it('writeTextAtomic: native UTF-8 first', async () => {
    mockNative.writeFileUtf8 = jest.fn(async () => ({success: true}));
    mockNative.writeFileBase64 = jest.fn();
    expect(await writeTextAtomic('/x/a.json', 'data')).toBe(true);
    expect(mockNative.writeFileBase64).not.toHaveBeenCalled();
  });

  it('writeTextAtomic: falls back to base64 when the UTF-8 write is refused', async () => {
    mockNative.writeFileUtf8 = jest.fn(async () => ({success: false}));
    mockNative.writeFileBase64 = jest.fn(async (_p: string, b64: string) => ({
      success: Buffer.from(b64, 'base64').toString('utf8') === 'été ✍',
    }));
    expect(await writeTextAtomic('/x/a.json', 'été ✍')).toBe(true);
  });

  it('writeTextAtomic: false when neither writer exists', async () => {
    expect(await writeTextAtomic('/x/a.json', 'data')).toBe(false);
  });
});

describe('directory / volume listings', () => {
  it('listDirNative returns entries on success, [] on anything else', async () => {
    const entries = [{name: 'a.json', isDir: false, size: 12}];
    mockNative.listDir = jest.fn(async () => ({success: true, entries}));
    expect(await listDirNative('/s')).toEqual(entries);
    mockNative.listDir = jest.fn(async () => ({success: false}));
    expect(await listDirNative('/s')).toEqual([]);
    delete mockNative.listDir; // old plugin binary
    expect(await listDirNative('/s')).toEqual([]);
  });

  it('listStorageVolumesNative filters to strings, [] on failure', async () => {
    mockNative.listStorageVolumes = jest.fn(async () => ({
      success: true,
      roots: ['/storage/sdcard1', 42, '/storage/usb'],
    }));
    expect(await listStorageVolumesNative()).toEqual([
      '/storage/sdcard1',
      '/storage/usb',
    ]);
    delete mockNative.listStorageVolumes;
    expect(await listStorageVolumesNative()).toEqual([]);
  });
});
