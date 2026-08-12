// Correcting ONE occurrence of an unsure word (device report 2026-08-12:
// a word appearing twice on a page was corrected in the wrong place, and
// the untouched twin silently stopped being flagged).
//
// Pure, so the rule can be tested without a screen: the caller supplies
// which occurrence was tapped, in document order.

const escape = (w: string): string => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A word boundary that understands accents — \b would cut "réunion" in two.
const wordRe = (word: string, global: boolean): RegExp =>
  new RegExp(
    `(^|[^A-Za-zÀ-ÖØ-öø-ÿ0-9])(${escape(word)})(?![A-Za-zÀ-ÖØ-öø-ÿ0-9])`,
    global ? 'g' : undefined,
  );

export const replaceNthWord = (
  text: string,
  word: string,
  nth: number,
  replacement: string,
): string => {
  let seen = 0;
  return text.replace(wordRe(word, true), (m, p1: string) =>
    seen++ === nth ? p1 + replacement : m,
  );
};

export const containsWord = (text: string, word: string): boolean =>
  wordRe(word, false).test(text);

// The low-confidence list is keyed by WORD, not by occurrence: a word may
// only leave it once none of its occurrences is left.
export const lowAfterFix = <T extends {t: string}>(
  low: readonly T[],
  word: string,
  textAfterFix: string,
): T[] =>
  containsWord(textAfterFix, word)
    ? [...low]
    : low.filter(w => w.t.toLowerCase() !== word.toLowerCase());
