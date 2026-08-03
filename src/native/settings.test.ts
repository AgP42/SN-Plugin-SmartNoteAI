// The v0.58 settings SINGLETON — written after the 2026-07-18 incident
// (sync conflict emptied the on-disk file mid-session; the old
// read-merge-write then rewrote the gutted file as truth and the schemaV
// trap wiped the transcript store). These tests pin the properties that
// make that impossible: one load per session, full-state writes, .bak
// recovery, one-time legacy migration, explicit import/export.

export {}; // module scope — the IO test declares the same mock names

const mockWriteFileBase64 = jest.fn<Promise<{success?: boolean}>, [string, string]>();
const mockMakeDir = jest.fn<Promise<unknown>, [string]>();
const mockGetPluginDirPath = jest.fn<Promise<unknown>, []>();
const mockReadTextFileUtf8 = jest.fn<Promise<string | null>, [string]>();
const mockListDir = jest.fn<
  Promise<{success?: boolean; entries?: {name: string; isDir: boolean}[]}>,
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
  FileUtils: {makeDir: mockMakeDir},
  PluginManager: {getPluginDirPath: mockGetPluginDirPath},
}));
jest.mock('./fs', () => ({
  CONFIG_DIR: '/storage/emulated/0/MyStyle/Plugins/SmartNoteAI',
  readTextFileUtf8: mockReadTextFileUtf8,
  writeTextAtomic: jest.fn(async (p: string, content: string) => {
    const r = await mockWriteFileBase64(
      p,
      jest.requireActual('../core/util/base64').utf8ToBase64(content),
    );
    return r?.success === true;
  }),
}));

type Mod = typeof import('./settings');
let mod: Mod;

const PRIV = '/plugin/settings.json';
const PRIV_BAK = '/plugin/settings.json.bak';
const LEGACY = '/storage/emulated/0/MyStyle/Plugins/SmartNoteAI/settings.json';
const EXPORT = '/storage/emulated/0/MyStyle/Plugins/SmartNoteAI/smartnoteai-settings.json';

const FULL = {
  model: 'mistral-medium-latest',
  persona: 'be nice',
  textScale: 1.15,
  schemaV: 32,
  quickActions: [{label: 'Sum', prompt: 'Summarize', enabled: true}],
};

const serveFiles = (files: Record<string, string | null>): void => {
  mockReadTextFileUtf8.mockImplementation(async p => files[p] ?? null);
};

const b64ToJson = (b64: string): any =>
  JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
const writesTo = (path: string): any[] =>
  mockWriteFileBase64.mock.calls.filter(c => c[0] === path).map(c => b64ToJson(c[1]));
const lastWriteTo = (path: string): any => {
  const w = writesTo(path);
  return w[w.length - 1];
};

beforeEach(() => {
  jest.resetModules(); // fresh singleton state per test
  jest.clearAllMocks();
  mockGetPluginDirPath.mockResolvedValue('/plugin');
  mockMakeDir.mockResolvedValue(undefined);
  mockWriteFileBase64.mockResolvedValue({success: true});
  mockReadTextFileUtf8.mockResolvedValue(null);
  mockListDir.mockResolvedValue({success: true, entries: []});
  mod = jest.requireActual<Mod>('./settings');
});

describe('load (once per session)', () => {
  it('reads the PRIVATE settings.json and never re-reads it', async () => {
    serveFiles({[PRIV]: JSON.stringify(FULL)});
    expect((await mod.readSettings()).model).toBe('mistral-medium-latest');
    mockReadTextFileUtf8.mockClear();
    await mod.readSettings();
    expect(mockReadTextFileUtf8).not.toHaveBeenCalled(); // singleton
  });

  it('falls back to settings.json.bak when the main file is empty/corrupt', async () => {
    serveFiles({[PRIV]: '{torn', [PRIV_BAK]: JSON.stringify(FULL)});
    expect((await mod.readSettings()).persona).toBe('be nice');
  });

  it('IGNORES a legacy MyStyle settings file (Phase C: no migration)', async () => {
    serveFiles({[LEGACY]: JSON.stringify(FULL)});
    const s = await mod.readSettings();
    expect(s).toEqual({}); // defaults; Import is the one supported path
  });

  it('yields {} when nothing is readable anywhere', async () => {
    expect(await mod.readSettings()).toEqual({});
  });
});

