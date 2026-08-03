// The native-POST FetchFn (the live pipeline's "no image bytes on the
// JS thread" path). Pins the transport contract mistralRequest relies
// on: Bearer stripping, the exact native call shape, Response-like
// mapping, and thrown (retryable) transport failures.

jest.mock('react-native', () => ({
  NativeModules: {SmartNoteAiOverlay: {}},
}));

import {nativePostAvailable, nativeFileFetch} from './nativePostFetch';

// The SAME object instance the module destructured — mutated per test.
const mockNative = (
  jest.requireMock('react-native') as {
    NativeModules: {SmartNoteAiOverlay: {postJsonWithFile?: jest.Mock}};
  }
).NativeModules.SmartNoteAiOverlay;

beforeEach(() => {
  delete mockNative.postJsonWithFile;
});

describe('nativePostAvailable', () => {
  it('reflects the native method presence', () => {
    expect(nativePostAvailable()).toBe(false);
    mockNative.postJsonWithFile = jest.fn();
    expect(nativePostAvailable()).toBe(true);
  });
});

describe('nativeFileFetch', () => {
  it('posts the template with the file path, strips the Bearer prefix, maps the response', async () => {
    mockNative.postJsonWithFile = jest.fn(async () => ({
      success: true,
      status: 200,
      body: '{"pages":[1]}',
    }));
    const f = nativeFileFetch('/tmp/render.png');
    const res = await f('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {Authorization: 'Bearer sk-secret'},
      body: '{"image":"__FILE_B64__"}',
    });
    expect(mockNative.postJsonWithFile).toHaveBeenCalledWith(
      'https://api.mistral.ai/v1/ocr',
      'sk-secret', // no "Bearer " prefix
      '{"image":"__FILE_B64__"}',
      '/tmp/render.png',
      false, // never deletes — a retry must re-read the file
      120_000,
    );
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({pages: [1]});
    expect(await res.text()).toBe('{"pages":[1]}');
  });

  it('a 4xx/5xx is a NON-ok response (not a throw — the core reads the body)', async () => {
    mockNative.postJsonWithFile = jest.fn(async () => ({
      success: true,
      status: 429,
      body: '{"message":"rate limited"}',
    }));
    const res = await nativeFileFetch('/f.png')('u', {method: 'POST', headers: {}, body: '{}'});
    expect(res.ok).toBe(false);
    expect(res.status).toBe(429);
  });

  it('a transport failure THROWS (mistralRequest wraps it as retryable)', async () => {
    mockNative.postJsonWithFile = jest.fn(async () => ({
      success: false,
      message: 'socket reset',
    }));
    await expect(nativeFileFetch('/f.png')('u', {method: 'POST', headers: {}, body: '{}'})).rejects.toThrow(
      'socket reset',
    );
  });

  it('throws when the native method is absent', async () => {
    await expect(nativeFileFetch('/f.png')('u', {method: 'POST', headers: {}, body: '{}'})).rejects.toThrow(
      'native post unavailable',
    );
  });
});
