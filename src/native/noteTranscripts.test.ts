// The .note range-walk reader — the ONE source of PAGEIDs/revs/stored
// transcripts. These tests feed it a byte-exact synthetic .note file
// (append-only block format: tail u32 → footer → page blocks →
// RECOGNTEXT blocks) through a mocked native readFileRange, and pin:
// the binary walk, the footer-verified cache, the in-flight dedup, the
// native→ranges→full-fetch fallback chain, and the freshness guard.
// (snapshotFromWalkJson — the native walk's JSON half — is pinned
// separately in walkJson.test.ts.)

// Mutable overlay: tests add/remove walkNote and readFileRange per case.
const overlay: {
  readFileRange?: jest.Mock;
  walkNote?: jest.Mock;
} = {};

jest.mock('react-native', () => ({
  NativeModules: {SmartNoteAiOverlay: overlay},
}));
jest.mock('../core/model/http', () => ({
  sleep: jest.fn(async () => undefined),
}));

import {
  readFileSize,
  readNotePageCount,
  readFooterRevs,
  readPageIds,
  readNotePageRevs,
  readStoredTranscripts,
  readStoredPageText,
  readNoteMeta,
  readLandscapePages,
  invalidateNoteCache,
  ensureNoteFresh,
} from './noteTranscripts';
import type {CaptureDeps} from './capture';

// ---- Synthetic .note builder --------------------------------------------

// latin1 string → bytes (keyword blocks are latin1; UTF-8 payloads are
// built with Buffer below).
const latin1 = (s: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    out.push(s.charCodeAt(i) & 0xff);
  }
  return out;
};

const u32le = (n: number): number[] => [
  n & 0xff,
  (n >> 8) & 0xff,
  (n >> 16) & 0xff,
  (n >> 24) & 0xff,
];

class NoteFile {
  bytes: number[];

  constructor(header = 'noteSN_FILE_VER_20260016') {
    this.bytes = latin1(header);
  }

  // Append a length-prefixed block; returns its address.
  block(content: number[]): number {
    const addr = this.bytes.length;
    this.bytes.push(...u32le(content.length), ...content);
    return addr;
  }

  // Append the 4 tail bytes pointing at the footer and freeze.
  finish(footerAddr: number): Uint8Array {
    return Uint8Array.from([...this.bytes, ...u32le(footerAddr)]);
  }
}

// RECOGNTEXT block content: base64 (as latin1 text) of UTF-8 JSON.
const recognBlock = (label: string): number[] =>
  latin1(
    Buffer.from(
      JSON.stringify({elements: [{label, words: []}]}),
      'utf8',
    ).toString('base64'),
  );

// The reference 2-page fixture. Page 1: PAGEID P111 + transcript.
// Page 2: PAGEID P222, starred, landscape, transcript, one keyword.
const buildFixture = (): {
  bytes: Uint8Array;
  addrs: {p1: number; p2: number};
} => {
  const f = new NoteFile();
  const r1 = f.block(recognBlock('Bonjour page un'));
  const r2 = f.block(recognBlock('Deuxième page'));
  const p1 = f.block(
    latin1(`<PAGEID:P111><RECOGNSTATUS:1><RECOGNTEXT:${r1}>`),
  );
  const p2 = f.block(
    latin1(
      `<PAGEID:P222><FIVESTAR:1_2_3><ORIENTATION:1090><RECOGNTEXT:${r2}>`,
    ),
  );
  const kw = f.block([
    ...latin1('<KEYWORDPAGE:2><KEYWORD:'),
    ...Array.from(Buffer.from('café', 'utf8')),
    ...latin1('>'),
  ]);
  const footer = f.block(
    latin1(`<PAGE1:${p1}><PAGE2:${p2}><KEYWORD_X:${kw}>`),
  );
  return {bytes: f.finish(footer), addrs: {p1, p2}};
};

// ---- Mock native range reader over an in-memory file map ----------------

const files = new Map<string, Uint8Array>();

