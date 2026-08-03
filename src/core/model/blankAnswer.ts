// Collecte 1.0.4 sujet ①: vision models sometimes ANSWER a blank page
// with a sentence — "The page is blank." — which then got stored as a
// real transcript (source Mistral OCR+Vision, user report 2026-08-03).
// This detects an answer whose ENTIRE content is such a statement, so
// the read pipeline can route it to the empty negative-cache instead.
// Deliberately strict: the whole trimmed text must be the statement
// (plus punctuation) — a page that truly *says* "the page is blank"
// inside longer content is never eaten.
const BLANK_RE =
  /^\W*(?:(?:the|this)\s+page\s+(?:is|appears(?:\s+to\s+be)?)\s+(?:blank|empty)|(?:blank|empty)\s+page|no\s+(?:text|content|writing)\s+(?:on\s+(?:the|this)\s+page|visible|found|detected)|(?:la\s+)?page\s+(?:est\s+)?(?:vide|blanche))\W*$/i;

export const isBlankAnswer = (text: string): boolean => {
  const t = text.trim();
  return t.length > 0 && t.length <= 120 && BLANK_RE.test(t);
};
