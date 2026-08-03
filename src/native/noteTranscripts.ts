// The ONE .note metadata reader (refactor v0.36 §1.1): PAGEIDs, per-page
// content-revs (block addresses) and the stored real-time-recognition
// transcripts all come from a SINGLE cached walk — so ids and revs can
// never describe two different file states (the pre-v0.36 bug surface:
// revs bypassed the cache while ids served from it).
//
// v0.22.15: the walk uses the NATIVE readFileRange (RandomAccessFile) —
// tail 4 bytes → footer → page blocks → RECOGNTEXT blocks: ~2×pages+2
// SMALL reads instead of fetch(file://)-ing the whole note through the
// JS bridge (measured 16 s for a 5.5 MB note — it janked the whole UI).
// The whole-file path stays as fallback if the native method is absent
// (no revs there: the range reader is what exposes the addresses).
//
// Also owns the FRESHNESS GUARD (device bug 2026-07-12): the firmware
// flushes .note files LAZILY — right after a page is created/deleted the
// on-disk footer lags the in-memory note. ensureNoteFresh compares the
// SDK's live page count to the file's (cheap footer-only count, ~3 native
// reads) and save/sleep/retries up to 3× on mismatch.

import {NativeModules} from 'react-native';
import {sleep} from '../core/model/http';
import type {CaptureDeps} from './capture';
import {
  parseRecognTexts,
  parsePageIds,
  asLatin1,
  textFromRecognJson,
} from '../core/notefile/recognText';
import {base64ToBytes, utf8FromBytes} from '../core/util/base64';

const {SmartNoteAiOverlay} = NativeModules as {
  SmartNoteAiOverlay?: {
    readFileRange?: (
      path: string,
      offset: number,
      length: number,
    ) => Promise<{success?: boolean; fileSize?: number; bytesB64?: string}>;
    walkNote?: (
      path: string,
    ) => Promise<{success?: boolean; json?: string}>;
  };
};

export type NoteSnapshot = {
  ids: Map<number, string>; // 0-indexed page → stable PAGEID
  revs: Map<number, string>; // 0-indexed page → footer block address
  recogn: Map<number, string>; // 0-indexed page → stored RECOGNTEXT
  count: number; // page count as the FILE sees it
  // v0.37 smart search — harvested in the SAME walk:
  stars: number[]; // 0-indexed pages with a <FIVESTAR:…> mark
  kws: Array<{p: number; t: string}>; // Supernote keywords (page, text)
  // v0.52 rotation: pages whose <ORIENTATION:…> is 1090 = written in the
  // device's LANDSCAPE mode → renders are auto-rotated before reading.
  // (Free: the key sits in the page block this walk already holds. It
  // does NOT catch hand-rotated writing on a portrait page — that is the
  // manual "Redo rotated" button.)
  landscape: number[];
};

// Cache policy (v0.36.1, device measurement: the walk of a 104-page note
// takes 16-22 s of bridge IO on the Manta — the Library felt frozen):
// a cached snapshot is VERIFIED against the live footer (~3 small reads)
// instead of trusted for a blind TTL. The .note format is append-only, so
// "same per-page block addresses" ⇒ nothing changed ⇒ the walk is still
// exact. The TTL is only a hard memory bound, not the freshness signal.
// SLOTS = 3 (decision 2026-07-17): chat on note A + Auto covering note B
// no longer evict each other into a re-walk per access.
const TTL_MS = 10 * 60_000;
const SLOTS = 3;
let cached: Array<{path: string; at: number; snap: NoteSnapshot}> = [];
// In-flight dedup: two concurrent callers (openDoc + page view) used to
// launch TWO full 22 s walks in parallel (seen in the device log).
let walking: {path: string; gen: number; p: Promise<NoteSnapshot>} | null =
  null;
// Bumped by invalidateNoteCache: a walk that started before an
// invalidation must not populate the cache with its (stale) result.
let cacheGen = 0;

const emptySnap = (): NoteSnapshot => ({
  ids: new Map(),
  revs: new Map(),
  recogn: new Map(),
  count: 0,
  stars: [],
  landscape: [],
  kws: [],
});