const installRfr = (): jest.Mock => {
  const rfr = jest.fn(async (path: string, off: number, len: number) => {
    const f = files.get(path);
    if (f === undefined) {
      return {success: false};
    }
    const slice = f.subarray(off, off + len);
    return {
      success: true,
      fileSize: f.length,
      bytesB64: Buffer.from(slice).toString('base64'),
    };
  });
  overlay.readFileRange = rfr;
  return rfr;
};

// Each test uses a UNIQUE path: the module-level snapshot cache and
// in-flight dedup survive across tests by design.
let pathSeq = 0;
const freshPath = (): string => `/notes/test-${++pathSeq}.note`;

beforeEach(() => {
  files.clear();
  delete overlay.walkNote;
  installRfr();
});

// ---- The binary walk ------------------------------------------------------

describe('range walk (readNoteViaRanges through the public readers)', () => {
  it('parses ids, revs, transcripts, stars, landscape and keywords', async () => {
    const p = freshPath();
    const {bytes, addrs} = buildFixture();
    files.set(p, bytes);

    expect(await readPageIds(p)).toEqual(
      new Map([
        [0, 'P111'],
        [1, 'P222'],
      ]),
    );
    // Revs ARE the footer block addresses (coherent with the ids by
    // construction — same walk).
    expect(await readNotePageRevs(p)).toEqual(
      new Map([
        [0, String(addrs.p1)],
        [1, String(addrs.p2)],
      ]),
    );
    const recogn = await readStoredTranscripts(p);
    expect(recogn.get(0)).toBe('Bonjour page un');
    expect(recogn.get(1)).toBe('Deuxième page');
    expect(await readStoredPageText(p, 0)).toBe('Bonjour page un');
    expect(await readStoredPageText(p, 5)).toBeNull();
    const meta = await readNoteMeta(p);
    expect(meta.stars).toEqual([1]);
    // Keyword text decodes as UTF-8 (not mojibake), page 0-indexed.
    expect(meta.kws).toEqual([{p: 1, t: 'café'}]);
    expect(await readLandscapePages(p)).toEqual(new Set([1]));
  });

  it('returns an empty snapshot for a non-.note path without touching the file', async () => {
    const rfr = overlay.readFileRange as jest.Mock;
    expect(await readPageIds('/docs/some.pdf')).toEqual(new Map());
    expect(rfr).not.toHaveBeenCalled();
  });

  it('a wrong signature yields an empty snapshot (not a crash, not a fetch)', async () => {
    const p = freshPath();
    const f = new NoteFile('junkSN_FILE_VER_20260016');
    const footer = f.block(latin1('<PAGE1:9999>'));
    files.set(p, f.finish(footer));
    expect(await readPageIds(p)).toEqual(new Map());
  });

  it('a corrupt RECOGNTEXT address drops the transcript but keeps the page', async () => {
    const p = freshPath();
    const f = new NoteFile();
    const pg = f.block(latin1('<PAGEID:PA><RECOGNTEXT:999999>'));
    const footer = f.block(latin1(`<PAGE1:${pg}>`));
    files.set(p, f.finish(footer));
    expect(await readPageIds(p)).toEqual(new Map([[0, 'PA']]));
    expect((await readStoredTranscripts(p)).size).toBe(0);
  });

  it('a corrupt PAGE address keeps the rev but has no id/transcript', async () => {
    const p = freshPath();
    const f = new NoteFile();
    const pg = f.block(latin1('<PAGEID:POK>'));
    const footer = f.block(latin1(`<PAGE1:${pg}><PAGE2:777777>`));
    files.set(p, f.finish(footer));
    expect(await readPageIds(p)).toEqual(new Map([[0, 'POK']]));
    const revs = await readNotePageRevs(p);
    expect(revs.get(1)).toBe('777777'); // count still sees 2 pages
    expect(revs.size).toBe(2);
  });
});

// ---- Cheap footer readers -------------------------------------------------

