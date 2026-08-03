// The global-fetch adapter: a type pin, but the delegation itself is
// what every core request rides on — one smoke test.

import {fetchAdapter} from './fetchAdapter';

describe('fetchAdapter', () => {
  it('delegates to the global fetch with url and init', async () => {
    const sentinel = {ok: true, status: 200};
    const f = jest.fn(async () => sentinel);
    global.fetch = f as unknown as typeof fetch;
    const init = {method: 'POST', headers: {}, body: '{}'};
    const r = await fetchAdapter('https://x/y', init);
    expect(f).toHaveBeenCalledWith('https://x/y', init);
    expect(r).toBe(sentinel);
  });
});
