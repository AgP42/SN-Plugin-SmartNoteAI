// The .note reading engine (SPEC-v0.20 §2.2): medium VISION transcribes
// one page image into text, steered by the user's "OCR persona" (their
// decipher-help glossary, injected as a plain system prompt). Chosen
// over mistral-ocr+annotations on ground-truth grades (6.4 vs ~5.5) and
// because a chat vision model also reads drawings — the OCR pipeline is
// structurally blind to them (measured 2026-07-11, docs/bench…).
//
// Pure module: builds the ChatRequest; the HTTP ride reuses sendChat.

import type {ChatRequest} from './types';
import {OCR_COST_CENTS} from './ocr';

// Pinned, NOT the analysis model, and PINNED to a dated snapshot on
// purpose: a '-latest' alias silently changed target under us mid-bench
// (2508 → 2604). v0.24 (bench 2026-07-12, author-corrected ground
// truth): ministral-14b ties medium in GLOBAL quality (85.7 vs 86.0)
// for ~8x less on the vision call, and it read the schema page best of
// all Mistral models. Used for escalation, Improve, Test, Pre-transcript
// and the Eco engine.
export const READER_MODEL = 'ministral-14b-2512';

// Per-page cost of the ministral vision call, in EURO cents. Official
// list price ministral-14b: 0.2$/M in+out ≈ 0.875 €/M — measured
// ~2.6k tokens in / ~150 out per page ≈ 0.05 c€.
export const READ_COST_CENTS = 0.05;

// The UI expresses reading cost as €/1000 PAGES (clearer than c€/page,
// user decision 2026-07-13) and batch totals in €.
export const eurosTotal = (pages: number, centsPerPage: number): string =>
  (Math.round(pages * centsPerPage) / 100).toFixed(2); // total in €

// Long handwritten pages need room; the key-file maxTokens targets chat
// answers and may be as low as 16. Never let it truncate a transcript.
// Raised from 2000 (device report 2026-08-12): a dense page came back CUT
// at the ceiling and the half-transcript was stored as final. The cap is
// not a cost — output tokens are billed as produced — so the only thing a
// higher ceiling buys is room for the pages that need it.
export const READER_MAX_TOKENS = 4000;

// Deterministic reflow of a transcript into full lines (2026-07-13): the
// prompt asks the model to reflow, but the OCR-annotation model is
// stochastic and sometimes keeps hand-wrap breaks (a "clean" page can
// still come back line-per-scribble). This guarantees it in code:
//   • blank lines separate paragraphs (kept);
//   • a line that STARTS a new structural item — bullet, checkbox,
//     number, heading, quote, table row — begins a new line;
//   • any other line is a page wrap → joined to the previous line
//     (de-hyphenated across the break).
// Applied to AI-produced transcripts before storing; NOT to hand edits.
const BULLET_LINE = /^\s*([-*•·+]|[✓☑☐✗]|\d+[.)]|#{1,6}\s|>\s|\|)/;
// A markdown horizontal rule (---, ***, ___ alone on its line). It must
// stay alone AND never absorb the next line: the model separates
// sections with '---', and the reflow used to glue the following
// sentence onto it — "--- une phrase" baked into the store (device
// report 2026-07-20).
const HR_LINE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE_LINE = /^\s*```/;
const FENCE_OPEN_TAGGED = /^\s*```(?:markdown|md)\s*$/i;
const FENCE_BARE = /^\s*```\s*$/;

// Mistral occasionally wraps the WHOLE transcript in a ```markdown fence
// (chat-style answer). Stored verbatim, the wrapper makes the entire
// page parse as ONE code block — raw markers on screen (device report
// 2026-07-20, "Supernote plugin dev" p.3). A tagged markdown/md wrapper
// around everything is always dropped; a bare ``` pair only when the
// inside holds no other fence AND clearly reads as markdown — a page
// that IS one code block must keep its fences.
export const stripWrappingFence = (text: string): string => {
  const lines = text.split('\n');
  let a = 0;
  while (a < lines.length && lines[a].trim() === '') a++;
  let b = lines.length - 1;
  while (b > a && lines[b].trim() === '') b--;
  if (b <= a || !FENCE_BARE.test(lines[b])) return text;
  const inner = lines.slice(a + 1, b);
  if (FENCE_OPEN_TAGGED.test(lines[a])) return inner.join('\n');
  if (
    FENCE_BARE.test(lines[a]) &&
    !inner.some(l => FENCE_LINE.test(l)) &&
    inner.some(l => BULLET_LINE.test(l) || HR_LINE.test(l))
  ) {
    return inner.join('\n');
  }
  return text;
};

