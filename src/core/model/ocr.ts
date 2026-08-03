// Mistral OCR 4 client (SPEC §2.2) — the READ engine for PDFs and the
// SMART .note base path: BARE OCR for every page (no annotation stage —
// dropped v0.31.0, 2026-07-15: the Document-AI annotation is a structured-
// extraction layer that JSON-ifies the transcript for net-zero gain; the
// glossary rides on the vision escalation instead). Pages the OCR is
// UNSURE about are flagged for automatic escalation to the vision model —
// no user knob, it just happens. The bare page markdown is the transcript
// (docs: "the main output"); reflow into prose is done downstream by
// reflowTranscript(), deterministically.
//
// Escalation signal (measured 2026-07-12 on ground-truth pages): the
// per-PAGE confidence is useless (0.92 on a page transcribed empty!),
// but per-WORD confidence is well calibrated. Rule:
//   zero words extracted (drawings / schemas)  → escalate
//   > ESCALATE_PCT of words below 0.8          → escalate (messy pages)
// Both signals come FREE in the same call (confidence_scores_granularity).
//
// Billing (console-verified): bare OCR 3.5 €/1000 pages.
//
// Pure module like mistral.ts: fetch is injected, tested with a fake.

import type {FetchFn} from './types';
import {mistralRequest} from './http';

export const OCR_MODEL = 'mistral-ocr-latest';

// EURO cents per page (official list 2026-07-11: 3.5 €/1000).
export const OCR_COST_CENTS = 0.35;

// Escalate when more than this share of words sits below 0.8 confidence.
// v0.38.1: lowered 30 → 15 (user decision). This now only gates the PDF
// path — .note pages ALWAYS escalate to Vision (v0.38), so the flag is
// unused there. 15% catches borderline handwritten/annotated PDF pages
// (a printed page still sits well under it and stays OCR-only, cheap).
export const ESCALATE_PCT = 15;

/* ---------------- shared parsing helpers ---------------- */

type RawTable = {id?: unknown; content?: unknown};
type RawPage = {
  index?: unknown;
  markdown?: unknown;
  tables?: RawTable[];
  confidence_scores?: {
    word_confidence_scores?: Array<{text?: unknown; confidence?: unknown}>;
  } | null;
};

// The markdown references extracted tables as [tbl-0.md](tbl-0.md)
// placeholders; the actual content sits in pages[].tables — merge it
// back (the user's handwritten grade table came out near-perfect there
// while the markdown alone would have dropped it).
export const mergeTables = (markdown: string, tables?: RawTable[]): string => {
  let out = markdown;
  const leftovers: string[] = [];
  for (const t of tables ?? []) {
    const id = typeof t.id === 'string' ? t.id : '';
    const content = typeof t.content === 'string' ? t.content : '';
    if (content.length === 0) {
      continue;
    }
    const placeholder = `[${id}](${id})`;
    if (id.length > 0 && out.includes(placeholder)) {
      out = out.replace(placeholder, content);
    } else {
      leftovers.push(content);
    }
  }
  return [out, ...leftovers].join('\n\n').trim();
};

// Drop image placeholders (![img-0.jpeg](img-0.jpeg)) — no text in them.
const cleanMarkdown = (md: string): string =>
  md
    .split('\n')
    .filter(line => !/^!\[[^\]]*\]\([^)]*\)\s*$/.test(line.trim()))
    .join('\n')
    .trim();

// Low-confidence words kept per page (v0.23): they feed the transcript
// highlighting and the glossary suggestions. Capped — a fully messy page
// escalates to vision anyway.
export const MAX_LOW_WORDS = 60;

export type LowWordScore = {t: string; c: number};

// THE escalation rule, in one place (it was written twice — audit
// 2026-07-20): no word scores at all, or too many low-confidence ones.
const shouldEscalate = (stats: {
  words: number;
  pctLow: number | null;
}): boolean =>
  stats.words === 0 || (stats.pctLow !== null && stats.pctLow > ESCALATE_PCT);

const wordStats = (
  page: RawPage,
): {words: number; pctLow: number | null; lowWords: LowWordScore[]} => {
  const raw = page.confidence_scores?.word_confidence_scores ?? [];
  const words = raw.filter(
    w =>
      typeof w.text === 'string' &&
      w.text.trim().length > 0 &&
      !['#', '-', ':', '!', '?', '.', ','].includes(w.text.trim()),
  );
  if (words.length === 0) {
    return {words: 0, pctLow: null, lowWords: []};
  }
  const low = words.filter(w => Number(w.confidence) < 0.8);
  return {
    words: words.length,
    pctLow: (low.length / words.length) * 100,
    lowWords: low
      .slice(0, MAX_LOW_WORDS)
      .map(w => ({
        t: String(w.text).trim(),
        c: Math.round(Number(w.confidence) * 100) / 100,
      })),
  };
};