describe('footer-only readers', () => {
  it('readFooterRevs maps 0-indexed pages to block addresses', async () => {
    const p = freshPath();
    const {bytes, addrs} = buildFixture();
    files.set(p, bytes);
    expect(await readFooterRevs(p)).toEqual(
      new Map([
        [0, String(addrs.p1)],
        [1, String(addrs.p2)],
      ]),
    );
  });

  it('readNotePageCount counts the <PAGEn:> markers', async () => {
    const p = freshPath();
    files.set(p, buildFixture().bytes);
    expect(await readNotePageCount(p)).toBe(2);
  });

  it('both return empty/null when the file is missing', async () => {
    const p = freshPath();
    expect(await readFooterRevs(p)).toEqual(new Map());
    expect(await readNotePageCount(p)).toBeNull();
  });

  it('readFileSize stats without reading; null on error or absent native', async () => {
    const p = freshPath();
    files.set(p, buildFixture().bytes);
    expect(await readFileSize(p)).toBe(files.get(p)!.length);
    (overlay.readFileRange as jest.Mock).mockRejectedValueOnce(
      new Error('io'),
    );
    expect(await readFileSize(p)).toBeNull();
    delete overlay.readFileRange;
    expect(await readFileSize(p)).toBeNull();
    installRfr();
  });
});

// ---- Footer-verified cache -----------------------------------------------

describe('snapshot cache', () => {
  it('serves the cached walk while the footer is unchanged (no page-block reads)', async () => {
    const p = freshPath();
    files.set(p, buildFixture().bytes);
    await readPageIds(p);
    const rfr = installRfr(); // fresh mock: count only the second access
    expect(await readPageIds(p)).toEqual(
      new Map([
        [0, 'P111'],
        [1, 'P222'],
      ]),
    );
    // Footer verification only: stat + tail + footer len + footer body.
    expect(rfr.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('re-walks when the footer moved (page edited) and picks up the change', async () => {
    const p = freshPath();
    files.set(p, buildFixture().bytes);
    expect((await readPageIds(p)).size).toBe(2);
    // Simulate an appended edit: rebuild the note with a third page.
    const f = new NoteFile();
    const p1 = f.block(latin1('<PAGEID:P111>'));
    const p2 = f.block(latin1('<PAGEID:P222>'));
    const p3 = f.block(latin1('<PAGEID:P333>'));
    const footer = f.block(
      latin1(`<PAGE1:${p1}><PAGE2:${p2}><PAGE3:${p3}>`),
    );
    files.set(p, f.finish(footer));
    const ids = await readPageIds(p);
    expect(ids.get(2)).toBe('P333');
    expect(ids.size).toBe(3);
  });

  it('invalidateNoteCache forces the next read to re-walk', async () => {
    const p = freshPath();
    files.set(p, buildFixture().bytes);
    await readPageIds(p);
    invalidateNoteCache(p);
    const rfr = installRfr();
    await readPageIds(p);
    // A full walk reads page blocks too — well beyond the 4 footer reads.
    expect(rfr.mock.calls.length).toBeGreaterThan(4);
  });

  it('two concurrent cold readers share ONE walk (in-flight dedup)', async () => {
    const p = freshPath();
    files.set(p, buildFixture().bytes);
    const rfr = overlay.readFileRange as jest.Mock;
    const [a, b] = await Promise.all([readPageIds(p), readNotePageRevs(p)]);
    expect(a.get(0)).toBe('P111');
    expect(b.size).toBe(2);
    // Exactly one stat (path, 0, 6) — a second walk would stat again.
    const stats = rfr.mock.calls.filter(
      c => c[1] === 0 && c[2] === 6,
    ).length;
    expect(stats).toBe(1);
  });
});

// ---- Fallback chain: native walk → JS ranges → whole-file fetch -----------

describe('walk fallback chain', () => {
  it('prefers the native walkNote when it returns valid JSON', async () => {
    const p = freshPath();
    files.set(p, buildFixture().bytes); // present, but must NOT be walked
    overlay.walkNote = jest.fn(async () => ({
      success: true,
      json: JSON.stringify({
        count: 1,
        pages: [{p: 0, rev: '42', id: 'NATIVE'}],
        kws: [],
      }),
    }));
    expect(await readPageIds(p)).toEqual(new Map([[0, 'NATIVE']]));
    expect(overlay.walkNote).toHaveBeenCalledWith(p);
  });

  it('falls back to the JS range walk when walkNote returns garbage', async () => {
    const p = freshPath();
    files.set(p, buildFixture().bytes);
    overlay.walkNote = jest.fn(async () => ({success: true, json: '{nope'}));
    expect((await readPageIds(p)).get(0)).toBe('P111');
  });

  it('falls back to the whole-file fetch when no native reader exists (ids yes, revs no)', async () => {
    const p = freshPath();
    const {bytes} = buildFixture();
    delete overlay.readFileRange;
    const origFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(0),
    })) as unknown as typeof fetch;
    try {
      expect(await readPageIds(p)).toEqual(
        new Map([
          [0, 'P111'],
          [1, 'P222'],
        ]),
      );
      // No revs on this path — pageNeedsRead treats them as unknown.
      expect((await readNotePageRevs(p)).size).toBe(0);
    } finally {
      global.fetch = origFetch;
      installRfr();
    }
  });
});