const u32le = (b: Uint8Array): number =>
  (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;

// Tail → footer block as a latin1 string (the page list "…<PAGEn:addr>…").
// ~3 small native reads (~50 ms) regardless of page count — does NOT walk
// the page blocks. Always fresh (bypasses the snapshot cache) — it is the
// freshness DETECTOR, never a stamping source. Null when the native range
// read is unavailable or the file/footer is malformed.
const readFooterString = async (
  notePath: string,
): Promise<string | null> => {
  const rfr = SmartNoteAiOverlay?.readFileRange;
  if (!rfr || !/\.note$/i.test(notePath)) {
    return null;
  }
  try {
    const read = async (off: number, len: number): Promise<Uint8Array | null> => {
      const r = await rfr(notePath, off, len);
      return r?.success && typeof r.bytesB64 === 'string'
        ? base64ToBytes(r.bytesB64)
        : null;
    };
    const stat = await rfr(notePath, 0, 6);
    if (!stat?.success || typeof stat.fileSize !== 'number' || stat.fileSize < 32) {
      return null;
    }
    const size = stat.fileSize;
    const tail = await read(size - 4, 4);
    if (tail === null) {
      return null;
    }
    const footerAddr = u32le(tail);
    if (footerAddr <= 0 || footerAddr + 4 > size) {
      return null;
    }
    const lenB = await read(footerAddr, 4);
    if (lenB === null) {
      return null;
    }
    const flen = u32le(lenB);
    if (flen === 0 || flen > 4_000_000 || footerAddr + 4 + flen > size) {
      return null;
    }
    const footerB = await read(footerAddr + 4, flen);
    return footerB === null ? null : asLatin1(footerB);
  } catch {
    return null;
  }
};

// Cheap file SIZE (a stat, ~1 native read) — used by the Auto scheduler to
// skip an unchanged PDF without reading the whole file into memory (readPdf
// otherwise fetches the entire document just to compute its byte length).
export const readFileSize = async (path: string): Promise<number | null> => {
  const rfr = SmartNoteAiOverlay?.readFileRange;
  if (!rfr) {
    return null;
  }
  try {
    const r = await rfr(path, 0, 0);
    return r?.success && typeof r.fileSize === 'number' ? r.fileSize : null;
  } catch {
    return null;
  }
};

// Cheap page COUNT: count "<PAGEn:" markers in the footer. Used by the
// freshness guard. Returns null when unavailable (caller keeps the old
// path).
export const readNotePageCount = async (
  notePath: string,
): Promise<number | null> => {
  const footer = await readFooterString(notePath);
  return footer === null ? null : (footer.match(/<PAGE\d+:/g) ?? []).length;
};

// Footer-only per-page content-revs (~3 native reads, always fresh): the
// Auto scheduler's CHEAP change detector. Same source of truth as the
// full walk (the footer block addresses) at a fraction of the IO — the
// coherent snapshot is only paid once a change is actually seen. Empty
// when the native range reader is absent.
export const readFooterRevs = async (
  notePath: string,
): Promise<Map<number, string>> => {
  const out = new Map<number, string>();
  const footer = await readFooterString(notePath);
  if (footer === null) {
    return out;
  }
  const re = /<PAGE(\d+):(\d+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(footer)) !== null) {
    const page = parseInt(m[1], 10) - 1; // 1-indexed in the footer
    if (page >= 0) {
      out.set(page, m[2]);
    }
  }
  return out;
};

