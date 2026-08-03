// tmpJanitor (2026-07-19, "29 MB install" diagnosis): the startup sweep
// deletes ONLY our own stale temp patterns — never a foreign file, never
// anything fresh enough to be an in-flight upload/render.

export {}; // module scope — the const mock* names collide with other script-mode test files otherwise

const mockListDir = jest.fn<
  Promise<{success?: boolean; entries?: {name: string; isDir: boolean; size?: number}[]}>,
  [string]
>();
const mockDeleteFile = jest.fn<Promise<boolean>, [string]>();
const mockGetPluginDirPath = jest.fn<Promise<unknown>, []>();

jest.mock('react-native', () => ({
  NativeModules: {SmartNoteAiOverlay: {listDir: mockListDir}},
}));
jest.mock('sn-plugin-lib', () => ({
  FileUtils: {deleteFile: mockDeleteFile},
  PluginManager: {getPluginDirPath: mockGetPluginDirPath},
}));

// requireActual in beforeEach (the repo's pattern): a top-level import
// runs the hoisted react-native mock factory while the mock* consts are
// still uninitialized — the module would capture listDir: undefined.
type Mod = typeof import('./tmpJanitor');
let sweepTempFiles: Mod['sweepTempFiles'];

const OLD = Date.now() - 2 * 60 * 60 * 1000; // 2 h — stale
const FRESH = Date.now() - 60 * 1000; // 1 min — maybe in flight

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockGetPluginDirPath.mockResolvedValue('/plugin');
  mockDeleteFile.mockResolvedValue(true);
  mockListDir.mockResolvedValue({success: true, entries: []});
  sweepTempFiles = jest.requireActual<Mod>('./tmpJanitor').sweepTempFiles;
});

it('deletes stale batch uploads and render scratches, spares fresh + foreign files', async () => {
  mockListDir.mockResolvedValue({
    success: true,
    entries: [
      {name: `batch-upload-${OLD}.jsonl`, isDir: false, size: 18_000_000},
      {name: `sp-scratch-${OLD}-3.png`, isDir: false, size: 600_000},
      {name: `sp-doc-${OLD}-7.png`, isDir: false, size: 500_000},
      {name: `batch-upload-${FRESH}.jsonl`, isDir: false, size: 9_000_000},
      {name: 'settings.json', isDir: false, size: 4_000},
      {name: 'transcripts', isDir: true},
      {name: 'store.json', isDir: false, size: 100_000},
    ],
  });
  await sweepTempFiles();
  const deleted = mockDeleteFile.mock.calls.map(c => c[0]);
  expect(deleted).toEqual([
    `/plugin/batch-upload-${OLD}.jsonl`,
    `/plugin/sp-scratch-${OLD}-3.png`,
    `/plugin/sp-doc-${OLD}-7.png`,
  ]);
});

it('unresolved plugin dir → no guessing, nothing deleted', async () => {
  mockGetPluginDirPath.mockResolvedValue(null);
  await sweepTempFiles();
  expect(mockListDir).not.toHaveBeenCalled();
  expect(mockDeleteFile).not.toHaveBeenCalled();
});

it('failed listing → nothing deleted, no throw', async () => {
  mockListDir.mockResolvedValue({success: false});
  await expect(sweepTempFiles()).resolves.toBeUndefined();
  expect(mockDeleteFile).not.toHaveBeenCalled();
});
