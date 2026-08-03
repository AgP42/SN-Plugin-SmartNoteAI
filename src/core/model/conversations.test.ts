import {
  buildConversationBody,
  parseConversationOutputs,
  sendConversation,
} from './conversations';
import type {ChatRequest, FetchFn} from './types';

const REQ: ChatRequest = {
  system: 'Be brief.',
  turns: [
    {role: 'user', text: 'hello'},
    {role: 'assistant', text: 'hi'},
    {role: 'user', text: 'what is the BTC price?'},
  ],
  maxTokens: 512,
};

describe('buildConversationBody', () => {
  it('maps system→instructions, turns→inputs, tools inline, store:false', () => {
    const b = buildConversationBody(REQ, 'mistral-medium-latest', [
      'web_search',
    ]) as {
      instructions: string;
      inputs: Array<{role: string; content: string}>;
      tools: Array<{type: string}>;
      store: boolean;
      completion_args: {max_tokens: number};
    };
    expect(b.instructions).toBe('Be brief.');
    expect(b.inputs).toHaveLength(3);
    expect(b.inputs[2]).toEqual({role: 'user', content: 'what is the BTC price?'});
    expect(b.tools).toEqual([{type: 'web_search'}]);
    expect(b.store).toBe(false);
    expect(b.completion_args.max_tokens).toBe(512);
  });
  it('omits instructions and tools when empty', () => {
    const b = buildConversationBody({...REQ, system: '  '}, 'm', []);
    expect(b.instructions).toBeUndefined();
    expect(b.tools).toBeUndefined();
  });
});

describe('parseConversationOutputs', () => {
  it('joins text parts, dedupes citations, lists tool runs', () => {
    const {text, sources, toolsUsed} = parseConversationOutputs({
      outputs: [
        {type: 'tool.execution', name: 'web_search'},
        {
          type: 'message.output',
          content: [
            {type: 'text', text: 'BTC is at 64k'},
            {type: 'tool_reference', title: 'TradingView', url: 'https://tv.com'},
            {type: 'text', text: ' today.'},
            {type: 'tool_reference', title: 'dup', url: 'https://tv.com'},
          ],
        },
      ],
    });
    expect(text).toBe('BTC is at 64k today.');
    expect(sources).toEqual([{title: 'TradingView', url: 'https://tv.com'}]);
    expect(toolsUsed).toEqual(['web_search']);
  });
  it('handles string content and malformed payloads', () => {
    expect(
      parseConversationOutputs({
        outputs: [{type: 'message.output', content: 'plain'}],
      }).text,
    ).toBe('plain');
    expect(parseConversationOutputs(null).text).toBe('');
  });
});

describe('sendConversation', () => {
  it('POSTs and folds connector_tokens into inputTokens', async () => {
    const fn: FetchFn = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        outputs: [{type: 'message.output', content: 'answer'}],
        usage: {prompt_tokens: 300, completion_tokens: 50, connector_tokens: 7000},
      }),
      text: async () => '',
    });
    const r = await sendConversation(fn, 'K', 'mistral-medium-latest', ['web_search'], REQ);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.usage.inputTokens).toBe(7300);
      expect(r.text).toBe('answer');
    }
  });
  it('reports HTTP failures without throwing', async () => {
    const fn: FetchFn = async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
      text: async () => 'rate limited',
    });
    const r = await sendConversation(fn, 'K', 'm', [], REQ);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('429');
    }
  });
});
