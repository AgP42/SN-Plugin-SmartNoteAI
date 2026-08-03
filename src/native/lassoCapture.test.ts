// Lasso → PNG capture around the official generateLassoPreview. What
// matters here: the temp PNG is ALWAYS deleted (even on failure), a
// rotated selection is straightened before reading, and "no selection"
// degrades to null instead of throwing.

jest.mock('react-native', () => ({
  NativeModules: {SmartNoteAiOverlay: {}},
}));

const mockPreview = jest.fn<Promise<unknown>, [string]>();
const mockDeleteFile = jest.fn(async (_p: string) => true);
jest.mock('sn-plugin-lib', () => ({
  PluginCommAPI: {
    generateLassoPreview: (p: string) => mockPreview(p),
  },
  PluginManager: {getPluginDirPath: async () => '/data/plugin'},
  FileUtils: {deleteFile: (p: string) => mockDeleteFile(p)},
}));

jest.mock('./captureBridge', () => ({
  captureBridge: () => ({
    getCurrentFilePath: async () => '/n/carnet.note',
    getCurrentPageNum: async () => 4,
  }),
}));
jest.mock('./capture', () => ({
  asString: (v: unknown) => (typeof v === 'string' ? v : null),
  asNumber: (v: unknown) => (typeof v === 'number' ? v : null),
}));

import {captureLassoImage} from './lassoCapture';

// The SAME object instance the module destructured — mutated per test.
const mockOverlay = (
  jest.requireMock('react-native') as {
    NativeModules: {
      SmartNoteAiOverlay: {readFileBase64?: jest.Mock; rotatePng?: jest.Mock};
    };
  }
).NativeModules.SmartNoteAiOverlay;

beforeEach(() => {
  jest.clearAllMocks();
  delete mockOverlay.readFileBase64;
  delete mockOverlay.rotatePng;
});

describe('captureLassoImage', () => {
  it('captures, straightens a rotated selection, and cleans the temp PNG', async () => {
    mockPreview.mockResolvedValue({
      result: {imagePath: '/data/plugin/sp-lasso-4.png', rotateDegree: 90},
    });
    mockOverlay.rotatePng = jest.fn(async () => ({success: true}));
    mockOverlay.readFileBase64 = jest.fn(async () => ({
      success: true,
      data: 'PNGB64',
    }));
    const r = await captureLassoImage();
    expect(r).toEqual({image: 'PNGB64', note: '/n/carnet.note', page: 4});
    expect(mockOverlay.rotatePng).toHaveBeenCalledWith(
      '/data/plugin/sp-lasso-4.png',
      90,
    );
    expect(mockDeleteFile).toHaveBeenCalledWith('/data/plugin/sp-lasso-4.png');
  });

  it('does not rotate an upright selection (0 or 360 degrees)', async () => {
    mockPreview.mockResolvedValue({result: {rotateDegree: 360}});
    mockOverlay.rotatePng = jest.fn();
    mockOverlay.readFileBase64 = jest.fn(async () => ({
      success: true,
      data: 'B',
    }));
    expect(await captureLassoImage()).not.toBeNull();
    expect(mockOverlay.rotatePng).not.toHaveBeenCalled();
  });

  it('no selection → null, and the temp path is still cleaned up', async () => {
    mockPreview.mockRejectedValue(new Error('no lasso context'));
    expect(await captureLassoImage()).toBeNull();
    expect(mockDeleteFile).toHaveBeenCalledWith('/data/plugin/sp-lasso-4.png');
  });

  it('an unreadable preview PNG → null, file cleaned', async () => {
    mockPreview.mockResolvedValue({result: {}});
    mockOverlay.readFileBase64 = jest.fn(async () => ({success: false}));
    expect(await captureLassoImage()).toBeNull();
    expect(mockDeleteFile).toHaveBeenCalled();
  });

  it('cleans the path the API ACTUALLY wrote to when it differs from ours', async () => {
    mockPreview.mockResolvedValue({
      result: {imagePath: '/elsewhere/preview.png'},
    });
    mockOverlay.readFileBase64 = jest.fn(async () => ({
      success: true,
      data: 'B',
    }));
    await captureLassoImage();
    expect(mockDeleteFile).toHaveBeenCalledWith('/elsewhere/preview.png');
  });
});
