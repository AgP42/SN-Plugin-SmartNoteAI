// matchedLowWords: the "N unsure words" label must count exactly what
// the underline matcher (MarkdownView, same WORD_SPLIT) will mark.

import {matchedLowWords} from './lowMatch';

describe('matchedLowWords', () => {
  it('counts only the low words still present in the vision text', () => {
    const text = 'La réunion PSM est reportée à lundi prochain.';
    // OCR flagged 4 words; the vision kept 2 of them verbatim.
    const low = ['réunion', 'PSM', 'reporte', 'lundy'];
    expect(matchedLowWords(text, low)).toEqual(['réunion', 'PSM']);
  });

  it('matches case-insensitively, the way the underline does', () => {
    expect(matchedLowWords('Voir le Backlog demain', ['backlog'])).toEqual([
      'backlog',
    ]);
  });

  it('whole tokens only — no substring matches', () => {
    // "port" must not match inside "reportée".
    expect(matchedLowWords('la réunion est reportée', ['port'])).toEqual([]);
  });

  it('deduplicates and keeps the stored order', () => {
    expect(
      matchedLowWords('un mot, un mot, un autre', ['mot', 'mot', 'autre']),
    ).toEqual(['mot', 'autre']);
  });

  it('empty inputs → empty result', () => {
    expect(matchedLowWords('', ['a'])).toEqual([]);
    expect(matchedLowWords('texte', [])).toEqual([]);
  });
});
