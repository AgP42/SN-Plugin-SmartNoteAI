// Bold the query terms inside a search-hit snippet (accent-insensitive).
// Pure — moved out of SearchControls (UI refactor Lot 2, 2026-08-03) so
// row components can import it without dragging the search state chain.
import React from 'react';
import {Text} from 'react-native';

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
