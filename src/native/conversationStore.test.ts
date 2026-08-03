// ConversationStore index integrity (audit 2026-07-19 B5 + re-audit
// residual): "absent" and "transient read failure" must not be
// confused — the residual bug let two null reads rebuild the index down
// to ONE entry on the next save, orphaning the whole history. The index
// is now rebuilt from the <id>.json files themselves (each carries its
// own meta — the same B1 rule as the transcript-store shards), and a
// present-but-unreadable state throws instead of being overwritten.

export {}; // module scope — the const mock* names collide with other script-mode test files otherwise

const mockWriteFileBase64 = jest.fn<Promise<{success?: boolean}>, [string, string]>();
const mockListDir = jest.fn<
  Promise<{success?: boolean; entries?: {name: string; isDir: boolean}[]}>,
  [string]
>();
const mockReadTextFileUtf8 = jest.fn<Promise<string | null>, [string]>();
const mockDeleteFile = jest.fn<Promise<boolean>, [string]>();

jest.mock('react-native', () => ({
  NativeModules: {
    SmartNoteAiOverlay: {
      writeFileBase64: mockWriteFileBase64,
      listDir: mockListDir,
    },
  },
}));
jest.mock('sn-plugin-lib', () => ({
  FileUtils: {makeDir: async () => undefined, deleteFile: mockDeleteFile},
  PluginManager: {getPluginDirPath: async () => '/plugin'},
}));
jest.mock('./fs', () => ({
  readTextFileUtf8: mockReadTextFileUtf8,
  writeTextAtomic: jest.fn(async (p: string, content: string) => {
    const r = await mockWriteFileBase64(
      p,
      jest.requireActual('../core/util/base64').utf8ToBase64(content),
    );
    return r?.success === true;
  }),
}));

type Mod = typeof import('./conversationStore');
let mod: Mod;

const DIR = '/plugin/conversations';
const INDEX = `${DIR}/index.json`;
const INDEX_BAK = `${DIR}/index.json.bak`;

const conv = (id: string, updatedAt: number) => ({
  id,
  title: `t-${id}`,
  noteName: 'note',
  notePath: '/Note/n.note',
  updatedAt,
  createdAt: updatedAt,
  turns: [{role: 'user' as const, text: 'q'}],
});

const serveFiles = (files: Record<string, string | null>): void => {
  mockReadTextFileUtf8.mockImplementation(async p => files[p] ?? null);
};

const b64ToJson = (b64: string): any =>
  JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
const lastWriteTo = (path: string): any => {
  const w = mockWriteFileBase64.mock.calls.filter(c => c[0] === path);
  return w.length > 0 ? b64ToJson(w[w.length - 1][1]) : undefined;
};

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockWriteFileBase64.mockResolvedValue({success: true});
  mockReadTextFileUtf8.mockResolvedValue(null);
  mockListDir.mockResolvedValue({success: true, entries: []});
  mockDeleteFile.mockResolvedValue(true);
  mod = jest.requireActual<Mod>('./conversationStore');
});

describe('index read failure ≠ absence (B5 residual)', () => {
  it('nothing on disk → genuinely fresh history', async () => {
    expect(await mod.listConversations()).toEqual([]);
  });

  it('index reads null but conversation files EXIST → index REBUILT from them', async () => {
    mockListDir.mockResolvedValue({
      success: true,
      entries: [
        {name: 'a.json', isDir: false},
        {name: 'b.json', isDir: false},
        {name: 'index.json', isDir: false}, // never re-read as a conversation
        {name: 'index.json.bak', isDir: false},
      ],
    });
    serveFiles({
      [`${DIR}/a.json`]: JSON.stringify(conv('a', 10)),
      [`${DIR}/b.json`]: JSON.stringify(conv('b', 20)),
    });
    const list = await mod.listConversations();
    expect(list.map(m => m.id)).toEqual(['b', 'a']); // newest first
    expect(list[0].title).toBe('t-b');
  });

  it('conversation files exist but NONE is readable → throws, never overwritten', async () => {
    mockListDir.mockResolvedValue({
      success: true,
      entries: [{name: 'a.json', isDir: false}],
    });
    // a.json unreadable too (transient IO failure across the board)
    await expect(mod.listConversations()).rejects.toThrow(/not overwriting/);
    // The save path refuses as well — no one-entry index can be committed.
    await expect(mod.saveConversation(conv('new', 30))).rejects.toThrow();
    expect(lastWriteTo(INDEX)).toBeUndefined();
  });

  it('corrupt index + good .bak → served from the mirror', async () => {
    serveFiles({
      [INDEX]: '{torn',
      [INDEX_BAK]: JSON.stringify([
        {id: 'a', title: 't', noteName: '', notePath: '', updatedAt: 1},
      ]),
    });
    expect((await mod.listConversations()).map(m => m.id)).toEqual(['a']);
  });

  it('index AND .bak corrupt → throws (the original B5)', async () => {
    serveFiles({[INDEX]: '{torn', [INDEX_BAK]: 'also{torn'});
    await expect(mod.listConversations()).rejects.toThrow(/unreadable/);
  });
});

describe('save round-trip', () => {
  it('writes the conversation, the index and its .bak mirror', async () => {
    // A real timestamp — the retention purge drops anything older than
    // RETENTION_DAYS.
    await mod.saveConversation(conv('c1', Date.now()));
    expect(lastWriteTo(`${DIR}/c1.json`).turns).toHaveLength(1);
    expect(lastWriteTo(INDEX).map((m: {id: string}) => m.id)).toEqual(['c1']);
    expect(lastWriteTo(INDEX_BAK).map((m: {id: string}) => m.id)).toEqual([
      'c1',
    ]);
  });
});