// Prose-only reflow — the pre-fence-aware body of reflowTranscript.
const reflowProse = (text: string): string =>
  text
    .split(/\n\s*\n/)
    .map(para => {
      const lines = para
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);
      const out: string[] = [];
      for (const line of lines) {
        const prev = out.length > 0 ? out[out.length - 1] : null;
        if (
          out.length > 0 &&
          !BULLET_LINE.test(line) &&
          !HR_LINE.test(line) &&
          prev !== null &&
          !HR_LINE.test(prev)
        ) {
          out[out.length - 1] = prev.endsWith('-')
            ? prev.slice(0, -1) + line
            : `${prev} ${line}`;
        } else {
          out.push(line);
        }
      }
      return out.join('\n');
    })
    .filter(p => p.length > 0)
    .join('\n\n');

// Fenced code is VERBATIM — reflowing it glues its lines (and the
// closing fence) into prose, leaving the fence unclosed so the whole
// page renders as raw code. Split on fence lines: outside → reflowProse,
// inside (blank lines included) → untouched. An unclosed fence keeps
// the rest verbatim, matching the parser's contract.
export const reflowTranscript = (text: string): string => {
  const lines = stripWrappingFence(text).split('\n');
  const out: string[] = [];
  let buf: string[] = [];
  let inCode = false;
  const flush = (): void => {
    if (buf.length > 0) {
      const r = reflowProse(buf.join('\n'));
      if (r.length > 0) {
        out.push(r);
      }
      buf = [];
    }
  };
  for (const line of lines) {
    if (FENCE_LINE.test(line)) {
      if (!inCode) {
        flush();
      }
      out.push(line.trim());
      inCode = !inCode;
    } else if (inCode) {
      out.push(line);
    } else {
      buf.push(line);
    }
  }
  flush();
  return out.join('\n');
};

// v0.38: the system prompt is no longer a fixed hidden instruction + a
// glossary. It is assembled from the user-editable blocks in
// src/core/model/visionPrompt.ts and passed in here as `system`. These
// builders are dumb: they just wire the assembled prompt + image.

export const buildReaderRequest = (
  imageBase64: string,
  system: string,
): ChatRequest => ({
  system,
  turns: [{role: 'user', text: 'Transcribe this page.', images: [imageBase64]}],
  maxTokens: READER_MAX_TOKENS,
});

// ---- "Improve" tier: vision + image + previous transcript as hint ----
// The existing transcript rides as an explicitly imperfect hint (best
// measured pipeline on hard pages).

export const buildImproveRequest = (
  imageBase64: string,
  system: string,
  previousTranscript: string,
): ChatRequest => ({
  system,
  turns: [
    {
      role: 'user',
      text:
        'Transcribe this page. An earlier automatic transcript follows as ' +
        'a HINT, it is imperfect: trust the image wherever they disagree.\n' +
        '--- hint ---\n' +
        previousTranscript.trim(),
      images: [imageBase64],
    },
  ],
  maxTokens: READER_MAX_TOKENS,
});

// The full price of reading ONE page end to end (OCR 4 + the Ministral
// vision pass). Pre-reinstall audit #8: this sum was recomputed in five
// files; every estimate now imports the same constant.
export const FULL_PAGE_READ_CENTS = READ_COST_CENTS + OCR_COST_CENTS;
