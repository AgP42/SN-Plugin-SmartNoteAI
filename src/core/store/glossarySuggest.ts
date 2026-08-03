// Glossary suggestions (v0.23, IDEAS §2): mine the library for words
// worth adding to the user's glossary. Two signals, zero AI cost:
//   • "unsure": words the OCR repeatedly flagged with low confidence
//     (stored per page since v0.23) — adding them to the glossary is
//     exactly what fixes them on future reads.
//   • "frequent": recurring capitalised words (people, places, product
//     names — the hardest thing for any OCR), counted across all texts.
// Pure module: store in, ranked words out.

import type {Store} from './transcriptStore';

// Tiny bilingual stopword net — just enough to keep "The"/"Les" out of
// the proper-noun list; the capitalisation + frequency filters do the
// real work.
const STOP = new Set(
  (
    'the this that with from have been will would could them then they ' +
    'when what where which there their about into over under after ' +
    'before between during your yours mine notre votre leur cette ces ' +
    'dans pour avec sans sous chez elle elles nous vous ils sont était ' +
    'être avoir fait plus moins très bien tout tous toute toutes une des ' +
    'les mais donc car ainsi alors comme aussi cela ceci celui celle ' +
    'monday tuesday wednesday thursday friday saturday sunday january ' +
    'february march april may june july august september october ' +
    'november december lundi mardi mercredi jeudi vendredi samedi ' +
    'dimanche janvier février mars avril juin juillet août septembre ' +
    'octobre novembre décembre'
  ).split(/\s+/),
);

const WORD_RE = /[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9'’-]{2,}/g;

const cleanWord = (w: string): string => w.replace(/["'’.,;:!?()[\]]+$/g, '');

export type GlossarySuggestions = {
  unsure: string[]; // recurring low-confidence words
  frequent: string[]; // recurring capitalised words (proper nouns)
};

export const suggestGlossaryWords = (
  store: Store,
  glossary: string,
  limit: number = 10,
): GlossarySuggestions => {
  const inGlossary = new Set(
    (glossary.toLowerCase().match(WORD_RE) ?? []).map(w => w.toLowerCase()),
  );
  const skip = (lower: string): boolean =>
    lower.length < 3 || STOP.has(lower) || inGlossary.has(lower);

  // Signal 1: low-confidence words, counted across every page.
  const unsureCount = new Map<string, {word: string; n: number}>();
  // Signal 2: capitalised words in the transcripts.
  const capsCount = new Map<string, {word: string; n: number}>();

  for (const doc of Object.values(store.docs)) {
    for (const page of Object.values(doc.pages)) {
      for (const lw of page.low ?? []) {
        const word = cleanWord(lw.t);
        const lower = word.toLowerCase();
        if (word.length === 0 || skip(lower) || !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(word)) {
          continue;
        }
        const cur = unsureCount.get(lower);
        unsureCount.set(lower, {word: cur?.word ?? word, n: (cur?.n ?? 0) + 1});
      }
      for (const raw of page.text.match(WORD_RE) ?? []) {
        const word = cleanWord(raw);
        // Proper-noun shape only: leading capital, not ALL-CAPS shouting.
        if (!/^[A-ZÀ-Ö]/.test(word) || word === word.toUpperCase()) {
          continue;
        }
        const lower = word.toLowerCase();
        if (skip(lower)) {
          continue;
        }
        const cur = capsCount.get(lower);
        capsCount.set(lower, {word: cur?.word ?? word, n: (cur?.n ?? 0) + 1});
      }
    }
  }

  const top = (
    m: Map<string, {word: string; n: number}>,
    minCount: number,
  ): string[] =>
    Array.from(m.values())
      .filter(e => e.n >= minCount)
      .sort((a, b) => b.n - a.n)
      .slice(0, limit)
      .map(e => e.word);

  const unsure = top(unsureCount, 2);
  const unsureSet = new Set(unsure.map(w => w.toLowerCase()));
  // Proper nouns need to actually recur to be worth glossary space.
  const frequent = top(capsCount, 3).filter(
    w => !unsureSet.has(w.toLowerCase()),
  );
  return {unsure, frequent};
};
