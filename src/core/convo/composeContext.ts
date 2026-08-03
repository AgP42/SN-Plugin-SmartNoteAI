// Multi-page context: which pages a mode selects, and how their
// transcriptions are folded into the user message. Pure + testable —
// the store-backed gathering lives in src/native/reading.ts.

export type ContextMode = 'page' | 'range' | 'note';

export type PageText = {page: number; text: string};

// 0-INDEXED page indices a mode selects, clamped to [0, total-1] — this
// matches the SDK (getCurrentPageNum / getElements / generateNotePng are
// all 0-indexed). The 1-indexed page numbers the user sees/enters are
// converted at the UI boundary. `current` is the 0-indexed current page,
// `total` is the page COUNT, `range` is 0-indexed.
export const pagesForContext = (
  mode: ContextMode,
  current: number,
  total: number,
  range: {start: number; end: number},
): number[] => {
  const maxIdx = Math.max(0, total - 1);
  const clamp = (n: number): number =>
    Math.min(Math.max(0, Math.round(n)), maxIdx);
  if (mode === 'page') {
    return [clamp(current)];
  }
  let a = 0;
  let b = maxIdx;
  if (mode === 'range') {
    a = clamp(range.start);
    b = clamp(range.end);
    if (a > b) {
      const t = a;
      a = b;
      b = t;
    }
  }
  const out: number[] = [];
  for (let p = a; p <= b; p++) {
    out.push(p);
  }
  return out;
};

// The user message: the question, then each page's transcription under a
// labelled header. `page` is 0-indexed; the label shows the human
// 1-indexed number. Pages with no text are dropped; if nothing has text,
// the bare question is returned (the image still carries the page).
// `noteName` labels each header with the source note (see compose.ts) —
// headers must keep the '--- Page' prefix (UI strip marker).
export const composePagesText = (
  input: string,
  pages: PageText[],
  noteName?: string,
): string => {
  const withText = pages.filter(p => p.text.trim().length > 0);
  if (withText.length === 0) {
    return input;
  }
  const of = noteName && noteName.length > 0 ? ` of "${noteName}"` : '';
  const blocks = withText
    .map(p => `--- Page ${p.page + 1}${of} (transcribed) ---\n${p.text.trim()}`)
    .join('\n\n');
  return `${input}\n\n${blocks}`;
};
