// The EXPORT feature (store → /EXPORT, zero API calls). Pins the user
// promises: gap counting for the "read first?" dialog, tree mirroring
// under /EXPORT, selection file names with the doc total in the header,
// the txt twin, and honest failed[] reporting.

const writes = new Map<string, string>(); // target → decoded content
const mockWriteFileBase64 = jest.fn(async (p: string, b64: string) => {
  writes.set(p, Buffer.from(b64, 'base64').toString('utf8'));
  return {success: true};
});
const mockMkdirs = jest.fn(async (_p: string) => ({success: true}));

// Lazy wrappers: the hoisted requires run BEFORE these consts are
// initialized, so the factory must not capture their values eagerly.
jest.mock('react-native', () => ({
  NativeModules: {
    SmartNoteAiOverlay: {
      writeFileBase64: (...a: unknown[]) =>
        mockWriteFileBase64(...(a as [string, string])),
      mkdirs: (...a: unknown[]) => mockMkdirs(...(a as [string])),
    },
  },
}));

const mockLoadStore = jest.fn();
jest.mock('./transcriptStoreIo', () => ({
  loadStore: () => mockLoadStore(),
}));

const mockPagesNeedingRead = jest.fn();
jest.mock('./reading', () => ({
  pagesNeedingRead: (...a: unknown[]) => mockPagesNeedingRead(...a),
  isNotePath: (p: string) => /\.note$/i.test(p),
}));

import {
  fmtExportDate,
  countExportGaps,
  runExport,
  EXPORT_ROOT,
} from './exporter';
import {emptyStore, upsertPage, makePageEntry} from '../core/store/transcriptStore';
import type {Store} from '../core/store/transcriptStore';
import type {CaptureDeps} from './capture';

const NOTE = '/storage/emulated/0/Note/Work/meeting.note';
const PDF = '/storage/emulated/0/Document/spec.pdf';

const storeWith = (
  fill: Array<{path: string; page: number; text: string; at?: number}>,
): Store => {
  const s = emptyStore();
  for (const f of fill) {
    upsertPage(
      s,
      f.path,
      f.page,
      makePageEntry(f.text, 'mistral-ocr', {hash: 'h'}, f.at ?? 1_700_000_000_000),
      1,
    );
  }
  return s;
};

const deps = (liveCount?: number): CaptureDeps =>
  ({
    getNoteTotalPageNum: jest.fn(async () => {
      if (liveCount === undefined) {
        throw new Error('sdk down');
      }
      return {result: liveCount};
    }),
  } as unknown as CaptureDeps);

beforeEach(() => {
  writes.clear();
  jest.clearAllMocks();
});

describe('fmtExportDate', () => {
  it('formats dd/mm/yyyy hh:mm with zero padding', () => {
    // 2026-01-05 08:07 local — build from local components to stay TZ-proof.
    const d = new Date(2026, 0, 5, 8, 7).getTime();
    expect(fmtExportDate(d)).toBe('05/01/2026 08:07');
  });
});

describe('countExportGaps', () => {
  it('counts missing note pages via pagesNeedingRead and unread PDFs as one doc', async () => {
    mockLoadStore.mockResolvedValue(storeWith([{path: NOTE, page: 0, text: 'lu'}]));
    mockPagesNeedingRead.mockResolvedValue([1, 2]);
    const gaps = await countExportGaps(deps(3), [NOTE, PDF]);
    expect(gaps).toEqual({notePages: 2, pdfDocs: 1});
    // The live count (3) wins over the store's view (1 page): the full
    // 0..2 range is what gets checked.
    expect(mockPagesNeedingRead).toHaveBeenCalledWith(
      expect.anything(),
      NOTE,
      [0, 1, 2],
    );
  });

  it('a PDF with at least one stored page is covered (no OCR needed)', async () => {
    mockLoadStore.mockResolvedValue(storeWith([{path: PDF, page: 0, text: 'p'}]));
    mockPagesNeedingRead.mockResolvedValue([]);
    expect(await countExportGaps(deps(), [PDF])).toEqual({
      notePages: 0,
      pdfDocs: 0,
    });
  });

  it('restricts the note count to the given selection', async () => {
    mockLoadStore.mockResolvedValue(storeWith([]));
    mockPagesNeedingRead.mockResolvedValue([4]);
    const gaps = await countExportGaps(deps(9), [NOTE], [2, 4]);
    expect(gaps.notePages).toBe(1);
    expect(mockPagesNeedingRead).toHaveBeenCalledWith(
      expect.anything(),
      NOTE,
      [2, 4],
    );
  });

  it('a failing pagesNeedingRead counts as zero, never throws', async () => {
    mockLoadStore.mockResolvedValue(storeWith([]));
    mockPagesNeedingRead.mockRejectedValue(new Error('boom'));
    expect(await countExportGaps(deps(2), [NOTE])).toEqual({
      notePages: 0,
      pdfDocs: 0,
    });
  });
});