export const parseOcrResponse = (data: unknown): OcrPage[] => {
  const pages = (data as {pages?: unknown})?.pages;
  if (!Array.isArray(pages)) {
    return [];
  }
  const out: OcrPage[] = [];
  for (const raw of pages as RawPage[]) {
    if (typeof raw?.index === 'number' && typeof raw?.markdown === 'string') {
      const stats = wordStats(raw);
      out.push({
        page: raw.index,
        text: mergeTables(cleanMarkdown(raw.markdown), raw.tables),
        escalate: shouldEscalate(stats),
        low: stats.lowWords.length > 0 ? stats.lowWords : undefined,
        // Diag 2026-07-19 (vanished underlines): how many word scores
        // the API actually returned — 0 with text present means the
        // optional confidence_scores field is ABSENT from the response.
        words: stats.words,
      });
    }
  }
  return out;
};

export type OcrPage = {
  page: number;
  text: string;
  escalate?: boolean;
  low?: LowWordScore[];
  // Word-confidence scores the API returned for this page (diag
  // 2026-07-19): 0 + non-empty text ⇒ the field is absent server-side.
  words?: number;
};

export type OcrResult =
  | {ok: true; pages: OcrPage[]}
  | {ok: false; reason: string};

/* ---------------- HTTP (shared transport, http.ts) ---------------- */

const post = (
  fetchFn: FetchFn,
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ok: true; data: unknown} | {ok: false; reason: string}> =>
  mistralRequest(fetchFn, apiKey, '/v1/ocr', {
    body,
    signal,
    abortReason: 'OCR cancelled.',
  });

/* ---------------- PDF path ---------------- */

export const buildOcrBody = (pdfBase64: string): Record<string, unknown> => ({
  model: OCR_MODEL,
  document: {
    type: 'document_url',
    document_url: `data:application/pdf;base64,${pdfBase64}`,
  },
  table_format: 'markdown',
  // Same escalation signals as .note pages (user decision 2026-07-12:
  // "même comportement" — PDFs carry photos and figures too).
  confidence_scores_granularity: 'word',
});

export const ocrPdf = async (
  fetchFn: FetchFn,
  apiKey: string,
  pdfBase64: string,
  signal?: AbortSignal,
): Promise<OcrResult> => {
  const r = await post(fetchFn, apiKey, buildOcrBody(pdfBase64), signal);
  return r.ok
    ? {ok: true, pages: parseOcrResponse(r.data)}
    : {ok: false, reason: r.reason};
};

/* ---------------- smart .note path (Smart engine) ---------------- */

// Bare OCR on a single page image (Smart .note base). No annotation stage
// (dropped 2026-07-15: the Document-AI annotation is a structured-extraction
// layer that JSON-ifies the transcript for net-zero gain — see the reading
// bench). Word confidence still rides along to drive the vision escalation.
export const buildSmartBody = (
  imageBase64: string,
): Record<string, unknown> => ({
  model: OCR_MODEL,
  document: {
    type: 'image_url',
    image_url: `data:image/png;base64,${imageBase64}`,
  },
  table_format: 'markdown',
  confidence_scores_granularity: 'word',
});

export type SmartOcrResult =
  | {
      ok: true;
      text: string;
      escalate: boolean;
      words: number;
      pctLow: number | null;
      lowWords: LowWordScore[];
    }
  | {ok: false; reason: string};

export const ocrImageSmart = async (
  fetchFn: FetchFn,
  apiKey: string,
  imageBase64: string,
  signal?: AbortSignal,
): Promise<SmartOcrResult> => {
  const r = await post(fetchFn, apiKey, buildSmartBody(imageBase64), signal);
  if (!r.ok) {
    return r;
  }
  const data = r.data as {pages?: RawPage[]};
  const page0 = (data.pages ?? [])[0] ?? {};
  const stats = wordStats(page0);
  // Bare OCR: the page markdown IS the transcription (docs: "the main
  // output"). The glossary rides on the vision escalation, not here — the
  // annotation stage was dropped 2026-07-15 (JSON-prone, net-zero gain).
  const text = mergeTables(cleanMarkdown(String(page0.markdown ?? '')), page0.tables);
  const escalate =
    shouldEscalate(stats);
  return {
    ok: true,
    text,
    escalate,
    words: stats.words,
    pctLow: stats.pctLow,
    lowWords: stats.lowWords,
  };
};