describe('read failure ≠ absence (re-audit 2026-07-19 S1)', () => {
  it('main AND bak corrupt → READ-ONLY session, defaults never committed', async () => {
    serveFiles({[PRIV]: '{torn', [PRIV_BAK]: 'also{torn'});
    expect(await mod.readSettings()).toEqual({});
    const ok = await mod.updateSettings({persona: 'p'});
    expect(ok).toBe(false);
    expect(writesTo(PRIV)).toHaveLength(0);
    expect(writesTo(PRIV_BAK)).toHaveLength(0);
  });

  it('both reads null but the files EXIST on disk → READ-ONLY session', async () => {
    // Transient IO failure: readTextFileUtf8 nulls, but the listing
    // shows settings.json sitting right there.
    mockListDir.mockResolvedValue({
      success: true,
      entries: [{name: 'settings.json', isDir: false}],
    });
    expect(await mod.readSettings()).toEqual({});
    expect(await mod.updateSettings({persona: 'p'})).toBe(false);
    expect(writesTo(PRIV)).toHaveLength(0);
  });

  it('both null and the listing shows nothing → genuinely fresh, writes flow', async () => {
    expect(await mod.readSettings()).toEqual({});
    expect(await mod.updateSettings({persona: 'p'})).toBe(true);
    expect(lastWriteTo(PRIV).persona).toBe('p');
  });

  it('an explicit Import lifts the read-only guard (the intended recovery)', async () => {
    serveFiles({[PRIV]: '{torn', [PRIV_BAK]: 'also{torn'});
    await mod.readSettings();
    expect(await mod.updateSettings({persona: 'p'})).toBe(false); // guarded
    serveFiles({
      [PRIV]: '{torn',
      [PRIV_BAK]: 'also{torn',
      [EXPORT]: JSON.stringify(FULL),
    });
    const r = await mod.importSettings();
    expect(r.ok).toBe(true);
    expect(lastWriteTo(PRIV).model).toBe('mistral-medium-latest');
    expect(await mod.updateSettings({persona: 'p2'})).toBe(true); // unguarded
  });
});

