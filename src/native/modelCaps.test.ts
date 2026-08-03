// The panel's one-shot /v1/models capability cache. Pins: ONE fetch per
// session shared by all callers, undefined on failure WITH retry on the
// next call (a failed fetch must not poison the whole session).

let modelSupportsTools: typeof import('./modelCaps').modelSupportsTools;

const okPayload = {
  data: [
    {id: 'mistral-large-latest', capabilities: {function_calling: true}},
    {id: 'pixtral-12b', capabilities: {function_calling: false}},
    {id: 'weird-entry'}, // no capabilities — skipped
  ],
};

const mockFetch = jest.fn();

beforeEach(() => {
  jest.resetModules(); // fresh module: the caps cache is session-level
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockReset();
  modelSupportsTools = require('./modelCaps').modelSupportsTools;
});

const okResponse = () => ({
  ok: true,
  json: async () => okPayload,
});

describe('modelSupportsTools', () => {
  it('answers from ONE fetch for any number of calls', async () => {
    mockFetch.mockResolvedValue(okResponse());
    expect(await modelSupportsTools('sk-key', 'mistral-large-latest')).toBe(
      true,
    );
    expect(await modelSupportsTools('sk-key', 'pixtral-12b')).toBe(false);
    expect(
      await modelSupportsTools('sk-key', 'unknown-model'),
    ).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.mistral.ai/v1/models',
      {headers: {Authorization: 'Bearer sk-key'}},
    );
  });

  it('offline: undefined now, RETRIES on the next call, then caches', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    expect(
      await modelSupportsTools('sk-key', 'mistral-large-latest'),
    ).toBeUndefined();
    mockFetch.mockResolvedValue(okResponse());
    expect(await modelSupportsTools('sk-key', 'mistral-large-latest')).toBe(
      true,
    );
    await modelSupportsTools('sk-key', 'pixtral-12b');
    expect(mockFetch).toHaveBeenCalledTimes(2); // 1 failed + 1 cached-good
  });

  it('an HTTP error behaves like offline (undefined, retry later)', async () => {
    mockFetch.mockResolvedValueOnce({ok: false, json: async () => ({})});
    expect(await modelSupportsTools('sk-key', 'any')).toBeUndefined();
    mockFetch.mockResolvedValue(okResponse());
    expect(await modelSupportsTools('sk-key', 'pixtral-12b')).toBe(false);
  });
});
