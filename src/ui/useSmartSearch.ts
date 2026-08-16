// useSmartSearch (v0.54) — the query → hits logic shared by the config
// Library field (SearchControls) and the floating panel's armed-search
// overlay (SearchOverlay). One SMART grammar, one truncation rule.
//
// In-memory over the local store, re-run on every keystroke ON PURPOSE:
// no debounce timer — RN pauses JS timers while the host activity is
// backgrounded (the floating-panel situation; v0.25.4 & v0.53 heartbeat
// findings), so a setTimeout-debounced search would simply never fire.

import {useEffect, useRef, useState} from 'react';
import {loadStore} from '../native/transcriptStoreIo';
import {
  searchLibraryAdvanced,
  type SearchHit,
} from '../core/store/librarySearch';
import {parseSmartQuery} from '../core/store/smartQuery';

// Hits are capped; one extra row is requested so we can tell "exactly
// the cap" from "more than the cap" and warn.
export const SEARCH_LIMIT = 60;

// The one-line grammar cheat-sheet under the field (user request).
export const GRAMMAR_HINT =
  'word · "phrase" · a|b · !not · f:folder · n:note · p:8 · approx:word · ' +
  'kw:tag · star: · type:note|pdf · src:manual|ai · after:2026-06 · sort:date';

export type SmartSearchState = {
  hits: SearchHit[];
  active: boolean; // a real query is running (≥2 chars, ≥1 criterion)
  interp: string; // the interpretation echo ('' when inactive)
  truncated: boolean;
  // v0.65.1 (user: "f:refl → aucun résultat" on a never-synced folder):
  // an ACTIVE query with zero hits explains WHY instead of a silent
  // void — the search only covers TRANSCRIBED pages.
  zeroHint: string;
};

// `debounceMs` (perf audit 2026-07-20) is for the CONFIG Library only —
// its activity is foreground, so timers run. The floating-panel overlay
// must keep 0 (the file-top comment: frozen timers would never fire).
export const useSmartSearch = (
  query: string,
  debounceMs = 0,
): SmartSearchState => {
  const [state, setState] = useState<SmartSearchState>({
    hits: [],
    active: false,
    interp: '',
    truncated: false,
    zeroHint: '',
  });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = (): void => {
      if (cancelled) {
        return;
      }
      runSearch();
    };
    const timer = debounceMs > 0 ? setTimeout(run, debounceMs) : null;
    if (timer === null) {
      run();
    }
    function runSearch(): void {
      const parsed = parseSmartQuery(query);
      const active = query.trim().length >= 2 && parsed.criteria.length > 0;
      const hitsP = active
        ? loadStore().then(s =>
            searchLibraryAdvanced(s, parsed.criteria, {
              sort: parsed.sort ?? 'relevance',
              limit: SEARCH_LIMIT + 1,
            }),
          )
        : Promise.resolve([] as SearchHit[]);
      hitsP.then(hits => {
        if (!mounted.current || cancelled) {
          return;
        }
        const over = hits.length > SEARCH_LIMIT;
        setState({
          hits: over ? hits.slice(0, SEARCH_LIMIT) : hits,
          active,
          interp: active ? parsed.interpretation : '',
          truncated: active && over,
          zeroHint:
            active && hits.length === 0
              ? 'No match. Bare words search your transcripts AND document ' +
                "names; a page's text is searchable once the AI has read " +
                'it. To make a note readable, set it to Manual/Auto and Sync.'
              : '',
        });
      });
    }
    return () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [query, debounceMs]);

  return state;
};
