// Live /v1/models info for the pickers. The logic worth pinning is the
// -latest alias resolution BY FAMILY (device bug 2026-07-18: the API
// cross-links aliases, and "mistral-small-latest" once resolved to
// "magistral-small-…" because any entry could claim it), plus the v0.88
// key-change refetch.

import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {useModelInfo, type ModelInfo} from './useModelInfo';

const PAYLOAD = {
  data: [
    {
      id: 'mistral-small-2503',
      aliases: ['mistral-small-latest', 'magistral-small-latest'],
      description: 'Small dated',
      max_context_length: 32000,
      capabilities: {vision: true, function_calling: true},
    },
    {
      id: 'magistral-small-2506',
      aliases: ['magistral-small-latest'],
      capabilities: {vision: false, function_calling: false},
      deprecation: '2027-01-01',
      deprecation_replacement_model: 'magistral-small-2601',
    },
    // The aliases themselves are listed as entries too (API shape) —
    // they must never become resolution targets.
    {id: 'mistral-small-latest', aliases: ['mistral-small-2503']},
    {id: 'magistral-small-latest'},
  ],
};

const mockFetch = jest.fn();

const renderHook = (
  key: string | null,
): {ref: {current: Record<string, ModelInfo> | null}; root: ReactTestRenderer} => {
  const ref = {current: null as Record<string, ModelInfo> | null};
  const Probe = ({k}: {k: string | null}): null => {
    ref.current = useModelInfo(k);
    return null;
  };
  let root!: ReactTestRenderer;
  act(() => {
    root = create(React.createElement(Probe, {k: key}));
  });
  return {
    ref,
    root: Object.assign(root, {
      setKey: undefined,
    }) as ReactTestRenderer,
  };
};

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockResolvedValue({ok: true, json: async () => PAYLOAD});
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('useModelInfo', () => {
  it('resolves each -latest alias to a dated id of the SAME family only', async () => {
    const {ref} = renderHook('sk-key');
    await flush();
    const info = ref.current!;
    // The cross-linked magistral alias on the mistral entry is rejected.
    expect(info['mistral-small-latest'].resolvedId).toBe('mistral-small-2503');
    expect(info['magistral-small-latest'].resolvedId).toBe(
      'magistral-small-2506',
    );
    // Capabilities/desc/deprecation flow into the alias entry.
    expect(info['mistral-small-latest'].ctx).toBe(32000);
    expect(info['mistral-small-latest'].vision).toBe(true);
    expect(info['magistral-small-latest'].dep).toBe('2027-01-01');
    expect(info['magistral-small-latest'].depRepl).toBe('magistral-small-2601');
    expect(mockFetch).toHaveBeenCalledWith('https://api.mistral.ai/v1/models', {
      headers: {Authorization: 'Bearer sk-key'},
    });
  });

  it('no key → no fetch, null info', async () => {
    const {ref} = renderHook(null);
    await flush();
    expect(ref.current).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refetches when the key CHANGES during the same mount (v0.88)', async () => {
    const ref = {current: null as Record<string, ModelInfo> | null};
    const Probe = ({k}: {k: string | null}): null => {
      ref.current = useModelInfo(k);
      return null;
    };
    let root!: ReactTestRenderer;
    act(() => {
      root = create(React.createElement(Probe, {k: 'sk-old'}));
    });
    await flush();
    expect(ref.current).not.toBeNull();
    act(() => {
      root.update(React.createElement(Probe, {k: 'sk-new'}));
    });
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://api.mistral.ai/v1/models',
      {headers: {Authorization: 'Bearer sk-new'}},
    );
  });

  it('offline → stays null, pickers degrade gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    const {ref} = renderHook('sk-key');
    await flush();
    expect(ref.current).toBeNull();
  });
});
