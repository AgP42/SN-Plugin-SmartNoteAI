import {mistralRequest, MISTRAL_API, RETRY_DELAY_MS} from './http';
import type {FetchFn} from './types';

const okRes = (payload: unknown) => ({
  ok: true,
  status: 200,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
});

const errRes = (status: number, body = '') => ({
  ok: false,
  status,
  json: async () => ({}),
  text: async () => body,
});

describe('mistralRequest', () => {
  it('POSTs with auth headers to the API host and returns the JSON', async () => {
    const fetchFn: FetchFn = jest.fn(async () => okRes({hello: 1}));
    const r = await mistralRequest(fetchFn, 'sk-x', '/v1/ocr', {body: {a: 1}});
    expect(r).toEqual({ok: true, data: {hello: 1}});
    const [url, init] = (fetchFn as jest.Mock).mock.calls[0];
    expect(url).toBe(`${MISTRAL_API}/v1/ocr`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-x');
    expect(init.body).toBe('{"a":1}');
  });

  it('GET sends no body', async () => {
    const fetchFn: FetchFn = jest.fn(async () => okRes({}));
    await mistralRequest(fetchFn, 'k', '/v1/batch/jobs/j1', {method: 'GET'});
    const [, init] = (fetchFn as jest.Mock).mock.calls[0];
    expect(init.method).toBe('GET');
    expect('body' in init).toBe(false);
  });

  it('retries ONCE on a network error, then succeeds', async () => {
    const fetchFn: FetchFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce(okRes({v: 2}));
    const r = await mistralRequest(fetchFn, 'k', '/p', {body: {}});
    expect(r).toEqual({ok: true, data: {v: 2}});
    expect(fetchFn).toHaveBeenCalledTimes(2);
  }, 3000 + RETRY_DELAY_MS);

  it('retries ONCE on a 5xx, gives up on the second failure', async () => {
    const fetchFn: FetchFn = jest.fn(async () => errRes(503, 'busy'));
    const r = await mistralRequest(fetchFn, 'k', '/p', {body: {}});
    expect(r.ok).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    if (!r.ok) {
      expect(r.status).toBe(503);
    }
  }, 3000 + RETRY_DELAY_MS);

  it('does NOT retry a 4xx (the request got through)', async () => {
    const fetchFn: FetchFn = jest.fn(async () => errRes(422, 'bad model'));
    const r = await mistralRequest(fetchFn, 'k', '/p', {body: {}});
    expect(fetchFn).toHaveBeenCalledTimes(1);
    if (!r.ok) {
      expect(r.reason.toLowerCase()).toContain('model');
    }
  });

  it('does NOT retry an abort, and uses the custom abort wording', async () => {
    const fetchFn: FetchFn = jest.fn(async () => {
      throw new Error('The operation was aborted');
    });
    const r = await mistralRequest(fetchFn, 'k', '/p', {
      body: {},
      abortReason: 'OCR cancelled.',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    if (!r.ok) {
      expect(r.reason).toBe('OCR cancelled.');
    }
  });

  it('maps 401 to a key hint and malformed JSON to a clean failure', async () => {
    const r401 = await mistralRequest(
      jest.fn(async () => errRes(401)) as FetchFn,
      'k',
      '/p',
      {body: {}},
    );
    if (!r401.ok) {
      expect(r401.reason.toLowerCase()).toContain('key');
    }
    const rBad = await mistralRequest(
      jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('nope');
        },
        text: async () => 'x',
      })) as FetchFn,
      'k',
      '/p',
      {body: {}},
    );
    expect(rBad.ok).toBe(false);
  });
});
