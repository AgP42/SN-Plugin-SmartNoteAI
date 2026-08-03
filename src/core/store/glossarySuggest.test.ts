import {emptyStore, upsertPage, type PageEntry} from './transcriptStore';
import {suggestGlossaryWords} from './glossarySuggest';

const entry = (text: string, over: Partial<PageEntry> = {}): PageEntry => ({
  text,
  source: 'mistral-ocr',
  at: 1000,
  hash: '',
  ...over,
});

describe('suggestGlossaryWords', () => {
  it('surfaces recurring low-confidence words, ranked by count', () => {
    const s = emptyStore();
    upsertPage(
      s,
      '/a.note',
      0,
      entry('meeting notes', {
        low: [
          {t: 'Solveig', c: 0.5},
          {t: 'CAGR', c: 0.6},
        ],
      }),
      1,
    );
    upsertPage(
      s,
      '/a.note',
      1,
      entry('more notes', {
        low: [
          {t: 'Solveig', c: 0.55},
          {t: 'Solveig', c: 0.7},
          {t: 'CAGR', c: 0.65},
          {t: 'once', c: 0.4}, // appears once → below the min count
        ],
      }),
      1,
    );
    const r = suggestGlossaryWords(s, '');
    expect(r.unsure).toEqual(['Solveig', 'CAGR']);
  });

  it('surfaces recurring proper nouns from the texts', () => {
    const s = emptyStore();
    const text =
      'Met Ramirez at the apiary. Ramirez suggested a nuc box. ' +
      'Call Ramirez on Monday about the Beeport order. Beeport again, ' +
      'and Beeport delivery. The weather was fine.';
    upsertPage(s, '/a.note', 0, entry(text), 1);
    const r = suggestGlossaryWords(s, '');
    expect(r.frequent).toEqual(['Ramirez', 'Beeport']);
  });

  it('excludes words already in the glossary and stopwords', () => {
    const s = emptyStore();
    upsertPage(
      s,
      '/a.note',
      0,
      entry('Ramirez Ramirez Ramirez. The The The.', {
        low: [
          {t: 'Solveig', c: 0.5},
          {t: 'Solveig', c: 0.5},
        ],
      }),
      1,
    );
    const r = suggestGlossaryWords(s, 'People: Solveig, Ramirez.');
    expect(r.unsure).toEqual([]);
    expect(r.frequent).toEqual([]);
  });

  it('does not repeat an unsure word in the frequent list', () => {
    const s = emptyStore();
    upsertPage(
      s,
      '/a.note',
      0,
      entry('Beeport Beeport Beeport rocks', {
        low: [
          {t: 'Beeport', c: 0.5},
          {t: 'Beeport', c: 0.6},
        ],
      }),
      1,
    );
    const r = suggestGlossaryWords(s, '');
    expect(r.unsure).toEqual(['Beeport']);
    expect(r.frequent).toEqual([]);
  });
});
