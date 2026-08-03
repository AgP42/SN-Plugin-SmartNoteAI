/**
 * SearchControls — the SMART search field of the config Library. One
 * field, one grammar (src/core/store/smartQuery.ts); it emits the
 * resolved SearchHit[] to the parent, which renders the results however
 * it likes. The query → hits logic lives in the shared useSmartSearch
 * hook (v0.54) — the floating panel's armed search uses the same one.
 *
 * v0.37.1: the old Base/Advanced toggle and the criteria-row builder are
 * gone (user decision) — the grammar covers everything they did. Under
 * the field: a static grammar hint, then the interpretation echo of the
 * current query, then the truncation warning when the cap is hit.
 *
 * All in-memory over the local store — no network, no cost.
 */
import React, {useEffect, useState} from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  GRAMMAR_HINT,
  SEARCH_LIMIT,
  useSmartSearch,
} from './src/ui/useSmartSearch';
import {type SearchHit} from './src/core/store/librarySearch';

type Props = {
  scale: number;
  onResults: (hits: SearchHit[], active: boolean) => void;
};

// Bold every token of `snippet` that matches one of the highlight terms
// (accent/case-insensitive; phrases are matched word-by-word).
const deacc = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function highlightSnippet(
  snippet: string,
  terms: string[],
  boldStyle: object,
): React.ReactNode {
  const words = new Set(
    terms.flatMap(t => deacc(t).split(/\s+/)).filter(w => w.length >= 2),
  );
  if (words.size === 0) {
    return snippet;
  }
  // Split keeping the separators so spacing/punctuation is preserved.
  // wordList hoisted out of the token loop (perf audit 2026-07-20): the
  // [...words] spread ran per token × per hit row × per re-render.
  const wordList = [...words];
  const parts = snippet.split(/(\s+)/);
  return parts.map((tok, i) => {
    const bare = deacc(tok.replace(/[^\p{L}\p{N}]/gu, ''));
    const hit = bare.length >= 2 && wordList.some(w => bare.includes(w));
    return hit ? (
      <Text key={i} style={boldStyle}>
        {tok}
      </Text>
    ) : (
      tok
    );
  });
}

export default function SearchControls({scale, onResults}: Props): React.JSX.Element {
  const [query, setQuery] = useState('');
  const {hits, active, interp, truncated} = useSmartSearch(query, 150);

  // Relay to the parent (LibraryScreen renders the results itself).
  useEffect(() => {
    onResults(hits, active);
    // onResults is stable enough in practice; deps cover every result set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, active]);

  const fs = {fontSize: 14 * scale};
  const sm = {fontSize: 12 * scale};
  const xs = {fontSize: 10.5 * scale};

  return (
    <View>
      <View style={styles.baseRow}>
        <TextInput
          style={[styles.input, styles.baseInput, fs]}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="🔍 Search every transcript…"
        />
        {query.length > 0 ? (
          <TouchableOpacity
            onPress={() => setQuery('')}
            style={styles.clearBtn}
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <Text style={[styles.clearText, sm]}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={[styles.hint, xs]} numberOfLines={2}>
        {GRAMMAR_HINT}
      </Text>
      {interp.length > 0 ? (
        <Text style={[styles.interp, sm]} numberOfLines={2}>
          → {interp}
        </Text>
      ) : null}
      {truncated ? (
        <Text style={[styles.warn, sm]}>
          ⚠ Showing the first {SEARCH_LIMIT} matches only. Refine your query
          to see the rest.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#000000',
  },
  baseRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  baseInput: {flex: 1},
  clearBtn: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  clearText: {color: '#000000', fontWeight: '700'},
  hint: {color: '#000000', opacity: 0.55, marginTop: 4},
  interp: {color: '#000000', opacity: 0.75, marginTop: 4},
  warn: {color: '#000000', fontWeight: '700', marginTop: 6},
});
