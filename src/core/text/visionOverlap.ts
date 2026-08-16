// Anti-bleed writer gate (2026-08-16). The native page render is host-bound
// and INTERMITTENTLY returns another document's page (device evidence: two
// personal-PDF pages stored with work content during the 2026-07 bulk vision
// sessions, ~1% of cross-host renders). The vision model then transcribes the
// wrong image, and the wrong text is stored under the right (path, page) —
// undetectable downstream, sticky through the Redo hint.
//
// The one host-INDEPENDENT truth we hold for a PDF page is its /v1/ocr text
// (read from the file bytes, no render involved). Vision's task is to improve
// that same page's transcription, so its output must share vocabulary with
// the OCR text. A result that shares essentially NOTHING with a substantial
// OCR baseline can only mean the image was not this page — refuse the write.
//
// Deliberately conservative: it only ever REJECTS on near-zero overlap of a
// baseline with real signal (≥ MIN_BASELINE distinct long tokens). A short or
// garbage baseline judges nothing (returns true), so a decorative/photo page
// keeps its no-oracle status and vision output is never blocked by weak
// evidence. False rejection risk accepted: none identified — a transcription
// of the RIGHT page always carries the printed tokens the OCR saw.
const MIN_BASELINE = 15;
const MIN_SHARED = 3;
const MIN_RATIO = 0.05;

const tokensOf = (s: string): Set<string> =>
  new Set(
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 4),
  );

// true = the vision text plausibly describes the same page as the OCR text
// (or the baseline is too weak to judge). false = render mismatch: reject.
export const visionMatchesOcr = (
  ocrText: string,
  visionText: string,
): boolean => {
  const base = tokensOf(ocrText);
  if (base.size < MIN_BASELINE) {
    return true; // no oracle — never block on weak evidence
  }
  const seen = tokensOf(visionText);
  let shared = 0;
  for (const t of base) {
    if (seen.has(t)) {
      shared++;
    }
  }
  return shared >= Math.max(MIN_SHARED, Math.ceil(base.size * MIN_RATIO));
};
