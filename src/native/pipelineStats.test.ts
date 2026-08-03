// The SYNC STATUS bridge: store singleton → pure classifier. Pins the
// glue this module owns — the oldest "OCR done, Vision to retry"
// timestamp and the v0.86 note/PDF split — with the classifier mocked
// (it has its own suite in core).

const mockLoadStore = jest.fn();
jest.mock('./transcriptStoreIo', () => ({
  loadStore: () => mockLoadStore(),
}));

const mockClassify = jest.fn();
jest.mock('../core/store/pipeline', () => ({
  classifyPipeline: (...a: unknown[]) => mockClassify(...a),
}));

import {pipelineFromStore, pipelineFromStoreSplit} from './pipelineStats';
import type {TrackedTotal} from '../core/store/pipeline';

const STORE = {
  v: 1,
  docs: {
    '/n/a.note': {
      usedAt: 0,
      docHash: '',
      stars: [],
      kws: [],
      pages: {
        '0': {text: 'ocr un', source: 'mistral-ocr', at: 500, hash: 'h'},
        '1': {text: 'ocr deux', source: 'mistral-ocr', at: 200, hash: 'h'},
        '2': {text: 'vision', source: 'medium', at: 100, hash: 'h'},
        '3': {text: '   ', source: 'mistral-ocr', at: 50, hash: 'h'}, // blank
      },
    },
    '/d/b.pdf': {
      usedAt: 0,
      docHash: '',
      stars: [],
      kws: [],
      pages: {
        '0': {text: 'pdf ocr', source: 'mistral-ocr', at: 20, hash: 'h'},
      },
    },
  },
};

const tt = (isPdf: boolean): TrackedTotal => ({
  total: 4,
  isPdf,
  pdfCovered: isPdf,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadStore.mockResolvedValue(STORE);
  mockClassify.mockReturnValue({stage: 'sentinel'});
});

describe('pipelineFromStore', () => {
  it('returns the classifier result and the OLDEST non-blank OCR timestamp of tracked docs', async () => {
    const tracked = new Map([['/n/a.note', tt(false)]]);
    const r = await pipelineFromStore(tracked);
    expect(r.stages).toEqual({stage: 'sentinel'});
    expect(mockClassify).toHaveBeenCalledWith(STORE, tracked);
    // 200 (ocr deux) — the blank OCR page (at=50) and the vision page
    // (at=100) do not count.
    expect(r.oldestOcrDoneAt).toBe(200);
  });

  it('ignores untracked docs and reports 0 when nothing qualifies', async () => {
    const r = await pipelineFromStore(new Map([['/ghost.note', tt(false)]]));
    expect(r.oldestOcrDoneAt).toBe(0);
  });
});

describe('pipelineFromStoreSplit', () => {
  it('partitions the tracked map by isPdf and classifies each subset', async () => {
    mockClassify
      .mockReturnValueOnce({who: 'notes'})
      .mockReturnValueOnce({who: 'pdfs'});
    const note = tt(false);
    const pdf = tt(true);
    const r = await pipelineFromStoreSplit(
      new Map([
        ['/n/a.note', note],
        ['/d/b.pdf', pdf],
      ]),
    );
    expect(r).toEqual({notes: {who: 'notes'}, pdfs: {who: 'pdfs'}});
    // ONE store load, two classifier passes over the disjoint subsets.
    expect(mockLoadStore).toHaveBeenCalledTimes(1);
    expect(mockClassify).toHaveBeenNthCalledWith(
      1,
      STORE,
      new Map([['/n/a.note', note]]),
    );
    expect(mockClassify).toHaveBeenNthCalledWith(
      2,
      STORE,
      new Map([['/d/b.pdf', pdf]]),
    );
  });
});
