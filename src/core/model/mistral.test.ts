import {buildBody, sendChat} from './mistral';
import type {ChatRequest, FetchFn, ModelConfig} from './types';

const CONFIG: ModelConfig = {
  apiKey: 'sk-test',
  model: 'mistral-small-latest',
  maxTokens: 1024,
};

const baseReq = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  system: 'You are helpful.',
  turns: [{role: 'user', text: 'Hello'}],
  maxTokens: 1024,
  ...over,
});

const okFetch = (payload: unknown): FetchFn =>
  jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }));

describe('buildBody', () => {
  it('answer style: temperature only when set (v0.49)', () => {
    const req = {system: 's', turns: [{role: 'user' as const, text: 'q'}], maxTokens: 10};
    expect(buildBody(req, 'm').temperature).toBeUndefined();
    expect(buildBody({...req, temperature: 0.2}, 'm').temperature).toBe(0.2);
  });

  it('prepends the system message and maps a text turn to a string', () => {
    const body = buildBody(baseReq(), 'mistral-small-latest');
    expect(body.model).toBe('mistral-small-latest');
    expect(body.max_tokens).toBe(1024);
    const messages = body.messages as Array<{role: string; content: unknown}>;
    expect(messages[0]).toEqual({role: 'system', content: 'You are helpful.'});
    expect(messages[1]).toEqual({role: 'user', content: 'Hello'});
  });

  it('omits the system message when empty', () => {
    const body = buildBody(baseReq({system: '  '}), 'm');
    const messages = body.messages as Array<{role: string}>;
    expect(messages[0].role).toBe('user');
  });

  it('wraps an image turn as text + image_url parts (data URL)', () => {
    const body = buildBody(
      baseReq({turns: [{role: 'user', text: 'what is this?', images: ['AAAB']}]}),
      'm',
    );
    const msg = (body.messages as Array<{content: unknown}>)[1];
    expect(msg.content).toEqual([
      {type: 'text', text: 'what is this?'},
      {type: 'image_url', image_url: {url: 'data:image/png;base64,AAAB'}},
    ]);
  });

  it('image-only turn (no text) sends just the image part', () => {
    const body = buildBody(
      baseReq({turns: [{role: 'user', text: '', images: ['IMG']}]}),
      'm',
    );
    const parts = (body.messages as Array<{content: unknown[]}>)[1].content;
    expect(parts).toHaveLength(1);
    expect((parts[0] as {type: string}).type).toBe('image_url');
  });
});

describe('sendChat', () => {
  it('posts to the Mistral endpoint with Bearer auth', async () => {
    const fetchFn = okFetch({
      model: 'mistral-small-latest',
      choices: [{message: {content: 'hi'}}],
      usage: {prompt_tokens: 10, completion_tokens: 3},
    });
    const r = await sendChat(fetchFn, CONFIG, baseReq());
    expect(r.ok).toBe(true);
    const [url, init] = (fetchFn as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    if (r.ok) {
      expect(r.text).toBe('hi');
      expect(r.usage).toEqual({inputTokens: 10, outputTokens: 3, cachedTokens: 0});
    }
  });

  it('adds prompt_cache_key only when a cacheKey is set', () => {
    expect('prompt_cache_key' in buildBody(baseReq(), 'm')).toBe(false);
    const withKey = buildBody({...baseReq(), cacheKey: 'conv-1'}, 'm');
    expect(withKey.prompt_cache_key).toBe('conv-1');
  });

  it('reports cached_tokens from usage details', async () => {
    const fetchFn = okFetch({
      model: 'm',
      choices: [{message: {content: 'x'}}],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 5,
        prompt_tokens_details: {cached_tokens: 64},
      },
    });
    const r = await sendChat(fetchFn, CONFIG, baseReq());
    if (r.ok) {
      expect(r.usage.cachedTokens).toBe(64);
    }
  });

  it('maps a 401 to a key-file hint', async () => {
    const fetchFn: FetchFn = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => '{"message":"unauthorized"}',
    }));
    const r = await sendChat(fetchFn, CONFIG, baseReq());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.reason.toLowerCase()).toContain('key');
    }
  });

  it('maps a 422 to a model-id hint', async () => {
    const fetchFn: FetchFn = jest.fn(async () => ({
      ok: false,
      status: 422,
      json: async () => ({}),
      text: async () => 'bad model',
    }));
    const r = await sendChat(fetchFn, CONFIG, baseReq());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason.toLowerCase()).toContain('model');
    }
  });

  it('returns a timeout reason on abort', async () => {
    const fetchFn: FetchFn = jest.fn(async () => {
      throw new Error('The operation was aborted');
    });
    const r = await sendChat(fetchFn, CONFIG, baseReq());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('timed out');
    }
  });

  it('handles a malformed (non-JSON) 200 body', async () => {
    const fetchFn: FetchFn = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
      text: async () => 'oops',
    }));
    const r = await sendChat(fetchFn, CONFIG, baseReq());
    expect(r.ok).toBe(false);
  });
});