// ---- Freshness guard --------------------------------------------------------

describe('ensureNoteFresh', () => {
  const depsWith = (
    live: number | {result: number},
    save: jest.Mock = jest.fn(async () => undefined),
  ): {deps: CaptureDeps; save: jest.Mock} => {
    const deps = {
      getNoteTotalPageNum: jest.fn(async () => live),
      saveCurrentNote: save,
    } as unknown as CaptureDeps;
    return {deps, save};
  };

  it('does nothing when the file already matches the live count', async () => {
    const p = freshPath();
    files.set(p, buildFixture().bytes); // 2 pages
    const {deps, save} = depsWith(2);
    await ensureNoteFresh(deps, p);
    expect(save).not.toHaveBeenCalled();
  });

  it('save-and-retries until the lazy flush lands (result-wrapped count)', async () => {
    const p = freshPath();
    files.set(p, buildFixture().bytes); // 2 pages on disk, 3 live
    const save = jest.fn(async () => {
      // The firmware flush: the third page appears on disk.
      const f = new NoteFile();
      const b1 = f.block(latin1('<PAGEID:P1>'));
      const b2 = f.block(latin1('<PAGEID:P2>'));
      const b3 = f.block(latin1('<PAGEID:P3>'));
      files.set(
        p,
        f.finish(f.block(latin1(`<PAGE1:${b1}><PAGE2:${b2}><PAGE3:${b3}>`))),
      );
    });
    const {deps} = depsWith({result: 3}, save);
    await ensureNoteFresh(deps, p);
    expect(save).toHaveBeenCalledTimes(1);
    expect(await readNotePageCount(p)).toBe(3);
  });

  it('gives up after 3 retries without throwing (note edited elsewhere)', async () => {
    const p = freshPath();
    files.set(p, buildFixture().bytes); // stuck at 2 pages
    const {deps, save} = depsWith(5);
    await ensureNoteFresh(deps, p);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it('skips silently when the live count or the range reader is unavailable', async () => {
    const p = freshPath();
    files.set(p, buildFixture().bytes);
    const bad = {
      getNoteTotalPageNum: jest.fn(async () => {
        throw new Error('sdk');
      }),
      saveCurrentNote: jest.fn(),
    } as unknown as CaptureDeps;
    await expect(ensureNoteFresh(bad, p)).resolves.toBeUndefined();
    delete overlay.readFileRange;
    const {deps, save} = depsWith(9);
    await ensureNoteFresh(deps, p);
    expect(save).not.toHaveBeenCalled();
    installRfr();
  });
});
