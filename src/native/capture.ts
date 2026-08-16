// Page capture — v0.36 SLIM version. The chat is text-only (context comes
// from the TranscriptStore), so "capturing" the current page means three
// cheap SDK calls: path, page number, total pages. NO render, NO on-device
// OCR — the old full capture (render + PNG read + recognizeElements
// cascade) ran on every 2.5 s page-turn poll just to feed a 34×46 px
// thumbnail and an EPUB fallback; the thumbnail is now rendered lazily by
// the panel (capturePageImage) and the embedded-text fallback is fetched
// at gather time (captureDocText).
//
// Every SDK call is injected via CaptureDeps so this is unit-tested with
// fakes, no bridge.

import {bytesToBase64} from '../core/util/base64';

export type PageCapture = {
  notePath: string;
  page: number;
  // Total pages in the note (for whole-note / range context). 1 when
  // unknown or for non-note files.
  totalPages: number;
};

export type CaptureDeps = {
  getCurrentFilePath: () => Promise<unknown>;
  getCurrentPageNum: () => Promise<unknown>;
  getPluginDirPath: () => Promise<string | null | undefined>;
  generateNotePng: (p: {
    notePath: string;
    page: number;
    times: number;
    pngPath: string;
    type: number;
  }) => Promise<unknown>;
  generateDocImage: (
    docPath: string,
    page: number,
    pngPath: string,
    size: {width: number; height: number},
  ) => Promise<unknown>;
  getCurrentDocText: (page: number) => Promise<unknown>;
  getNoteTotalPageNum: (notePath: string) => Promise<unknown>;
  // Page count from the TranscriptStore (what the Library shows). RELIABLE for
  // PDFs, unlike getNoteTotalPageNum which returns 1 for a PDF on-device.
  // Optional so test fakes / old callers still work; 0 when the doc is unread.
  getDocPageCount?: (path: string) => Promise<unknown>;
  // Persist in-memory strokes before rendering — an unsaved page
  // renders blank otherwise (SDK gotcha). Best-effort.
  saveCurrentNote: () => Promise<unknown>;
  // v0.82 (user): PDF handwritten-annotation (.mark) reading. OPTIONAL — an
  // old native binary / a test fake may not provide them; callers guard and
  // degrade to "no annotations".
  //  - getMarkPages: page indices carrying annotations (accepts the PDF path).
  //  - generateMarkThumbnails: render the annotation LAYER of one page to PNG.
  //  - compositePng: multiply-blend the .mark PNG over the PDF page render.
  getMarkPages?: (filePath: string) => Promise<unknown>;
  generateMarkThumbnails?: (
    markPath: string,
    page: number,
    pngPath: string,
    size: {width: number; height: number},
  ) => Promise<unknown>;
  compositePng?: (
    basePath: string,
    overlayPath: string,
    outPath: string,
  ) => Promise<unknown>;
  // v1.0.2 blank-page skip: total element count of a page (0 = no ink,
  // nothing to transcribe). Optional: absent → the probe is skipped and
  // every page goes through the normal paid read.
  getElementCounts?: (page: number, filePath: string) => Promise<unknown>;
  deleteFile: (path: string) => Promise<boolean>;
  fetchFn: (
    url: string,
  ) => Promise<{ok: boolean; arrayBuffer: () => Promise<ArrayBuffer>}>;
  logger?: {warn: (m: string) => void; log?: (m: string) => void};
};

let scratchN = 0;

/* ---------------- render coordination (re-audit 2026-07-19) ---------------- */
// Since the v0.60 background collect, TWO flows can render pages at the
// same time (a chat/tick read + a heartbeat-driven wave-2 catch-up) —
// and concurrent generateNotePng/generateDocImage calls fight over the
// note engine (device-verified: blank/partial renders, which the paid
// models then read as truth). One guard, consumed by reading.ts and
// pretranscript.ts: serializeRender — EVERY native render goes through
// one promise chain, so two flows alternate whole renders instead of
// interleaving. (A second "live-read marker" guard lost its only reader
// with the batch removal on 2026-07-22 and was purged in lot C (b),
// 2026-08-16 — the foreground/background arbitration now lives in
// autoTranscript's setForegroundBusy.)
let renderChain: Promise<unknown> = Promise.resolve();
export const serializeRender = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = renderChain.then(fn, fn);
  renderChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
};

// Native rotate helper (v0.52, rotated pages). Optional: absent on an
// old plugin binary → the un-rotated image is used as before.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const rotateNative = (): {
  rotatePng?: (p: string, deg: number) => Promise<{success?: boolean}>;
} => require('react-native').NativeModules.SmartNoteAiOverlay ?? {};

