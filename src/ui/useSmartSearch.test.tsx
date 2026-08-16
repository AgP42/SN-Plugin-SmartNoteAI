// The query → hits hook shared by the Library field and the floating
// search overlay. Pins: the activity threshold (≥2 chars AND ≥1
// criterion), the cap+1 truncation probe, the zero-hit explanation
// (v0.65.1), and the config-only debounce. The grammar itself
// (parseSmartQuery) and the matcher (searchLibraryAdvanced) have their
// own core suites — the matcher is mocked here.

import React from 'react';
import {act, create} from 'react-test-renderer';

jest.mock('../native/transcriptStoreIo', () => ({
  loadStore: async () => ({v: 1, docs: {}}),
}));

const mockSearch = jest.fn();
jest.mock('../core/store/librarySearch', () => ({
  searchLibraryAdvanced: (...a: unknown[]) => mockSearch(...a),
}));

import {useSmartSearch, SEARCH_LIMIT, type SmartSearchState} from './useSmartSearch';

const hit = (i: number): unknown => ({
  path: `/n/doc${i}.note`,
  page: 0,
  score: 1,
  snippet: `hit ${i}`,
});

const renderHook = (
  query: string,
  debounceMs?: number,
): {current: SmartSearchState} => {
  const ref = {current: null as unknown as SmartSearchState};
  const Probe = (): null => {
    ref.current = useSmartSearch(query, debounceMs);
    return null;
  };
  act(() => {
    create(React.createElement(Probe));
  });
  return ref;
};

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  mockSearch.mockReset();
  mockSearch.mockReturnValue([]);
});

describe('useSmartSearch', () => {
  it('stays inactive below 2 characters (no store hit at all)', async () => {
    const h = renderHook('a');
    await flush();
    expect(h.current.active).toBe(false);
    expect(h.current.interp).toBe('');
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('runs an active query and echoes the interpretation', async () => {
    mockSearch.mockReturnValue([hit(1), hit(2)]);
    const h = renderHook('réunion');
    await flush();
    expect(h.current.active).toBe(true);
    expect(h.current.hits).toHaveLength(2);
    expect(h.current.interp.length).toBeGreaterThan(0);
    expect(h.current.truncated).toBe(false);
    expect(h.current.zeroHint).toBe('');
    // The +1 probe: one extra row is requested to detect overflow.
    expect(mockSearch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({limit: SEARCH_LIMIT + 1}),
    );
  });

  it('caps at SEARCH_LIMIT and flags the truncation', async () => {
    mockSearch.mockReturnValue(
      Array.from({length: SEARCH_LIMIT + 1}, (_, i) => hit(i)),
    );
    const h = renderHook('beaucoup');
    await flush();
    expect(h.current.hits).toHaveLength(SEARCH_LIMIT);
    expect(h.current.truncated).toBe(true);
  });

  it('explains an active zero-hit query (names searchable, unread text is not)', async () => {
    mockSearch.mockReturnValue([]);
    const h = renderHook('f:refl');
    await flush();
    expect(h.current.active).toBe(true);
    expect(h.current.zeroHint).toContain('document names');
  });

  it('debounceMs delays the run (config Library only — foreground timers)', async () => {
    jest.useFakeTimers();
    try {
      mockSearch.mockReturnValue([hit(1)]);
      const h = renderHook('note', 300);
      expect(mockSearch).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(300);
        await Promise.resolve();
      });
      expect(mockSearch).toHaveBeenCalledTimes(1);
      expect(h.current.hits).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
