// Correcting ONE occurrence of an unsure word (device report 2026-08-12:
// a word appearing twice on a page was corrected in the wrong place, and
// the untouched twin silently stopped being flagged).
//
// Pure, so the rule can be tested without a screen: the caller supplies
// which occurrence was tapped, in document order.
import {isSeparatorRow, RE_FENCE, RE_FENCE_END} from './markdown';

const escape = (w: string): string => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A word boundary that understands accents — \b would cut "réunion" in two.
// Case-INSENSITIVE on purpose (audit 2026-08-12): MarkdownView keys and
// counts the tappable occurrences on the lower-cased word, so the ordinal it
// hands us is a case-insensitive index. Recounting here case-sensitively made
// the two bases disagree the moment the same flagged word appeared in mixed
// case ("Unsure" at a sentence start, "unsure" mid-line).
//
// The boundary alphabet MUST match MarkdownView's WORD_SPLIT (lowMatch.ts),
// which treats apostrophe (' ’) and hyphen (-) as WORD characters — so
// "après-midi" and "l'heure" are single tokens (re-audit 2026-08-12). Without
// them here, "midi" matched INSIDE "après-midi" and the tap ordinal desynced,
// corrupting an untouched compound — very common in French elisions/compounds.
const BOUND = `A-Za-zÀ-ÖØ-öø-ÿ0-9'’-`;
const wordRe = (word: string, global: boolean): RegExp =>
  new RegExp(
    `(^|[^${BOUND}])(${escape(word)})(?![${BOUND}])`,
    global ? 'gi' : 'i',
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

// Same-LENGTH mask (2026-08-12, K3): replace every character inside a fenced
// code block, a markdown table (header + separator + rows) or an inline-code
// span with a space, keeping newlines and total length intact — so a character
// offset into the mask is also a valid offset into the original text. These are
// exactly the regions MarkdownView does NOT render as tappable low-words, so a
// word matched over the mask lines up 1:1 with the occurrences the user can tap.
const maskUncountable = (text: string): string => {
  const blank = (s: string): string => ' '.repeat(s.length);
  const lines = text.split('\n');
  const out = [...lines];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    // Fence handling EXACTLY as the parser (markdown.ts): open on RE_FENCE.
    if (!inFence && RE_FENCE.test(lines[i])) {
      const open = (lines[i].match(/^\s*```/) as RegExpMatchArray)[0];
      const after = lines[i].slice(open.length);
      const close = after.indexOf('```');
      if (close >= 0) {
        // One-line ```…``` : the parser renders the fenced text as inline code
        // and the TRAILING prose as a tappable paragraph. Mask only through the
        // closing ```, keep the rest countable, and do NOT open a block.
        const end = open.length + close + 3;
        out[i] = blank(lines[i].slice(0, end)) + lines[i].slice(end);
        continue;
      }
      out[i] = blank(lines[i]);
      inFence = true; // block fence: closes only on a bare RE_FENCE_END below
      continue;
    }
    if (inFence) {
      out[i] = blank(lines[i]);
      if (RE_FENCE_END.test(lines[i])) {
        inFence = false;
      }
      continue;
    }
    // A table: a pipe row immediately followed by a separator (parser's rule).
    if (
      lines[i].includes('|') &&
      i + 1 < lines.length &&
      isSeparatorRow(lines[i + 1])
    ) {
      out[i] = blank(lines[i]); // header
      out[i + 1] = blank(lines[i + 1]); // separator
      let j = i + 2;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim() !== '') {
        out[j] = blank(lines[j]);
        j++;
      }
      i = j - 1;
    }
  }
  // Inline code spans (`…`) on whatever survived the block masking above.
  return out.join('\n').replace(/`[^`\n]*`/g, m => blank(m));
};

// Character offsets of every tappable occurrence of `word`, in document order —
// the SAME set (and order) MarkdownView makes tappable, so the tap ordinal
// (nth) indexes straight into this list. A word that also appears in a table
// cell or a code span is skipped here exactly as it is skipped on screen.
export const wordOffsets = (text: string, word: string): number[] => {
  const masked = maskUncountable(text);
  const re = wordRe(word, true);
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    out.push(m.index + m[1].length); // skip the leading boundary char
  }
  return out;
};

// Replace the occurrence at an EXACT offset (from wordOffsets). Guarded: it only
// rewrites when the word really sits there, so a stale offset is a safe no-op —
// it can never corrupt arbitrary text (K3 replaced by-count on RAW markdown and
// hit a table cell the user never touched).
export const replaceAtOffset = (
  text: string,
  offset: number,
  word: string,
  replacement: string,
): string => {
  if (offset < 0 || offset + word.length > text.length) {
    return text;
  }
  if (text.slice(offset, offset + word.length).toLowerCase() !== word.toLowerCase()) {
    return text;
  }
  return text.slice(0, offset) + replacement + text.slice(offset + word.length);
};

// The low-confidence list is keyed by WORD, not by occurrence: a word may only
// leave it once none of its TAPPABLE occurrences is left (a leftover in a table
// cell is not shown as unsure, so it must not keep the chip alive).
export const lowAfterFix = <T extends {t: string}>(
  low: readonly T[],
  word: string,
  textAfterFix: string,
): T[] =>
  wordOffsets(textAfterFix, word).length > 0
    ? [...low]
    : low.filter(w => w.t.toLowerCase() !== word.toLowerCase());