describe('runExport', () => {
  const NOW = new Date(2026, 6, 30, 14, 5).getTime();

  it('flat export (no baseDir) lands at /EXPORT/<name>.md with read + unread pages', async () => {
    mockLoadStore.mockResolvedValue(
      storeWith([{path: NOTE, page: 0, text: 'Premier contenu'}]),
    );
    const r = await runExport(deps(2), [NOTE], {fmt: 'md', now: NOW});
    expect(r.failed).toEqual([]);
    expect(r.written).toEqual([`${EXPORT_ROOT}/meeting.md`]);
    const content = writes.get(`${EXPORT_ROOT}/meeting.md`)!;
    expect(content).toContain('Premier contenu');
    expect(content).toContain('30/07/2026 14:05');
    // Live count says 2 pages: page 2 exists in the file as "not read".
    expect(content.toLowerCase()).toContain('not read');
  });

  it('an all-blank doc gets NO "Transcript source" clause (collecte 2026-08-03)', async () => {
    mockLoadStore.mockResolvedValue(
      storeWith([
        {path: NOTE, page: 0, text: ''},
        {path: NOTE, page: 1, text: '  '},
      ]),
    );
    await runExport(deps(2), [NOTE], {fmt: 'md', now: NOW});
    const content = writes.get(`${EXPORT_ROOT}/meeting.md`)!;
    expect(content).not.toContain('Transcript source');
    expect(content).not.toContain('Mistral');
    expect(content).toContain('(blank page)');
  });

  it('a mixed doc keeps its real source label — blanks stay out of it', async () => {
    mockLoadStore.mockResolvedValue(
      storeWith([
        {path: NOTE, page: 0, text: 'du texte', at: 1_700_000_000_000},
        {path: NOTE, page: 1, text: '', at: 1_800_000_000_000},
      ]),
    );
    await runExport(deps(2), [NOTE], {fmt: 'md', now: NOW});
    const content = writes.get(`${EXPORT_ROOT}/meeting.md`)!;
    expect(content).toContain('Transcript source: Mistral OCR');
    // The blank entry's (later) datetime must not drive the header.
    expect(content).toContain(fmtExportDate(1_700_000_000_000));
  });

  it('mirrors the folder tree under /EXPORT when baseDir is given', async () => {
    mockLoadStore.mockResolvedValue(storeWith([{path: NOTE, page: 0, text: 'x'}]));
    const r = await runExport(deps(1), [NOTE], {
      fmt: 'md',
      baseDir: '/storage/emulated/0/Note',
      now: NOW,
    });
    // baseDir's own name is kept: …/Note/Work/meeting.note → Note/Work/.
    expect(r.written).toEqual([`${EXPORT_ROOT}/Note/Work/meeting.md`]);
    expect(mockMkdirs).toHaveBeenCalledWith(`${EXPORT_ROOT}/Note/Work`);
  });

  it('selection export: page-range file name, only those pages, doc total in header', async () => {
    mockLoadStore.mockResolvedValue(
      storeWith([
        {path: NOTE, page: 0, text: 'page un'},
        {path: NOTE, page: 3, text: 'page quatre'},
      ]),
    );
    const r = await runExport(deps(4), [NOTE], {
      fmt: 'md',
      selection: [3, 0],
      now: NOW,
    });
    expect(r.written).toHaveLength(1);
    const target = r.written[0];
    expect(target).toBe(`${EXPORT_ROOT}/meeting p1,4.md`); // sorted range label
    const content = writes.get(target)!;
    expect(content).toContain('page un');
    expect(content).toContain('page quatre');
    expect(content).toContain('/4'); // header shows the DOC total
  });

  it('txt format: .txt name and markdown stripped to plain text', async () => {
    mockLoadStore.mockResolvedValue(
      storeWith([{path: NOTE, page: 0, text: 'Du **gras** ici'}]),
    );
    const r = await runExport(deps(1), [NOTE], {fmt: 'txt', now: NOW});
    expect(r.written).toEqual([`${EXPORT_ROOT}/meeting.txt`]);
    const content = writes.get(`${EXPORT_ROOT}/meeting.txt`)!;
    expect(content).toContain('Du gras ici');
    expect(content).not.toContain('**');
  });

  it('reports a failed write under failed[] with the DOC path, keeps the others', async () => {
    const other = '/storage/emulated/0/Note/solo.note';
    mockLoadStore.mockResolvedValue(
      storeWith([
        {path: NOTE, page: 0, text: 'a'},
        {path: other, page: 0, text: 'b'},
      ]),
    );
    mockWriteFileBase64.mockImplementation(async (p: string, b64: string) => {
      if (p.includes('meeting')) {
        return {success: false, message: 'disk full'};
      }
      writes.set(p, Buffer.from(b64, 'base64').toString('utf8'));
      return {success: true};
    });
    const r = await runExport(deps(1), [NOTE, other], {fmt: 'md', now: NOW});
    expect(r.failed).toEqual([NOTE]);
    expect(r.written).toEqual([`${EXPORT_ROOT}/solo.md`]);
  });

  it('reports progress per doc (label, done, total)', async () => {
    const other = '/storage/emulated/0/Note/solo.note';
    mockLoadStore.mockResolvedValue(
      storeWith([
        {path: NOTE, page: 0, text: 'a'},
        {path: other, page: 0, text: 'b'},
      ]),
    );
    const seen: Array<[string, number, number]> = [];
    await runExport(deps(1), [NOTE, other], {
      fmt: 'md',
      now: NOW,
      onProgress: (l, d, t) => seen.push([l, d, t]),
    });
    expect(seen).toEqual([
      ['meeting', 1, 2],
      ['solo', 2, 2],
    ]);
  });
});
