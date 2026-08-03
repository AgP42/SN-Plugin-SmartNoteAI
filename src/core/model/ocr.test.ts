import {
  buildOcrBody,
  parseOcrResponse,
  ocrPdf,
  mergeTables,
  ocrImageSmart,
} from './ocr';
import type {FetchFn} from './types';

const fakeFetch = (
  status: number,
  body: unknown,
): {fn: FetchFn; calls: Array<{url: string; body: string}>} => {
  const calls: Array<{url: string; body: string}> = [];
  const fn: FetchFn = async (url, init) => {
    calls.push({url, body: init.body ?? ''});
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  return {fn, calls};
};

describe('buildOcrBody', () => {
  it('wraps the PDF as a data document_url', () => {
    const b = buildOcrBody('QUJD') as {
      document: {type: string; document_url: string};
    };
    expect(b.document.type).toBe('document_url');
    expect(b.document.document_url).toBe('data:application/pdf;base64,QUJD');
  });
});

describe('parseOcrResponse', () => {
  it('extracts page indexes and strips image placeholders', () => {
    const pages = parseOcrResponse({
      pages: [
        {index: 0, markdown: 'Hello\n![img-0.jpeg](img-0.jpeg)\nWorld'},
        {index: 1, markdown: '![img-1.jpeg](img-1.jpeg)'},
        {index: 'x', markdown: 'dropped'},
      ],
    });
    expect(pages).toEqual([
      // no confidence data → 0 words (the diag field, 2026-07-19)
      {page: 0, text: 'Hello\nWorld', escalate: true, words: 0},
      {page: 1, text: '', escalate: true, words: 0},
    ]);
  });
  it('tolerates a malformed payload', () => {
    expect(parseOcrResponse(null)).toEqual([]);
    expect(parseOcrResponse({pages: 'no'})).toEqual([]);
  });
});

describe('ocrPdf', () => {
  it('POSTs the PDF and returns parsed pages', async () => {
    const {fn, calls} = fakeFetch(200, {
      pages: [{index: 0, markdown: 'Texte'}],
    });
    const r = await ocrPdf(fn, 'KEY', 'QUJD');
    expect(r).toEqual({
      ok: true,
      pages: [{page: 0, text: 'Texte', escalate: true, words: 0}],
    });
    expect(calls[0].url).toContain('/v1/ocr');
    expect(calls[0].body).toContain('mistral-ocr-latest');
  });
  it('surfaces HTTP failures as a reason, never throws', async () => {
    const {fn} = fakeFetch(401, {detail: 'Unauthorized'});
    const r = await ocrPdf(fn, 'BAD', 'QUJD');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('401');
    }
  });
});

describe('smart path helpers (v0.22.8)', () => {
  it('mergeTables replaces placeholders and appends leftovers', () => {
    const md = 'Intro\n[tbl-0.md](tbl-0.md)\nOutro';
    const out = mergeTables(md, [
      {id: 'tbl-0.md', content: '| a | b |'},
      {id: 'tbl-1.md', content: '| c |'},
    ]);
    expect(out).toContain('| a | b |');
    expect(out).not.toContain('[tbl-0.md]');
    expect(out.endsWith('| c |')).toBe(true);
  });

  it('ocrImageSmart: no words → escalate; healthy page → keep OCR markdown', async () => {
    const mk = (payload: unknown): FetchFn => async () => ({
      ok: true, status: 200, json: async () => payload, text: async () => '',
    });
    const drawing = await ocrImageSmart(
      mk({pages: [{index: 0, markdown: '![img-0.jpeg](img-0.jpeg)',
        confidence_scores: {word_confidence_scores: []}}]}),
      'K', 'IMG');
    expect(drawing.ok && drawing.escalate).toBe(true);

    const healthy = await ocrImageSmart(
      mk({pages: [{index: 0, markdown: 'Bonjour le monde',
        confidence_scores: {word_confidence_scores: [
          {text: 'Bonjour', confidence: 0.99},
          {text: ' le', confidence: 0.95},
          {text: ' monde', confidence: 0.97},
        ]}}]}),
      'K', 'IMG');
    expect(healthy.ok && !healthy.escalate && healthy.text === 'Bonjour le monde').toBe(true);
  });

  it('ocrImageSmart: >30% shaky words → escalate; page markdown is the text', async () => {
    const fn: FetchFn = async () => ({
      ok: true, status: 200,
      json: async () => ({
        pages: [{index: 0, markdown: 'Vrai texte',
          confidence_scores: {word_confidence_scores: [
            {text: 'a1', confidence: 0.5}, {text: 'a2', confidence: 0.6},
            {text: 'a3', confidence: 0.95},
          ]}}],
      }),
      text: async () => '',
    });
    const r = await ocrImageSmart(fn, 'K', 'IMG');
    expect(r.ok && r.escalate).toBe(true);
    if (r.ok) {
      expect(r.text).toBe('Vrai texte');
    }
  });
});