describe('subscribeSettings (re-audit 2026-07-19 P2)', () => {
  it('fires on every updateSettings — even a refused write (memory advanced)', async () => {
    const seen = jest.fn();
    const off = mod.subscribeSettings(seen);
    await mod.updateSettings({persona: 'p'});
    expect(seen).toHaveBeenCalledTimes(1);
    mockWriteFileBase64.mockResolvedValue({success: false});
    await mod.updateSettings({persona: 'p2'});
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    await mod.updateSettings({persona: 'p3'});
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

describe('updateSettings (full-state patch writes)', () => {
  it('writes the FULL state on a single-field patch — the incident test: ' +
    'the disk being emptied under us cannot gut the file any more', async () => {
    serveFiles({[PRIV]: JSON.stringify(FULL)});
    await mod.readSettings(); // session loaded
    // A sync conflict now replaces the on-disk file with garbage — the
    // singleton must not care (it never reads it back).
    serveFiles({[PRIV]: ''});
    const ok = await mod.updateSettings({persona: 'new p'});
    expect(ok).toBe(true);
    const written = lastWriteTo(PRIV);
    expect(written.persona).toBe('new p'); // the patch
    expect(written.model).toBe('mistral-medium-latest'); // everything else kept
    expect(written.quickActions).toHaveLength(1);
    expect(lastWriteTo(PRIV_BAK).model).toBe('mistral-medium-latest');
  });

  it('serializes concurrent patches — no writer drops another field', async () => {
    await Promise.all([
      mod.updateSettings({model: 'm1'}),
      mod.updateSettings({persona: 'p1'}),
      mod.updateSettings({lastCheckAllAt: 42}),
    ]);
    const written = lastWriteTo(PRIV);
    expect(written).toMatchObject({model: 'm1', persona: 'p1', lastCheckAllAt: 42});
  });

  it('M2 guard: unresolved plugin dir → session is READ-ONLY, nothing hits /sdcard', async () => {
    mockGetPluginDirPath.mockResolvedValue(null); // fails all 3 retries
    expect(await mod.readSettings()).toEqual({});
    expect(await mod.updateSettings({model: 'x'})).toBe(false);
    expect(mockWriteFileBase64).not.toHaveBeenCalled();
  });

  it('reports a refused write and keeps serving the newer in-memory state', async () => {
    mockWriteFileBase64.mockResolvedValue({success: false});
    expect(await mod.updateSettings({model: 'm2'})).toBe(false);
    expect((await mod.readSettings()).model).toBe('m2'); // memory advanced
  });
});

describe('lasso mode migration (v0.81)', () => {
  it('keeps an EMPTY lassoDirective verbatim (never forces the default)', async () => {
    serveFiles({[PRIV]: JSON.stringify({...FULL, lassoDirective: ''})});
    const s = await mod.readSettings();
    expect(s.lassoDirective).toBe('');
  });
  it('drops the pre-release readerPersona/lassoPrompt fields WITHOUT migrating (Phase C)', async () => {
    serveFiles({
      [PRIV]: JSON.stringify({
        ...FULL,
        readerPersona: 'old reader persona',
        lassoPrompt: 'old lasso prompt',
      }),
    });
    const s = await mod.readSettings();
    expect(s.lassoDirective).toBeUndefined();
    expect(s.imageQuickActions).toBeUndefined();
    expect((s as Record<string, unknown>).readerPersona).toBeUndefined();
  });
  it('caps imageQuickActions at 3', async () => {
    const five = Array.from({length: 5}, (_, i) => ({
      label: `L${i}`,
      prompt: `P${i}`,
      enabled: true,
    }));
    serveFiles({[PRIV]: JSON.stringify({...FULL, imageQuickActions: five})});
    const s = await mod.readSettings();
    expect(s.imageQuickActions).toHaveLength(3);
  });
});

describe('export / import (the ONLY MyStyle bridge)', () => {
  it('exports pretty JSON of the full state to the MyStyle file', async () => {
    serveFiles({[PRIV]: JSON.stringify(FULL)});
    await mod.readSettings();
    expect(await mod.exportSettings()).toBe(EXPORT);
    const raw = Buffer.from(
      mockWriteFileBase64.mock.calls.filter(c => c[0] === EXPORT)[0][1],
      'base64',
    ).toString('utf8');
    expect(raw).toContain('\n'); // pretty-printed for hand editing
    expect(JSON.parse(raw).model).toBe('mistral-medium-latest');
  });

  it('import REPLACES the whole state from the file and persists it', async () => {
    serveFiles({
      [PRIV]: JSON.stringify(FULL),
      [EXPORT]: JSON.stringify({model: 'imported-model', textScale: 1.3}),
    });
    await mod.readSettings();
    const r = await mod.importSettings();
    expect(r.ok).toBe(true);
    expect(r.fields.sort()).toEqual(['model', 'textScale']);
    const s = await mod.readSettings();
    expect(s.model).toBe('imported-model');
    expect(s.persona).toBeUndefined(); // replace, not merge
    expect(lastWriteTo(PRIV).model).toBe('imported-model');
  });

  it('rejects a missing / invalid / fieldless file without touching the state', async () => {
    serveFiles({[PRIV]: JSON.stringify(FULL)});
    await mod.readSettings();
    expect((await mod.importSettings()).ok).toBe(false); // missing
    serveFiles({[PRIV]: JSON.stringify(FULL), [EXPORT]: '{nope'});
    expect((await mod.importSettings()).ok).toBe(false); // invalid JSON
    serveFiles({[PRIV]: JSON.stringify(FULL), [EXPORT]: '{"unknown": 1}'});
    expect((await mod.importSettings()).ok).toBe(false); // no known field
    expect((await mod.readSettings()).model).toBe('mistral-medium-latest');
  });
});