// Native base64 file read (v0.63.2): the pure-JS encode of a rendered
// PNG (0.5-1 MB per page) blocked the JS thread for hundreds of ms —
// the "UI buried during wave-2 catch-up" device report. Optional:
// absent on an old binary → the fetch + JS-loop path runs as before.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ioNative = (): {
  readFileBase64?: (p: string) => Promise<{success?: boolean; data?: string}>;
} => require('react-native').NativeModules.SmartNoteAiOverlay ?? {};

// FNV-1a of a file's RAW BYTES via the native module — hashing a render
// without pulling ~1 MB of base64 through the JS bridge (v1.0.4, the
// note pixel identity). null when the method is absent (old binary) or
// fails: callers skip the free check, never block a read on it.
export const hashFileFnvNative = async (
  path: string,
): Promise<string | null> => {
  try {
    const m = (require('react-native').NativeModules.SmartNoteAiOverlay ??
      {}) as {
      hashFileFnv?: (p: string) => Promise<{success?: boolean; hash?: string}>;
    };
    if (m.hashFileFnv === undefined) {
      return null;
    }
    const r = await m.hashFileFnv(path);
    return r?.success === true && typeof r.hash === 'string' ? r.hash : null;
  } catch {
    return null;
  }
};

export const readFileB64Native = async (
  path: string,
): Promise<string | null> => {
  try {
    const r = await ioNative().readFileBase64?.(path);
    return r?.success === true && typeof r.data === 'string' ? r.data : null;
  } catch {
    return null;
  }
};

// (The UI-doc-open browse marker — v0.63.2/v0.63.5 — was removed in
// lot C (b), 2026-08-16: v0.68 deliberately dropped its only reader so
// browsing no longer blocks the collect; the writer had been shouting
// into a void ever since.)

export const asString = (raw: unknown): string | null => {
  if (typeof raw === 'string') {
    return raw;
  }
  const r = (raw as {result?: unknown})?.result;
  return typeof r === 'string' ? r : null;
};
export const asNumber = (raw: unknown): number | null => {
  if (typeof raw === 'number') {
    return raw;
  }
  const r = (raw as {result?: unknown})?.result;
  return typeof r === 'number' ? r : null;
};
const succeeded = (r: unknown): boolean =>
  !!r && typeof r === 'object' && (r as {success?: unknown}).success === true;

const readPngBase64 = async (
  deps: CaptureDeps,
  pngPath: string,
): Promise<string | null> => {
  const native = await readFileB64Native(pngPath);
  if (native !== null) {
    return native;
  }
  try {
    const res = await deps.fetchFn(`file://${pngPath}`);
    if (!res.ok) {
      return null;
    }
    const buf = await res.arrayBuffer();
    return bytesToBase64(new Uint8Array(buf));
  } catch (e) {
    deps.logger?.warn(`readPng threw: ${(e as Error).message}`);
    return null;
  }
};

// Locate the page currently on screen — three cheap SDK calls, safe to
// run on every poll tick.
export const captureCurrent = async (
  deps: CaptureDeps,
): Promise<PageCapture | null> => {
  const path = asString(await deps.getCurrentFilePath().catch(() => null));
  const page = asNumber(await deps.getCurrentPageNum().catch(() => null));
  if (path === null || page === null) {
    return null;
  }
  // getNoteTotalPageNum is RELIABLE for .note files. On-device it returns 1
  // for a PDF (the 2026-07-23 "fix" wrongly assumed it worked for PDFs — it
  // does not), which made the panel show "5/1", clamp every scope to page 1,
  // and "redo transcript" re-do page 1 whatever page you were on. So for a PDF
  // we prefer the store's page count (docPageCount — the same source the
  // Library tree uses); it is 0 only while the PDF is still unread.
  let totalPages =
    asNumber(await deps.getNoteTotalPageNum(path).catch(() => null)) ?? 1;
  if (/\.pdf$/i.test(path) && totalPages <= 1 && deps.getDocPageCount) {
    const fromStore =
      asNumber(await deps.getDocPageCount(path).catch(() => null)) ?? 0;
    if (fromStore > totalPages) {
      totalPages = fromStore;
    }
  }
  return {notePath: path, page, totalPages: Math.max(1, totalPages)};
};

// Embedded text of a page of the OPEN document (PDF/EPUB fallback for the
// chat context). The firmware only exposes it for the open doc.
export const captureDocText = async (
  deps: CaptureDeps,
  page: number,
): Promise<string> =>
  asString(await deps.getCurrentDocText(page).catch(() => null))?.trim() ?? '';

