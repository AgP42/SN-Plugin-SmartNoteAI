// The rename follow-through (2026-08-10). The evidence rule is the whole
// point: listDirNative returns [] for an empty folder AND for a failed
// listing (an unmounted SD card looks exactly like an empty one), so only
// a NON-EMPTY listing that lacks the file may conclude anything.

const mockListDir = jest.fn();
jest.mock('./fs', () => ({
  listDirNative: (...a: unknown[]) => mockListDir(...a),
}));

const mockMutateStore = jest.fn();
jest.mock('./transcriptStoreIo', () => ({
  mutateStore: (...a: unknown[]) => mockMutateStore(...a),
}));

const mockUpdateSettingsWith = jest.fn();
jest.mock('./settings', () => ({
  updateSettingsWith: (...a: unknown[]) => mockUpdateSettingsWith(...a),
}));

const mockRenameManualWanted = jest.fn();
jest.mock('./autoTranscript', () => ({
  renameManualWanted: (...a: unknown[]) => mockRenameManualWanted(...a),
}));

import {provenGone, followRename} from './renameFollow';
import {
  emptyStore,
  upsertPage,
  setDocLock,
  type Store,
} from '../core/store/transcriptStore';
import type {Settings} from './settings';

const storeRef: {state: Store} = {state: emptyStore()};
const OLD = '/Note/Work/Réunion.note';
const NEW = '/Note/Work/Réunion 2026.note';

beforeEach(() => {
  jest.clearAllMocks();
  storeRef.state = emptyStore();
  mockUpdateSettingsWith.mockResolvedValue(true);
  mockMutateStore.mockImplementation(async (fn: (s: Store) => unknown) => {
    fn(storeRef.state);
  });
});

describe('provenGone (the evidence rule)', () => {
  it('a non-empty listing WITHOUT the file proves it is gone', async () => {
    mockListDir.mockResolvedValue([
      {name: 'Réunion 2026.note', isDir: false},
      {name: 'Autre.note', isDir: false},
    ]);
    expect(await provenGone(OLD)).toBe(true);
    expect(mockListDir).toHaveBeenCalledWith('/Note/Work');
  });

  it('a non-empty listing WITH the file proves it is still there', async () => {
    mockListDir.mockResolvedValue([{name: 'Réunion.note', isDir: false}]);
    expect(await provenGone(OLD)).toBe(false);
  });

  it('an EMPTY listing proves nothing — a failed read looks identical', async () => {
    mockListDir.mockResolvedValue([]);
    expect(await provenGone(OLD)).toBe(false);
  });

  it('a directory of the same name is not the file', async () => {
    mockListDir.mockResolvedValue([{name: 'Réunion.note', isDir: true}]);
    expect(await provenGone(OLD)).toBe(true);
  });
});

describe('followRename', () => {
  const seed = (): void => {
    upsertPage(storeRef.state, OLD, 0, {text: 'x', source: 'user', at: 1, hash: 'P1'}, 1);
    upsertPage(storeRef.state, NEW, 0, {text: 'x', source: 'user', at: 1, hash: 'P1'}, 1);
  };

  it('migrates the sync mode and the agents in ONE queued settings write', async () => {
    seed();
    await followRename(OLD, NEW);
    expect(mockUpdateSettingsWith).toHaveBeenCalledTimes(1);
    const updater = mockUpdateSettingsWith.mock.calls[0][0] as unknown as (
      s: Settings,
    ) => Partial<Settings>;
    const patch = updater({
      autoTargets: {[OLD]: {mode: 'off'}},
      agents: [{id: 'a', name: 'A', icon: '📚', docs: [OLD]}],
    } as unknown as Settings);
    expect(patch.autoTargets).toEqual({[NEW]: {mode: 'off'}});
    expect(patch.agents![0].docs).toEqual([NEW]);
  });

  it('writes NOTHING to settings when the file had nothing attached', async () => {
    seed();
    await followRename(OLD, NEW);
    const updater = mockUpdateSettingsWith.mock.calls[0][0] as unknown as (
      s: Settings,
    ) => Partial<Settings>;
    expect(updater({} as Settings)).toEqual({});
  });

  it('hands the standing Sync order to its one writer, and retires the ghost', async () => {
    seed();
    setDocLock(storeRef.state, OLD, true);
    await followRename(OLD, NEW);
    expect(mockRenameManualWanted).toHaveBeenCalledWith(OLD, NEW);
    expect(storeRef.state.docs[OLD]).toBeUndefined(); // ghost gone
    expect(storeRef.state.docs[NEW].lock).toBe(true); // freeze followed
  });

  it('a failed settings write never blocks the store cleanup', async () => {
    seed();
    mockUpdateSettingsWith.mockRejectedValueOnce(new Error('disk full'));
    await expect(followRename(OLD, NEW)).resolves.toBeUndefined();
    expect(storeRef.state.docs[OLD]).toBeUndefined();
  });
});
