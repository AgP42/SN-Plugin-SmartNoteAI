// Encrypted-at-rest API key storage. Pins the user promises: a stored
// key survives a round-trip (XOR + PBKDF2 keystream over an in-memory
// crypto), the legacy MyStyle key file migrates ONCE into the encrypted
// store, an unreachable plugin dir degrades to "no key" (never a reject,
// never an /sdcard fallback write), and delete works even without a
// native delete primitive.

// ---- In-memory filesystem + deterministic crypto --------------------------

const mockFiles = new Map<string, string>(); // path → text content

const mockWriteFileBase64 = jest.fn(async (p: string, b64: string) => {
  mockFiles.set(p, Buffer.from(b64, 'base64').toString('utf8'));
  return {success: true};
});
const mockRandomBytes = jest.fn(async (len: number) => ({
  success: true,
  bytesB64: Buffer.alloc(len, 7).toString('base64'),
}));
// Deterministic keystream: derived from (password, salt) so that
// encrypt and decrypt agree — the property the real PBKDF2 provides.
const mockPbkdf2 = jest.fn(
  async (pwB64: string, saltB64: string, _iter: number, len: number) => {
    const seed = pwB64 + '|' + saltB64;
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
      out[i] = (seed.charCodeAt(i % seed.length) * 31 + i) & 0xff;
    }
    return {success: true, bytesB64: out.toString('base64')};
  },
);

// Lazy wrappers: the hoisted requires run before these consts initialize.
jest.mock('react-native', () => ({
  NativeModules: {
    SmartNoteAiOverlay: {
      writeFileBase64: (...a: unknown[]) =>
        mockWriteFileBase64(...(a as [string, string])),
      cryptoRandomBytes: (...a: unknown[]) =>
        mockRandomBytes(...(a as [number])),
      cryptoPbkdf2Sha256: (...a: unknown[]) =>
        mockPbkdf2(...(a as [string, string, number, number])),
    },
  },
}));

const mockPluginDir = {v: '/data/plugin' as string | null};
const mockDeleteFile = jest.fn(async (p: string) => mockFiles.delete(p));
jest.mock('sn-plugin-lib', () => ({
  PluginManager: {
    getPluginDirPath: async () => {
      if (mockPluginDir.v === null) {
        throw new Error('host not ready');
      }
      return mockPluginDir.v;
    },
  },
  FileUtils: {
    makeDir: async () => true,
    deleteFile: (p: string) => mockDeleteFile(p),
  },
}));

const LEGACY = '/mystyle/SmartNoteAI/mistral-key.txt';
jest.mock('./fs', () => ({
  KEY_FILE_PATH: '/mystyle/SmartNoteAI/mistral-key.txt',
  readTextFileUtf8: async (p: string) => mockFiles.get(p) ?? null,
  readTextFile: async (p: string) => mockFiles.get(p) ?? null,
}));

import {
  setApiKey,
  getApiKey,
  deleteApiKey,
  deleteLegacyKeyFile,
} from './secureKey';

const KEY_JSON = '/data/plugin/secrets/key.json';
const PEPPER = '/data/plugin/secrets/pepper.txt';

beforeEach(() => {
  mockFiles.clear();
  mockPluginDir.v = '/data/plugin';
  jest.clearAllMocks();
});

describe('set → get round-trip', () => {
  it('stores the key encrypted and reads it back verbatim', async () => {
    expect(await setApiKey('  sk-mistral-Été-123  ')).toBe(true);
    // At rest: a salt+data JSON, never the key in clear.
    expect(mockFiles.get(KEY_JSON)).toBeDefined();
    expect(mockFiles.get(KEY_JSON)).not.toContain('sk-mistral');
    expect(mockFiles.get(PEPPER)).toBeDefined();
    const st = await getApiKey();
    expect(st).toEqual({
      key: 'sk-mistral-Été-123', // trimmed, accents intact
      legacyFilePresent: false,
      migrated: false,
    });
  });

  it('reuses the existing pepper on a second set', async () => {
    await setApiKey('première-clé-0000');
    const pepper = mockFiles.get(PEPPER);
    await setApiKey('seconde-clé-1111');
    expect(mockFiles.get(PEPPER)).toBe(pepper);
    expect((await getApiKey()).key).toBe('seconde-clé-1111');
  });

  it('rejects an empty key', async () => {
    expect(await setApiKey('   ')).toBe(false);
    expect(mockFiles.has(KEY_JSON)).toBe(false);
  });
});

describe('legacy migration', () => {
  it('imports a valid legacy MyStyle key file once, flags it for cleanup', async () => {
    mockFiles.set(LEGACY, 'key=sk-legacy-key-4242\n');
    const st = await getApiKey();
    expect(st).toEqual({
      key: 'sk-legacy-key-4242',
      legacyFilePresent: true,
      migrated: true,
    });
    // Now stored encrypted: the next call serves the store, no re-import.
    const again = await getApiKey();
    expect(again.migrated).toBe(false);
    expect(again.key).toBe('sk-legacy-key-4242');
    expect(again.legacyFilePresent).toBe(true);
  });

  it('accepts a bare-key legacy file (no key= prefix)', async () => {
    mockFiles.set(LEGACY, '\n# comment\nsk-bare-key-abcdef123456\n');
    expect((await getApiKey()).key).toBe('sk-bare-key-abcdef123456');
  });

  it('an unparseable legacy file yields no key but still reports its presence', async () => {
    mockFiles.set(LEGACY, 'this is not a key at all');
    expect(await getApiKey()).toEqual({
      key: null,
      legacyFilePresent: true,
      migrated: false,
    });
  });

  it('deleteLegacyKeyFile removes the MyStyle file', async () => {
    mockFiles.set(LEGACY, 'key=x');
    expect(await deleteLegacyKeyFile()).toBe(true);
    expect(mockDeleteFile).toHaveBeenCalledWith(LEGACY);
    expect(mockFiles.has(LEGACY)).toBe(false);
  });
});

describe('deleteApiKey', () => {
  it('deletes the encrypted file via the native primitive', async () => {
    await setApiKey('sk-to-delete-9999');
    expect(await deleteApiKey()).toBe(true);
    expect((await getApiKey()).key).toBeNull();
  });

  it('falls back to overwriting with {} when delete is unavailable', async () => {
    await setApiKey('sk-to-delete-9999');
    mockDeleteFile.mockResolvedValueOnce(false);
    expect(await deleteApiKey()).toBe(true);
    expect(mockFiles.get(KEY_JSON)).toBe('{}');
    expect((await getApiKey()).key).toBeNull();
  });
});

describe('unreachable secrets dir (B6)', () => {
  it('setApiKey fails cleanly, getApiKey degrades to "no key", and it all recovers', async () => {
    // The module caches the dir after a first SUCCESS (by design), so the
    // "host not ready at boot" scenario needs a fresh module instance.
    jest.resetModules();
    const sk = require('./secureKey') as typeof import('./secureKey');
    mockPluginDir.v = null;
    expect(await sk.setApiKey('sk-while-down-1234')).toBe(false);
    // Nothing leaked anywhere (in particular: no /sdcard fallback write).
    expect(mockFiles.size).toBe(0);
    await expect(sk.getApiKey()).resolves.toEqual({
      key: null,
      legacyFilePresent: false,
      migrated: false,
    });
    // The FAILURE is not cached: once the host answers, everything works.
    mockPluginDir.v = '/data/plugin';
    expect(await sk.setApiKey('sk-after-recovery-1')).toBe(true);
    expect((await sk.getApiKey()).key).toBe('sk-after-recovery-1');
  });
});