// Render an arbitrary page of a .note to a PNG and return it as base64
// (no data: prefix). Used by the paid read flow and the panel's lazy
// thumbnail. Deletes the scratch PNG once its bytes are in memory.
export const capturePageImage = (
  deps: CaptureDeps,
  notePath: string,
  page: number,
  opts?: {skipSave?: boolean; rotateDeg?: number},
): Promise<string | null> =>
  serializeRender(() => capturePageImageInner(deps, notePath, page, opts));

// v0.65 pipeline: render to a scratch PNG and return its PATH — no read,
// no delete. The native batch builder embeds (and deletes) it without
// the bytes ever crossing the JS thread.
export const capturePagePng = (
  deps: CaptureDeps,
  notePath: string,
  page: number,
  opts?: {skipSave?: boolean; rotateDeg?: number},
): Promise<string | null> =>
  serializeRender(() => renderPageToPng(deps, notePath, page, opts));

const renderPageToPng = async (
  deps: CaptureDeps,
  notePath: string,
  page: number,
  opts?: {skipSave?: boolean; rotateDeg?: number},
): Promise<string | null> => {
  if (!opts?.skipSave) {
    await deps.saveCurrentNote().catch(() => {});
  }
  const dir = await deps.getPluginDirPath().catch(() => null);
  if (typeof dir !== 'string' || dir.length === 0) {
    return null; // no private dir, no render scratch on shared /sdcard (v0.88)
  }
  const pngPath = `${dir}/sp-scratch-${Date.now()}-${scratchN++}.png`;
  try {
    const r = await deps.generateNotePng({
      notePath,
      page,
      times: 1,
      pngPath,
      type: 1,
    });
    if (!succeeded(r)) {
      await deps.deleteFile(pngPath).catch(() => false);
      return null;
    }
    if (opts?.rotateDeg !== undefined && opts.rotateDeg % 360 !== 0) {
      const rr = await rotateNative()
        .rotatePng?.(pngPath, opts.rotateDeg)
        .catch(() => undefined);
      if (rr?.success !== true) {
        await deps.deleteFile(pngPath).catch(() => false);
        return null;
      }
    }
    return pngPath;
  } catch (e) {
    deps.logger?.warn(`pagePng p${page} threw: ${(e as Error).message}`);
    await deps.deleteFile(pngPath).catch(() => false);
    return null;
  }
};

const capturePageImageInner = async (
  deps: CaptureDeps,
  notePath: string,
  page: number,
  opts?: {skipSave?: boolean; rotateDeg?: number},
): Promise<string | null> => {
  // Flush the note first (C1): if `notePath` is the open note with unsaved
  // ink, generateNotePng would otherwise render the last-saved (stale) bitmap
  // and store an empty/stale transcript. Harmless no-op for other notes.
  // Bulk callers (whole-note read, batch render) save the open note ONCE up
  // front and pass skipSave — otherwise this native flush fires per page and
  // starves the UI (a 120-page batch = 120 redundant saveCurrentNote calls).
  if (!opts?.skipSave) {
    await deps.saveCurrentNote().catch(() => {});
  }
  const dir = await deps.getPluginDirPath().catch(() => null);
  if (typeof dir !== 'string' || dir.length === 0) {
    return null; // no private dir, no render scratch on shared /sdcard (v0.88)
  }
  const pngPath = `${dir}/sp-scratch-${Date.now()}-${scratchN++}.png`;
  try {
    const r = await deps.generateNotePng({
      notePath,
      page,
      times: 1,
      pngPath,
      type: 1,
    });
    if (!succeeded(r)) {
      await deps.deleteFile(pngPath).catch(() => false);
      return null;
    }
    if (opts?.rotateDeg !== undefined && opts.rotateDeg % 360 !== 0) {
      // Straighten a landscape/rotated page BEFORE the models see it —
      // OCR and vision read horizontally (v0.52). A FAILED rotate aborts
      // the capture (audit 2026-07-19 D2): the caller would otherwise
      // pay a model run on a sideways (or, pre-atomic-rewrite,
      // half-written) image and stamp the bad transcript with a fresh
      // rev. The page simply stays needing-read and is retried.
      const rr = await rotateNative()
        .rotatePng?.(pngPath, opts.rotateDeg)
        .catch(() => undefined);
      if (rr?.success !== true) {
        deps.logger?.warn(`pageImage p${page}: rotate failed — read skipped`);
        await deps.deleteFile(pngPath).catch(() => false);
        return null;
      }
    }
    const b64 = await readPngBase64(deps, pngPath);
    await deps.deleteFile(pngPath).catch(() => false);
    return b64;
  } catch (e) {
    deps.logger?.warn(`pageImage p${page} threw: ${(e as Error).message}`);
    await deps.deleteFile(pngPath).catch(() => false);
    return null;
  }
};