// Range-walk the .note structure with a handful of small native reads.
const readNoteViaRanges = async (
  notePath: string,
): Promise<NoteSnapshot | null> => {
  const rfr = SmartNoteAiOverlay?.readFileRange;
  if (!rfr) {
    return null; // native method absent → caller falls back
  }
  const read = async (off: number, len: number): Promise<Uint8Array | null> => {
    const r = await rfr(notePath, off, len);
    return r?.success && typeof r.bytesB64 === 'string'
      ? base64ToBytes(r.bytesB64)
      : null;
  };
  const stat = await rfr(notePath, 0, 6);
  if (!stat?.success || typeof stat.fileSize !== 'number') {
    return null;
  }
  const size = stat.fileSize;
  if (
    size < 32 ||
    asLatin1(base64ToBytes(stat.bytesB64 ?? '')) !== 'noteSN'
  ) {
    return emptySnap();
  }
  const blockAt = async (addr: number): Promise<Uint8Array | null> => {
    if (addr <= 0 || addr + 4 > size) {
      return null;
    }
    const lenB = await read(addr, 4);
    if (lenB === null) {
      return null;
    }
    const len = u32le(lenB);
    // Guard corrupt addresses (append-only format, stale offsets happen)
    if (len === 0 || len > 4_000_000 || addr + 4 + len > size) {
      return null;
    }
    return read(addr + 4, len);
  };
  const tail = await read(size - 4, 4);
  if (tail === null) {
    return null;
  }
  const footerB = await blockAt(u32le(tail));
  if (footerB === null) {
    return emptySnap();
  }
  const footer = asLatin1(footerB);
  const snap = emptySnap();
  const pageRe = /<PAGE(\d+):(\d+)>/g;
  let m: RegExpExecArray | null;
  while ((m = pageRe.exec(footer)) !== null) {
    try {
      const pageNum = parseInt(m[1], 10) - 1; // 0-indexed out
      if (pageNum < 0) {
        continue;
      }
      snap.count = Math.max(snap.count, pageNum + 1);
      // The block address IS this page's content rev — same walk as the
      // ids below, so the two maps are coherent by construction.
      snap.revs.set(pageNum, m[2]);
      const pageB = await blockAt(parseInt(m[2], 10));
      if (pageB === null) {
        continue;
      }
      const info = asLatin1(pageB);
      const id = /<PAGEID:([^>]+)>/.exec(info);
      if (id !== null && id[1].length > 0) {
        snap.ids.set(pageNum, id[1]);
      }
      // Five-pointed star mark (v0.37): a bare key in the page metadata —
      // free to harvest, we are already holding the block.
      if (info.includes('<FIVESTAR:')) {
        snap.stars.push(pageNum);
      }
      if (/<ORIENTATION:1090>/.test(info)) {
        snap.landscape.push(pageNum);
      }
      const rt = /<RECOGNTEXT:(\d+)>/.exec(info);
      const recognB = rt ? await blockAt(parseInt(rt[1], 10)) : null;
      if (recognB !== null) {
        const text = textFromRecognJson(base64ToBytes(asLatin1(recognB)));
        if (text.length > 0) {
          snap.recogn.set(pageNum, text);
        }
      }
    } catch {
      // skip this page, keep the others
    }
  }
  // Supernote keywords (v0.37): footer KEYWORD_ entries → one small block
  // each, with the page number and the keyword text in clear.
  const kwRe = /<KEYWORD_[^:>]*:(\d+)>/g;
  let km: RegExpExecArray | null;
  while ((km = kwRe.exec(footer)) !== null) {
    try {
      const kb = await blockAt(parseInt(km[1], 10));
      if (kb === null) {
        continue;
      }
      const meta = asLatin1(kb);
      const pg = /<KEYWORDPAGE:(\d+)>/.exec(meta);
      const kw = /<KEYWORD:([^>]*)>/.exec(meta);
      if (pg !== null && kw !== null && kw[1].length > 0) {
        // The keyword text is UTF-8 in the block: latin1 chars map 1:1 to
        // bytes, so slice the raw bytes at the match and decode properly
        // (accents would otherwise arrive as mojibake).
        const start = (kw.index ?? 0) + '<KEYWORD:'.length;
        const text = utf8FromBytes(kb.slice(start, start + kw[1].length));
        snap.kws.push({p: parseInt(pg[1], 10) - 1, t: text});
      }
    } catch {
      // skip this keyword, keep the others
    }
  }
  snap.stars.sort((a, b) => a - b);
  snap.kws.sort((a, b) => a.p - b.p || a.t.localeCompare(b.t));
  return snap;
};

// Two snapshots describe the same file state iff their footer maps match
// (append-only format: any page edit moves that page's block address).
const sameRevs = (a: Map<number, string>, b: Map<number, string>): boolean => {
  if (a.size !== b.size) {
    return false;
  }
  for (const [k, v] of a) {
    if (b.get(k) !== v) {
      return false;
    }
  }
  return true;
};

// Pure parser for the NATIVE walk's JSON (v0.67) — exported for tests.
// The Kotlin walkNote is a port of readNoteViaRanges; this converts its
// output to the same NoteSnapshot shape, defensively (a malformed field
// drops that page/keyword, a malformed document returns null → the JS
// walk takes over).
export const snapshotFromWalkJson = (raw: string): NoteSnapshot | null => {
  try {
    const obj = JSON.parse(raw) as {
      count?: unknown;
      pages?: unknown;
      kws?: unknown;
    };
    if (
      typeof obj.count !== 'number' ||
      !Array.isArray(obj.pages) ||
      !Array.isArray(obj.kws)
    ) {
      return null;
    }
    const snap = emptySnap();
    snap.count = obj.count;
    for (const p of obj.pages as Array<{
      p?: unknown;
      rev?: unknown;
      id?: unknown;
      star?: unknown;
      landscape?: unknown;
      recogn?: unknown;
    }>) {
      if (typeof p?.p !== 'number' || p.p < 0) {
        continue;
      }
      if (typeof p.rev === 'string') {
        snap.revs.set(p.p, p.rev);
      }
      if (typeof p.id === 'string' && p.id.length > 0) {
        snap.ids.set(p.p, p.id);
      }
      if (p.star === true) {
        snap.stars.push(p.p);
      }
      if (p.landscape === true) {
        snap.landscape.push(p.p);
      }
      if (typeof p.recogn === 'string' && p.recogn.length > 0) {
        snap.recogn.set(p.p, p.recogn);
      }
    }
    for (const k of obj.kws as Array<{p?: unknown; t?: unknown}>) {
      if (typeof k?.p === 'number' && typeof k.t === 'string' && k.t.length > 0) {
        snap.kws.push({p: k.p, t: k.t});
      }
    }
    snap.stars.sort((a, b) => a - b);
    snap.kws.sort((a, b) => a.p - b.p || a.t.localeCompare(b.t));
    return snap;
  } catch {
    return null;
  }
};

