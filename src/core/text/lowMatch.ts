// Which stored low-confidence words are actually FINDABLE in the final
// text (user decision 2026-07-19 evening): the low words come from the
// OCR pass, but the displayed text comes from the Vision pass — a word
// the vision rewrote can never be underlined, so the "N unsure words"
// label must count the SURVIVORS only (a word the vision kept unchanged
// is still unsure; a rewritten one was resolved). The tokenisation is
// shared with MarkdownView so the count always equals what gets
// underlined.

// One word = letters (accents included) then letters/digits/'/-.
// Capturing group: String.split keeps the words as the odd parts.
export const WORD_SPLIT = /([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9'’-]*)/;

// The low words (their `t` token) present in `text`, deduplicated the
// way the underline matcher sees them (case-insensitive).
export const matchedLowWords = (
  text: string,
  lowTokens: string[],
): string[] => {
  if (lowTokens.length === 0 || text.length === 0) {
    return [];
  }
  const present = new Set<string>();
  const parts = text.split(WORD_SPLIT);
  // Odd indexes are the captured words; even parts are separators.
  for (let i = 1; i < parts.length; i += 2) {
    present.add(parts[i].toLowerCase());
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of lowTokens) {
    const k = t.toLowerCase();
    if (!seen.has(k) && present.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  return out;
};