const walkNote = async (notePath: string): Promise<NoteSnapshot> => {
  const t0 = Date.now();
  let snap: NoteSnapshot | null = null;
  let via = 'native';
  // v0.67: the native walk first — one bridge call, parsing on a native
  // background thread (the 2-7 s JS walks were the post-reinstall UI
  // freeze). Any failure falls through to the proven JS paths.
  const wn = SmartNoteAiOverlay?.walkNote;
  if (wn !== undefined) {
    try {
      const r = await wn(notePath);
      if (r?.success === true && typeof r.json === 'string') {
        snap = snapshotFromWalkJson(r.json);
      }
    } catch {
      // fall through
    }
  }
  if (snap === null) {
    via = 'ranges';
    snap = await readNoteViaRanges(notePath).catch(() => null);
  }
  if (snap === null) {
    // Fallback: whole-file fetch (slow on big notes, but always works).
    // No revs on this path — pageNeedsRead then treats them as unknown
    // and never churns on missing data.
    via = 'full-fetch';
    const res = await fetch(`file://${notePath}`);
    if (!res.ok) {
      return emptySnap();
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ids = parsePageIds(bytes);
    snap = {
      ids,
      revs: new Map(),
      recogn: parseRecognTexts(bytes),
      count: ids.size > 0 ? Math.max(...ids.keys()) + 1 : 0,
      stars: [],
      landscape: [],
      kws: [],
    };
  }
  console.log(
    '[SmartNoteAI.note]',
    `snapshot: ${snap.recogn.size} transcript(s), ${snap.ids.size} id(s), ${
      snap.count
    } page(s) in ${notePath.split('/').pop()} (${via}, ${Date.now() - t0} ms)`,
  );
  return snap;
};

const readNote = async (notePath: string): Promise<NoteSnapshot> => {
  if (!/\.note$/i.test(notePath)) {
    return emptySnap(); // PDFs/EPUBs have neither RECOGNTEXT nor PAGEID blocks
  }
  const now = Date.now();
  const hit = cached.find(c => c.path === notePath && now - c.at < TTL_MS);
  // Why a full (multi-second) walk is about to happen — the misses are
  // the expensive path, so each one says WHY (perf diagnostic, v0.54.1:
  // a send was observed walking a 106-page note 3× in a row).
  let missReason = hit
    ? '' // decided below
    : cached.some(c => c.path === notePath)
    ? 'ttl-expired'
    : 'cold';
  if (hit) {
    // Content-verified cache: the footer (~3 reads, always fresh) says
    // whether the cached walk still describes the on-disk file. Only when
    // the footer moved (edit / add / delete / reorder) do we re-walk.
    if (hit.snap.revs.size > 0) {
      const live = await readFooterRevs(notePath).catch(
        () => new Map<number, string>(),
      );
      if (sameRevs(hit.snap.revs, live)) {
        hit.at = now; // still exact — keep it hot
        return hit.snap;
      }
      cached = cached.filter(c => c !== hit); // stale — fall through to walk
      missReason = 'footer-changed';
    } else {
      return hit.snap; // fallback snapshot (no revs): plain TTL behavior
    }
  }
  console.log(
    '[SmartNoteAI.note]',
    `snapshot MISS (${missReason}) → walking ${notePath.split('/').pop()}`,
  );
  // In-flight dedup: join a walk already running for this note.
  if (walking !== null && walking.path === notePath) {
    return walking.p;
  }
  const gen = cacheGen;
  const slot = {
    path: notePath,
    gen,
    p: undefined as unknown as Promise<NoteSnapshot>,
  };
  slot.p = (async () => {
    try {
      const snap = await walkNote(notePath);
      // Only cache if no invalidation happened while we walked (the walk
      // can take >15 s on a big note — plenty of time for the file to be
      // declared stale under us).
      if (cacheGen === gen) {
        cached = [
          {path: notePath, at: Date.now(), snap},
          ...cached.filter(c => c.path !== notePath),
        ].slice(0, SLOTS);
      } else {
        // The fence: an invalidation landed while we walked — the result
        // is served to the callers but NOT cached, so the NEXT reader
        // re-walks. Loud on purpose: this is the "phantom re-walk" path.
        console.log(
          '[SmartNoteAI.note]',
          `snapshot NOT cached (invalidated during walk) for ${notePath
            .split('/')
            .pop()}`,
        );
      }
      return snap;
    } catch (e) {
      console.warn(
        '[SmartNoteAI.note]',
        `note snapshot read failed: ${(e as Error).message}`,
      );
      return emptySnap();
    } finally {
      if (walking === slot) {
        walking = null;
      }
    }
  })();
  walking = slot;
  return slot.p;
};

// Drop the cached snapshot of a note — used when the on-disk file is
// suspected STALE (a page was just created: the firmware flushes the
// .note lazily, so the footer can lag the in-memory state). Also fences
// any walk currently in flight: its result will be served to its callers
// but not cached.
export const invalidateNoteCache = (notePath: string): void => {
  cached = cached.filter(c => c.path !== notePath);
  cacheGen++;
  if (walking !== null && walking.path === notePath) {
    walking = null;
  }
};


// FRESHNESS GUARD (moved here from captureContext in v0.36 — same logic).
// Compares the SDK's live page count to the file's cheap footer count; on
// mismatch: saveCurrentNote() (flushes when this note is the open one),
// drop the cached snapshot, re-check — up to 3 tries. If it never
// converges (note edited on another device?), proceed with the file's
// view and say so in the log.
export const ensureNoteFresh = async (
  deps: CaptureDeps,
  notePath: string,
): Promise<void> => {
  try {
    const raw = await deps.getNoteTotalPageNum(notePath);
    const n =
      typeof raw === 'number'
        ? raw
        : ((raw as {result?: unknown})?.result as number);
    if (typeof n !== 'number' || n <= 0) {
      return;
    }
    let count = await readNotePageCount(notePath);
    if (count === null) {
      return; // native range reader absent — skip the guard, don't stall
    }
    for (let attempt = 0; count !== n && attempt < 3; attempt++) {
      console.log(
        '[SmartNoteAI.note]',
        `stale .note file (file=${count} pages, live=${n}) — save & retry ${
          attempt + 1
        }`,
      );
      await deps.saveCurrentNote().catch(() => undefined);
      await sleep(500);
      invalidateNoteCache(notePath);
      count = await readNotePageCount(notePath);
      if (count === null) {
        return;
      }
    }
    if (count !== n) {
      console.warn(
        '[SmartNoteAI.note]',
        `page list still stale after retries (file=${count}, live=${n})`,
      );
    }
  } catch {
    // no live count — proceed with the file's view
  }
};

export const readStoredTranscripts = async (
  notePath: string,
): Promise<Map<number, string>> => (await readNote(notePath)).recogn;

// v0.37 smart search: stars + keywords, served from the SAME cached walk.
// 0-indexed pages flagged landscape (ORIENTATION 1090) by the device.
export const readLandscapePages = async (
  notePath: string,
): Promise<Set<number>> => {
  const s = await readNote(notePath);
  return new Set(s.landscape);
};

export const readNoteMeta = async (
  notePath: string,
): Promise<{stars: number[]; kws: Array<{p: number; t: string}>}> => {
  const s = await readNote(notePath);
  return {stars: s.stars, kws: s.kws};
};

// 0-indexed page → stable PAGEID (follows the page through deletions,
// insertions and reordering). Empty map when unreadable.
export const readPageIds = async (
  notePath: string,
): Promise<Map<number, string>> => (await readNote(notePath)).ids;

// 0-indexed page → content-rev (block address). SAME cached walk as the
// ids — coherent by construction. Empty on the whole-file fallback.
export const readNotePageRevs = async (
  notePath: string,
): Promise<Map<number, string>> => (await readNote(notePath)).revs;

// Single page (0-indexed); null when the file has no stored transcript
// for it — the caller then falls back to recognizeElements.
export const readStoredPageText = async (
  notePath: string,
  page: number,
): Promise<string | null> =>
  (await readStoredTranscripts(notePath)).get(page) ?? null;
