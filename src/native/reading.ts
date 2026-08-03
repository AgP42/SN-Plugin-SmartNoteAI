// The READ flow (SPEC-v0.20 §2.2): make sure the TranscriptStore covers
// the requested pages, paying the cloud only for pages it doesn't.
//
// .note  → Smart engine (OCR 4 + automatic vision escalation), page by
//          page. Page renders are device-bound and run SEQUENTIALLY
//          (parallel generateNotePng calls fight over the note app); the
//          network reads overlap in a sliding window of PARALLEL_READS —
//          measured same cost as batching images, 2.7× faster than one
//          multi-image call, and each page lands in the store
//          individually (retry / Stop granularity).
// .pdf   → the whole file to /v1/ocr in ONE call (no 8-image limit).
//
// Money already spent is sacred: every successful page is upserted (and
// the store persisted, debounced) even when a later page fails or the
// user stops mid-run.

import type {CaptureDeps} from './capture';
import {
  capturePageImage,
  capturePagePng,
  serializeRender,
  beginLiveRead,
  endLiveRead,
  readFileB64Native,
  hashFileFnvNative,
} from './capture';
import type {PageText} from '../core/convo/composeContext';
import {sendChat} from '../core/model/mistral';
import {
  buildReaderRequest,
  buildImproveRequest,
  READER_MODEL,
  READER_MAX_TOKENS,
} from '../core/model/reader';
import {ocrPdf, ocrImageSmart} from '../core/model/ocr';
import {fetchAdapter} from './fetchAdapter';
import {yieldToJs} from './nativeSleep';
import {nativeFileFetch, nativePostAvailable} from './nativePostFetch';
import type {FetchFn} from '../core/model/types';
import {bytesToBase64} from '../core/util/base64';
import {loadStore, mutateStore, flushStore} from './transcriptStoreIo';
import {isBlankAnswer} from '../core/model/blankAnswer';
import {readSettings} from './settings';
import {effectiveMode} from '../core/store/autoEngine';
import {
  readPageIds,
  readNotePageRevs,
  readNoteMeta,
  readLandscapePages,
  ensureNoteFresh,
  invalidateNoteCache,
  readFileSize,
} from './noteTranscripts';
import {
  getPage,
  pageNeedsRead,
  upsertPage,
  makePageEntry,
  getDocHash,
  setDocHash,
  setPageIds,
  setDocMeta,
  docMetaEquals,
  touchDoc,
  remapDocPages,
  markDocTouched,
  type LowWord,
  type TranscriptSource,
  type Store,
  type PageEntry,
  isPageLocked,
  isDocLocked,
  looksLikePageId,
  buildPageIdDonors,
  adoptPdfDoc,
} from '../core/store/transcriptStore';

export const PARALLEL_READS = 4;

// v0.87.2 (user, after 3742 doomed render attempts flooded logcat): a render
// failure is almost never page-specific — it means the host cannot render
// this doc type AT ALL (wrong app behind, host gone mid-pass). After this
// many CONSECUTIVE render failures a pass stops trying: the remaining pages
// stay pending for a tick under the right host instead of piling errors.
export const CONSEC_RENDER_BREAK = 3;

// R1 (audit 2026-07-28): a paid read persists via an 800 ms debounced JS
// timer plus a flush at the END of the loop. RN freezes JS timers the moment
// the plugin backgrounds, so a hard kill mid-loop could drop pages already
// paid at Mistral — re-billed on the next sync. Force a durable flush every N
// paid pages to bound that loss window to a few pages, never a whole note/PDF.
export const PAID_FLUSH_EVERY = 8;

// PDF render is host-bound: generateDocImage only works when the DOCUMENT app
// hosts the plugin (a PDF is open). We never force this — a render that can't
// happen leaves the page pending and the SYNC STATUS tells the user to open a
// PDF (v0.86.3: the auto host-switch was removed so the plugin never yanks a
// doc to the foreground while the user works).

export const isNotePath = (path: string): boolean => /\.note$/i.test(path);

// OFF privacy gate, enforced at the READING layer (audit 2026-07-18): it
// used to live only in the chat send flow, so every other entry point that
// reached a paid read (Re-read, Improve, the Library page re-read — and any
// future caller) sent Off files to Mistral without consent AND persisted
// the transcript. A caller that has obtained the user's explicit Off
// consent itself (the chat send flow, which also wipes the entries after
// answering) passes offOk to go through.
export const OFF_READ_REFUSED =
  'This file is set to Off. Switch it to Manual/Auto in the Library to read it.';
const offRefused = async (
  path: string,
  offOk: boolean | undefined,
): Promise<boolean> => {
  if (offOk === true) {
    return false;
  }
  try {
    const st = await readSettings();
    return effectiveMode(st.autoTargets ?? {}, path) === 'off';
  } catch {
    return false; // unreadable settings must never block normal reading
  }
};

export type ReadOutcome = {
  ok: boolean;
  read: number; // pages freshly read (paid) this run
  failed: number[]; // 0-indexed pages that failed
  // Subset of `failed` that never reached the network (the page render came
  // back null/blank — wrong host, transient SDK hiccup). FREE failures: the
  // Auto tick must not spend its paid-failure budget (MAX_PAGE_FAILS) on
  // them, or a few ticks under the wrong host park the page for the session.
  renderFailed?: number[];
  // v0.87.2: the consecutive-render-failure breaker fired — the host cannot
  // render this doc type right now; remaining pages were NOT attempted.
  // Callers looping over several docs should stop too (same missing host).
  renderAborted?: boolean;
  // Pages whose VISION REQUEST itself failed (HTTP / network). They can
  // still appear in storedPages, because a failed vision keeps the OCR
  // text, so "stored and still mistral-ocr" does NOT mean vision had
  // nothing to add (review 2026-08-01 #2).
  visionRefused?: number[];
  reason?: string; // first failure reason (network, HTTP…)
  // 0-indexed pages this run actually WROTE to the store — the OFF
  // ephemeral wipe removes exactly these and NOTHING else (audit C1
  // 2026-07-19: the wipe used to fall back to the whole context
  // selection, destroying older paid/hand-edited entries this run never
  // touched). Absent on early-bail paths = nothing was written.
  storedPages?: number[];
};

// The ONE store writer for transcripts (refactor v0.36 §1.2): stamps and
// text normalization live in makePageEntry, so no call site can forget
// them again.
// userWrite: the user's OWN explicit write (Edit-Save, word fix) — it goes
// through the barrier because the lock freezes the AI, not the user's hands
// (the lock itself is preserved by upsertPage). Every automatic writer that
// reaches a locked page is a bug upstream; the barrier refuses and logs it.
export const upsertTranscript = async (
  path: string,
  page: number,
  text: string,
  source: TranscriptSource,
  stamp: {hash: string; rev?: string},
  low?: LowWord[],
  eph?: boolean,
  userWrite?: boolean,
): Promise<boolean> => {
  const pre = await loadStore();
  if (isPageLocked(pre, path, page) && userWrite !== true) {
    // Phase A (spec S3/S5 final barrier): whatever slipped through the
    // gates, a locked page is never rewritten by the AI. Returns false so
    // a caller never stamps bookkeeping onto a write that did not happen
    // (round 12 #4 — the second lock read raced).
    console.warn(
      '[SmartNoteAI.read]',
      `write REFUSED on locked page ${path.split('/').pop()} p${page + 1}`,
    );
    return false;
  }
  await mutateStore(s => {
    const e = makePageEntry(text, source, stamp, Date.now(), low);
    if (eph === true) {
      e.eph = true; // OFF-consent page: swept at boot if the wipe is skipped
    }
    upsertPage(s, path, page, e, Date.now());
  });
  // A hand correction must hit disk NOW (audit C6 2026-07-19): the 800 ms
  // persist debounce is a JS timer, and RN freezes those the moment the
  // plugin view goes background — exactly what happens right after an
  // Edit-Save. 4th occurrence of the frozen-timer pattern; the rule is
  // "no JS timer carries a critical write", enforced here in the one
  // writer instead of in every Edit UI.
  if (source === 'user') {
    await flushStore();
  }
  return true;
};

// The ONE escalation/improve read (v0.36 §1.2, was 3 near-copies): the
// vision model on the page image, with the previous/OCR text riding as an
// explicitly imperfect hint when non-empty (bench 2026-07-12: +5 global
// points on messy pages). EMPTY-HINT GUARD (same bench, 4/5 repro): a
// "--- hint ---" block with NOTHING under it makes models INVENT text —
// no hint → plain image read.
const escalateRead = (
  fetchFn: FetchFn,
  apiKey: string,
  visionSystem: string,
  imageBase64: string,
  hint: string,
  signal?: AbortSignal,
) =>
  sendChat(
    fetchFn,
    {apiKey, model: READER_MODEL, maxTokens: READER_MAX_TOKENS},
    hint.trim().length > 0
      ? buildImproveRequest(imageBase64, visionSystem, hint.trim())
      : buildReaderRequest(imageBase64, visionSystem),
    signal,
  );

// Page identity: entries are keyed by the .note's stable PAGEID (v0.22.4)
// — deleting/inserting/reordering pages remaps the stored transcripts
// instead of re-reading everything after the change. ONE cached
// whole-file read per note (shared with the RECOGNTEXT reader).
// Realign the store to the note's current page order, then return the
// id per index for validation and for stamping new entries.
//
// FRESHNESS GUARD (device bug 2026-07-12): the firmware flushes the
// .note file LAZILY — right after the user creates/deletes a page, the
// on-disk footer still shows the OLD page list, so the PAGEIDs (and the
// stored RECOGNTEXT) lie. Detector: the SDK's live page count
// (getNoteTotalPageNum) vs the file's. On mismatch: saveCurrentNote()
// (flushes when this note is the open one), drop the note-bytes cache,
// re-read — a few times. If it never converges (note edited on another
// device?), we proceed with the file's view and say so in the log.
const syncPageIds = async (
  deps: CaptureDeps,
  notePath: string,
  force = false,
): Promise<Map<number, string>> => {
  // `force` (Auto, after a footer-signature change): drop the cached
  // snapshot so the comparison below runs against the REAL file. Since
  // v0.36.1 the snapshot cache is content-verified anyway, so this is
  // belt-and-braces, not the correctness mechanism.
  if (force) {
    invalidateNoteCache(notePath);
  }
  await ensureNoteFresh(deps, notePath);
  const ids = await readPageIds(notePath).catch(
    () => new Map<number, string>(),
  );
  if (ids.size === 0) {
    return ids;
  }
  const ordered = Array.from(
    {length: Math.max(...ids.keys()) + 1},
    (_, i) => ids.get(i) ?? '',
  );
  const store = await loadStore();
  // v0.37 smart search: keep the star/keyword snapshot in step. Reads from
  // the SAME cached walk (free); writes ONLY when something changed, so
  // this converges and cannot feed a notify loop.
  const meta = await readNoteMeta(notePath).catch(() => ({
    stars: [] as number[],
    kws: [] as Array<{p: number; t: string}>,
  }));
  if (!docMetaEquals(store.docs[notePath], meta.stars, meta.kws)) {
    await mutateStore(s => setDocMeta(s, notePath, meta.stars, meta.kws));
  }
  const snap = store.docs[notePath]?.pageIds;
  const sameStructure =
    snap !== undefined &&
    snap.length === ordered.length &&
    snap.every((id, i) => id === ordered[i]);
  if (sameStructure) {
    // Same page count AND same PAGEID order: nothing structural happened.
    // READ-ONLY on purpose, twice over:
    //  - no mutateStore (a touch would notify subscribers and feed the
    //    panel's ~3 Hz re-sync loop, bug 2026-07-13);
    //  - and CRUCIALLY no rev re-baseline. An in-place edit moves ONLY the
    //    edited page's block address — pageNeedsRead must SEE that delta.
    //    (Device bug 2026-07-17: Auto forced the old slow path on every
    //    footer change, whose re-baseline stamped the fresh addresses onto
    //    every entry BEFORE pagesNeedingRead compared — the edit was
    //    masked every tick and Auto never updated anything.)
    return ids;
  }
  // STRUCTURAL change (page add/delete/reorder, or first sync): the
  // firmware rewrites the whole file, so EVERY page's address moved.
  // Remap entries by identity and re-baseline the survivors' revs so the
  // reflow is not billed as an edit of every page (bug 2026-07-15:
  // deleting one page used to re-read all 54).
  const revs = await readNotePageRevs(notePath).catch(
    () => new Map<number, string>(),
  );
  await mutateStore(s => {
    const r = remapDocPages(s, notePath, ordered);
    if (r.moved > 0 || r.dropped > 0) {
      console.log(
        '[SmartNoteAI.store]',
        `remap ${notePath.split('/').pop()}: ${r.moved} moved, ${r.dropped} dropped`,
      );
    }
    if (r.refused === true) {
      // Holed walk (partial footer parse): NOTHING from it may be adopted.
      // Re-baselining revs against it stamped a genuinely edited page with
      // its new address and the edit was never read (full review #7). The
      // next complete walk remaps and re-baselines for real.
      return;
    }
    // Structural tracking: the library knows every page of this note
    // (new note, new page, deleted page) even before any paid read.
    setPageIds(s, notePath, ordered);
    for (const [i, id] of ids) {
      const cur = getPage(s, notePath, i);
      if (cur !== null && cur.hash === id) {
        const addr = revs.get(i);
        if (addr !== undefined) {
          cur.rev = addr;
        }
      }
    }
  });
  return ids;
};

// Public wrapper: realign ONE document's stored entries to the live
// page order (follow moves/deletes/inserts). Cheap: one cached file
// read; legacy entries without a PAGEID cannot be followed (they keep
// their index until first re-read stamps them).
export const syncNotePages = async (
  deps: CaptureDeps,
  notePath: string,
  force = false,
): Promise<void> => {
  if (isNotePath(notePath)) {
    await syncPageIds(deps, notePath, force);
  }
};

// Which of `pages` (0-indexed) actually need a paid read right now.
// Beyond "no entry / free stopgap / stale identity", this also catches a
// page whose ink was EDITED in place since the last read: same PAGEID but a
// changed content-rev (its block address in the footer). The rev is a cheap
// footer-only read (~3 native reads), so it stays fast even on big notes.
export const pagesNeedingRead = async (
  deps: CaptureDeps,
  notePath: string,
  pages: number[],
): Promise<number[]> => {
  const ids = await syncPageIds(deps, notePath);
  const revs = await readNotePageRevs(notePath).catch(
    () => new Map<number, string>(),
  );
  const store = await loadStore();
  const docLocked = isDocLocked(store, notePath); // v0.94 whole-doc freeze
  const out: number[] = [];
  // Entries read before v0.25.7 have no `rev`, so their edits could never
  // be detected (and we won't pay to re-read a page that is otherwise
  // fine) — a deadlock. Backfill the CURRENT block address onto them, for
  // FREE (no paid read): it just records "this is the state we already
  // have", so the NEXT edit moves the address and gets caught. One-time
  // per entry; idempotent, so no notify loop.
  const backfill: Array<[number, string]> = [];
  // Phase A (spec S4): if MOST stamped pages' block addresses moved at once
  // while the page ORDER did not, that is a whole-file rewrite (firmware
  // compaction), not dozens of simultaneous edits. Re-baseline silently and
  // read nothing — a false 'edited' verdict now destroys user text, and a
  // compaction storm used to re-bill the whole notebook (round-8 #3).
  {
    let stamped = 0;
    let moved = 0;
    for (const p of pages) {
      const e = getPage(store, notePath, p);
      const cur = revs.get(p);
      if (e !== null && e.rev !== undefined && cur !== undefined &&
          e.hash === (ids.get(p) ?? '')) {
        stamped++;
        if (e.rev !== cur) {
          moved++;
        }
      }
    }
    if (stamped >= 4 && moved > stamped / 2) {
      // Audit 9 #5: this pattern is EITHER a firmware file rewrite OR a
      // legitimate heavy editing session — indistinguishable from here.
      // So only the USER-corrected entries are re-baselined (their text is
      // irreplaceable and the no-proof doctrine already governs them);
      // ordinary pages go through the normal per-page compare below and
      // are re-read — a compaction storm costs one bounded re-read, a real
      // editing session is never silently sealed as 'already read'.
      console.warn(
        '[SmartNoteAI.read]',
        `${notePath.split('/').pop()}: ${moved}/${stamped} block addresses ` +
          'moved at once — user corrections re-baselined, rest re-checked',
      );
      await mutateStore(s2 => {
        for (const p of pages) {
          const e = getPage(s2, notePath, p);
          const cur = revs.get(p);
          if (
            e !== null &&
            e.source === 'user' &&
            e.hash === (ids.get(p) ?? '') &&
            cur !== undefined
          ) {
            e.rev = cur;
          }
        }
        markDocTouched(notePath);
      });
    }
  }
  // Relocation (2026-08-03, user): a page whose PAGEID another doc's entry
  // already covers (page moved/copied between notes, or a whole note moved
  // to a new folder — every page matches) is recovered for FREE instead of
  // re-billed. COPY only: the donor keeps its entry, so a duplicate note
  // costs nothing extra and nothing can be lost. An in-place EDIT is not a
  // candidate (same PAGEID on the entry → the rev compare below re-reads,
  // as it must). Skipped under any lock: frozen means frozen, even for a
  // free write (spec S6).
  let donors: Map<string, PageEntry> | null = null;
  const relocated: Array<[number, PageEntry]> = [];
  for (const p of pages) {
    const entry = getPage(store, notePath, p);
    const pid = ids.get(p) ?? '';
    if (
      !docLocked &&
      entry?.lock !== true &&
      looksLikePageId(pid) &&
      (entry === null || entry.hash !== pid)
    ) {
      if (donors === null) {
        donors = buildPageIdDonors(store, notePath);
      }
      const donor = donors.get(pid);
      if (donor !== undefined) {
        relocated.push([p, donor]);
        continue; // recovered below — never billed
      }
    }
    if (pageNeedsRead(entry, pid, revs.get(p), docLocked)) {
      out.push(p);
    } else if (
      entry !== null &&
      entry.rev === undefined &&
      revs.get(p) !== undefined
    ) {
      backfill.push([p, revs.get(p) as string]);
    }
  }
  if (relocated.length > 0) {
    await mutateStore(s => {
      for (const [p, donor] of relocated) {
        upsertPage(
          s,
          notePath,
          p,
          {
            text: donor.text,
            source: donor.source,
            at: donor.at,
            hash: ids.get(p) as string,
            rev: revs.get(p),
            // The vision-added-nothing marker is rev-keyed: translate it to
            // the DESTINATION identity so the drain never re-bills a page
            // whose vision already settled at the donor.
            va: donor.va !== undefined ? revs.get(p) : undefined,
            low:
              donor.low !== undefined
                ? donor.low.map(w => ({...w}))
                : undefined,
          },
          Date.now(),
        );
      }
      markDocTouched(notePath);
    });
    console.log(
      '[SmartNoteAI.read]',
      `${notePath.split('/').pop()}: ${relocated.length} page(s) recovered ` +
        'by PAGEID (moved/copied — not re-billed)',
    );
  }
  if (backfill.length > 0) {
    await mutateStore(s => {
      for (const [p, rev] of backfill) {
        const e = getPage(s, notePath, p);
        if (e !== null && e.rev === undefined) {
          e.rev = rev;
        }
      }
      // Direct mutation (getPage, not docOf) — the sharded persistence
      // (v0.56) must be told which shard to rewrite.
      markDocTouched(notePath);
    });
  }
  return out;
};

// Current identity (PAGEID) + content-rev of ONE page — the stamps every
// store writer must carry. A 'user' edit stored without them can be lost
// on a page reorder (no identity to follow) and used to be silently
// overwritten by Auto (audit 2026-07-17). Shared by the manual-edit /
// word-fix / OCR-test writers in the UI.
export const pageStamp = async (
  deps: CaptureDeps,
  path: string,
  page: number,
): Promise<{hash: string; rev?: string}> => {
  if (!isNotePath(path)) {
    return {hash: ''}; // PDFs: doc-level byte length stands in
  }
  await ensureNoteFresh(deps, path).catch(() => {});
  const [ids, revs] = await Promise.all([
    readPageIds(path).catch(() => new Map<number, string>()),
    readNotePageRevs(path).catch(() => new Map<number, string>()),
  ]);
  return {hash: ids.get(page) ?? '', rev: revs.get(page)};
};

// Read the given .note pages and store the results. v0.38 (user decision):
// EVERY page goes OCR 4 → Vision, systematically — no escalation heuristic.
// OCR runs first (its text rides as a hint and its word-confidence feeds the
// glossary loop); Vision (ministral-14b, the full user prompt) always
// follows. `force` re-reads pages the store already covers (Re-read button).
export const readNotePages = async (
  deps: CaptureDeps,
  apiKey: string,
  visionSystem: string,
  notePath: string,
  pages: number[],
  opts?: {
    force?: boolean;
    onProgress?: (done: number, total: number) => void;
    shouldStop?: () => boolean;
    signal?: AbortSignal;
    // The caller handled the Off consent itself (chat send flow only).
    offOk?: boolean;
    // v0.52 "Redo rotated": render every page rotated by this many
    // clockwise degrees before reading (manual button). Absent = auto
    // (pages the device flagged landscape are rotated 90°).
    rotateDeg?: number;
    // R3 (audit 2026-07-28): reuse a page's already-stored OCR text as the
    // vision hint and SKIP the paid OCR call. finishVisionLive passes this so
    // "Vision now" no longer re-pays OCR on pages it already OCR'd. Return
    // undefined for a page to read it normally (OCR + vision).
    ocrHint?: (page: number) => {text: string; low?: LowWord[]} | undefined;
    // v0.92.1 (CRITICAL fix): mark written pages as ephemeral OFF content
    // for the boot sweep. MUST be set ONLY for a genuinely Off document.
    // v0.92.0 derived it from offOk — which gatherContext passes
    // unconditionally ("consent was handled") — so every chat-read page of
    // a NORMAL note was marked and the next boot sweep DESTROYED it.
    eph?: boolean;
  },
): Promise<ReadOutcome> => {
  // Honour Stop/abort BEFORE the (now cheap, but still non-zero) sync +
  // page-cover work, so the ⏹ button bails even during the prep phase
  // (bug 2026-07-13: Stop did nothing while the note structure loaded).
  if (opts?.shouldStop?.() || opts?.signal?.aborted) {
    return {ok: false, read: 0, failed: [], reason: 'Stopped.'};
  }
  if (await offRefused(notePath, opts?.offOk)) {
    return {ok: false, read: 0, failed: [], reason: OFF_READ_REFUSED};
  }
  // Flush the open note FIRST (audit 2026-07-18, money bug): everything
  // below — the needing-read decisions, the PAGEIDs and above all the
  // content-revs stamped on the new entries — must describe the POST-flush
  // file. The save used to run just before the render loop, AFTER the revs
  // were read: entries got stamped with pre-save addresses, the next pass
  // saw them all as "edited" and re-paid the whole read (device symptom:
  // 'ToDo.note: needing a paid read=10'). The content-verified snapshot
  // cache re-walks by itself if this save actually changed the file.
  await deps.saveCurrentNote().catch(() => {});
  const todo = opts?.force
    ? pages.slice()
    : await pagesNeedingRead(deps, notePath, pages);
  if (opts?.shouldStop?.() || opts?.signal?.aborted) {
    return {ok: false, read: 0, failed: [], reason: 'Stopped.'};
  }
  if (todo.length === 0) {
    // LRU touch only — no visible change: return false so subscribers are
    // not notified (and the touch rides the next real persist).
    await mutateStore(s => {
      touchDoc(s, notePath, Date.now());
      return false;
    });
    return {ok: true, read: 0, failed: []};
  }
  console.log(
    '[SmartNoteAI.read]',
    `ocr+vision read: ${todo.length}/${pages.length} page(s) of ${notePath
      .split('/')
      .pop()}`,
  );
  const logBlanks = (): void => {
    if (blankSkipped > 0) {
      console.log(
        '[SmartNoteAI.read]',
        `${blankSkipped} blank page(s) marked without a paid read (no ink)`,
      );
    }
    if (unchangedSkipped > 0) {
      console.log(
        '[SmartNoteAI.read]',
        `${unchangedSkipped} page(s) settled free (identical pixels — ` +
          'the file moved, the ink did not)',
      );
    }
  };

  const failed: number[] = [];
  const renderFailed: number[] = [];
  const visionRefused: number[] = [];
  let renderAborted = false;
  let consecRenderFails = 0;
  let firstReason: string | undefined;
  let done = 0;
  let read = 0;
  let blankSkipped = 0;
  let unchangedSkipped = 0;
  const inFlight = new Set<Promise<void>>();
  // Stamp every new entry with its page's stable PAGEID. Going through
  // syncPageIds (not a raw read) so FORCE paths (Re-read) also get the
  // freshness guard + remap — a Re-read right after a page insertion
  // used to stamp the OLD page's id.
  const pageIds = await syncPageIds(deps, notePath);
  // Content-rev per page (block address) so each stored entry remembers the
  // page state it was read at — a later in-place edit moves the address and
  // pagesNeedingRead re-reads it (v0.25.7).
  const pageRevs = await readNotePageRevs(notePath).catch(
    () => new Map<number, string>(),
  );
  // Pages the device flagged landscape (ORIENTATION 1090): straighten
  // their render automatically — free, same walk (v0.52).
  const landscape = await readLandscapePages(notePath).catch(
    () => new Set<number>(),
  );
  if (opts?.shouldStop?.() || opts?.signal?.aborted) {
    return {ok: false, read: 0, failed: [], reason: 'Stopped.'};
  }

  // Pages actually written this run — the caller's OFF ephemeral wipe
  // covers exactly these (audit C1).
  const stored: number[] = [];
  // Diag 2026-07-19 (vanished "unsure word" underlines): count what the
  // OCR API actually returns — one summary line after the loop.
  let diagOcrOk = 0;
  let diagWithScores = 0;
  let diagLowTotal = 0;
  const store = async (
    page: number,
    text: string,
    source: 'medium' | 'mistral-ocr',
    low?: LowWord[],
  ) => {
    const wrote = await upsertTranscript(
      notePath,
      page,
      text,
      source,
      {hash: pageIds.get(page) ?? '', rev: pageRevs.get(page)},
      low,
      opts?.eph === true, // OFF-doc read only — see the eph flag's contract
    );
    if (!wrote) {
      // Round 13 #0: a lock-refused write must not be COUNTED — a counted
      // 'stored' page made the OFF wipe delete the locked old entry, and
      // let the drain seal its vision debt.
      return;
    }
    read++;
    stored.push(page);
    // R1: bound the "paid but not yet flushed" loss window on a hard kill.
    if (read % PAID_FLUSH_EVERY === 0) {
      await flushStore();
    }
  };
  const readOne = async (
    page: number,
    image: string | {pngPath: string},
    // Pixel identity of the render this read is based on (v1.0.4) —
    // stamped on the entry after a successful write so the NEXT rev
    // move can be settled for free when the pixels did not change.
    pixTag: string | null,
  ): Promise<void> => {
    // v0.67 native pipeline: with a PNG path, the body carries a
    // __FILE_B64__ placeholder that Kotlin fills at POST time — the
    // image bytes never enter JS. Same core layers either way.
    const isPath = typeof image !== 'string';
    // Pre-spend lock check (aligns with visionPassPdf): a page locked
    // AFTER the pass started must not cost an OCR+Vision round only to be
    // refused at the store — the collector excluded locked pages at
    // collection time, this covers the in-flight window.
    if (isPageLocked(await loadStore(), notePath, page)) {
      return;
    }
    const ff = isPath ? nativeFileFetch(image.pngPath) : fetchAdapter;
    const imageBase64 = isPath ? '__FILE_B64__' : image;
    let ok = false;
    let reason: string | undefined;
    // Step 1 — OCR 4: gives the hint text + the word-confidence that feeds
    // the "unsure words" highlight and the glossary suggestions. A network
    // failure here is not fatal; Vision reads the image anyway.
    // R3: when the caller already has this page's OCR (a vision-only retry),
    // reuse it and SKIP the paid OCR call — same page, same content, nothing
    // new to learn, and no risk of hiding ink (Vision still reads the image).
    const reuse = opts?.ocrHint?.(page);
    let ocrText: string;
    let low: LowWord[] | undefined;
    let ocrRan: boolean;
    let ocrReason: string | undefined;
    if (reuse !== undefined) {
      ocrText = reuse.text.trim();
      low = reuse.low;
      ocrRan = true; // the OCR ran on a PRIOR pass; its result is in hand
    } else {
      const o = await ocrImageSmart(ff, apiKey, imageBase64, opts?.signal);
      ocrText = o.ok ? o.text.trim() : '';
      low = o.ok ? o.lowWords : undefined;
      ocrRan = o.ok;
      ocrReason = o.ok ? undefined : o.reason;
      if (o.ok) {
        diagOcrOk++;
        if (o.words > 0) {
          diagWithScores++;
        }
        diagLowTotal += o.lowWords.length;
      }
    }
    // Step 2 — Vision, ALWAYS (v0.38). OCR text rides as a hint when it
    // exists; a blank page goes image-only (escalateRead drops the empty
    // hint block — an empty "--- hint ---" makes models invent text).
    const v = await escalateRead(
      ff,
      apiKey,
      visionSystem,
      imageBase64,
      ocrText,
      opts?.signal,
    );
    if (!v.ok) {
      visionRefused.push(page); // the request never landed
    }
    if (v.ok && v.text.trim().length > 0 && !isBlankAnswer(v.text)) {
      // Keep the OCR low-confidence words on the vision entry: they still
      // mark which words to double-check / add to the glossary.
      await store(page, v.text.trim(), 'medium', low);
      ok = true;
    } else if (ocrText.length > 0) {
      // Vision failed or came back empty — the paid OCR text beats nothing.
      await store(page, ocrText, 'mistral-ocr', low);
      ok = true;
    } else if (v.ok && ocrRan) {
      // Genuine blank page: OCR ran and saw nothing, and Vision returned
      // EMPTY or a bare "the page is blank" statement (collecte ① — that
      // sentence used to be stored as a real transcript).
      // Negative-cache it (empty entry, rev stamped) so Auto doesn't
      // re-read it every pass until the ink changes (C3). Guard (audit
      // 2026-07-18): only when the OCR actually RAN — an OCR failure
      // (429, payload) + an empty vision answer must NOT cache a page
      // that may hold real ink; it stays failed and retries.
      await store(page, '', 'mistral-ocr');
      ok = true;
    } else {
      reason = (v.ok ? undefined : v.reason) ?? ocrReason;
    }
    if (!ok) {
      failed.push(page);
      if (firstReason === undefined) {
        firstReason = reason;
      }
    } else if (pixTag !== null && stored.includes(page)) {
      // Pixel identity of THIS text (v1.0.4). Lock-guarded like the PDF
      // twin; stored.includes = the write actually landed (write-truth).
      await mutateStore(st => {
        if (isPageLocked(st, notePath, page)) {
          return false;
        }
        const e = getPage(st, notePath, page);
        if (e === null) {
          return false;
        }
        e.vh = pixTag;
        markDocTouched(notePath);
      });
    }
    done++;
    opts?.onProgress?.(done, todo.length);
    if (isPath) {
      await deps.deleteFile(image.pngPath).catch(() => false);
    }
  };

  // (The note was already flushed at the top of this function — before the
  // ids/revs were read — so the renders below use skipSave.)
  // Live-read marker (re-audit 2026-07-19 R2): while this paid loop
  // renders, the background batch collect DEFERS its wave-2 renders —
  // two flows rendering at once produced partial images that were then
  // billed at Mistral as truth.
  beginLiveRead();
  try {
    for (const page of todo) {
      if (opts?.shouldStop?.() || opts?.signal?.aborted) {
        break;
      }
      // BLANK-page skip (v1.0.2, user GO 2026-08-03): zero elements on the
      // page = no ink, nothing to transcribe — negative-cache it exactly
      // like a paid blank result (same store path: hash+rev stamps, eph and
      // lock write-truth included) without paying the render+OCR+Vision
      // round. Exact by construction (element count, not a pixel
      // heuristic); any probe failure falls through to the normal read.
      if (deps.getElementCounts !== undefined) {
        try {
          const raw = (await deps.getElementCounts(page, notePath)) as
            | number
            | {result?: unknown}
            | null;
          const n =
            typeof raw === 'number' ? raw : (raw?.result as number | undefined);
          if (n === 0) {
            await store(page, '', 'mistral-ocr');
            blankSkipped++;
            done++;
            opts?.onProgress?.(done, todo.length);
            continue;
          }
        } catch {
          // probe failed — read normally, never block a read on the probe
        }
      }
      // Device-bound render, sequential on purpose (skipSave: saved once above).
      // Rotation (v0.52): the manual "Redo rotated" degrees win; otherwise a
      // page the device flagged landscape is straightened by 90°.
      const renderOpts = {
        skipSave: true,
        rotateDeg: opts?.rotateDeg ?? (landscape.has(page) ? 90 : undefined),
      };
      const img: string | {pngPath: string} | null = nativePostAvailable()
        ? await capturePagePng(deps, notePath, page, renderOpts)
            .then(p => (p === null ? null : {pngPath: p}))
            .catch(() => null)
        : await capturePageImage(deps, notePath, page, renderOpts).catch(
            () => null,
          );
      if (opts?.shouldStop?.() || opts?.signal?.aborted) {
        if (img !== null && typeof img !== 'string') {
          await deps.deleteFile(img.pngPath).catch(() => false);
        }
        break;
      }
      if (img === null || (typeof img === 'string' && img.length === 0)) {
        failed.push(page);
        renderFailed.push(page); // free failure — no API call was made
        if (firstReason === undefined) {
          // Surfaced instead of silent (v0.63.4 — device: "Redo does
          // nothing"): DOC-hosted, generateNotePng is a NOTE-app API.
          firstReason =
            'Could not render the page. If the plugin was opened over a ' +
            'PDF/EPUB, note pages cannot be rendered here. Open it from ' +
            'the note.';
        }
        done++;
        opts?.onProgress?.(done, todo.length);
        if (++consecRenderFails >= CONSEC_RENDER_BREAK) {
          renderAborted = true;
          console.log(
            '[SmartNoteAI.read]',
            `${CONSEC_RENDER_BREAK} renders failed in a row — no note host; ` +
              'stopping this pass (the rest waits for the note app)',
          );
          break;
        }
        continue;
      }
      consecRenderFails = 0;
      // v1.0.4 (collecte ②): the append-only rev moves on ANY edit — even
      // write-then-erase that leaves the ink identical. The render is in
      // hand and free: hash it, and if the stored entry carries the SAME
      // pixel identity for the SAME page id, re-stamp the rev and skip
      // the paid read entirely. Never on force (an explicit Redo must
      // re-read), never on a locked page (frozen means frozen).
      const pixTag = await notePixelTag(img).catch(() => null);
      if (pixTag !== null && opts?.force !== true) {
        const sNow = await loadStore();
        const cur = getPage(sNow, notePath, page);
        if (
          cur !== null &&
          cur.lock !== true &&
          cur.hash === (pageIds.get(page) ?? '\u0000') &&
          cur.vh === pixTag
        ) {
          await mutateStore(st => {
            if (isPageLocked(st, notePath, page)) {
              return false;
            }
            const e = getPage(st, notePath, page);
            if (e === null || e.hash !== (pageIds.get(page) ?? '\u0000')) {
              return false;
            }
            e.rev = pageRevs.get(page);
            if (e.va !== undefined) {
              e.va = pageRevs.get(page); // the rev-keyed marker follows
            }
            markDocTouched(notePath);
          });
          unchangedSkipped++;
          done++;
          opts?.onProgress?.(done, todo.length);
          if (typeof img !== 'string') {
            await deps.deleteFile(img.pngPath).catch(() => false);
          }
          continue;
        }
      }
      // Network read joins the sliding window; renders continue meanwhile.
      const p = readOne(page, img, pixTag).finally(() => inFlight.delete(p));
      inFlight.add(p);
      if (inFlight.size >= PARALLEL_READS) {
        await Promise.race(inFlight);
      }
      // Yield the JS thread between pages so a background pass (Auto tick) can't
      // freeze the UI: without this, opening a note's page list while Auto is
      // churning took seconds (render + base64 monopolised the thread).
      // yieldToJs: an immediate, NOT a timer. setTimeout(0) is frozen when
      // the view backgrounds (it wedged a whole tick, audit C2), while
      // sleepHybrid(0) waited for the next heartbeat, up to 2.5 s per page
      // (review 2026-08-01 #5). An immediate is flushed at the end of the
      // current JS batch in both states.
      await yieldToJs();
      // A dead network fails every page the same way — stop burning renders.
      if (firstReason !== undefined && /Network error/i.test(firstReason)) {
        break;
      }
    }
    await Promise.all(inFlight);
    logBlanks();
  } finally {
    endLiveRead();
  }
  if (diagOcrOk > 0) {
    // scores=0 with text ⇒ the optional confidence field is ABSENT from
    // the response; scores>0 with 0 low ⇒ recalibrated above 0.8.
    console.log(
      '[SmartNoteAI.ocr]',
      `diag live: ${diagOcrOk} p OCR'd · word scores on ${diagWithScores} · ` +
        `${diagLowTotal} low(<0.8)` +
        (diagWithScores === 0 ? ' — confidence field ABSENT' : ''),
    );
  }
  if (read > 0) {
    await flushStore(); // paid pages hit disk before we return
  }

  return {
    ok: failed.length === 0,
    read,
    failed: failed.sort((a, b) => a - b),
    // Only when something actually failed to render — keeps the outcome
    // shape stable for the (many) exact-match call sites and tests.
    ...(renderFailed.length > 0
      ? {renderFailed: renderFailed.sort((a, b) => a - b)}
      : {}),
    ...(renderAborted ? {renderAborted: true} : {}),
    ...(visionRefused.length > 0
      ? {visionRefused: visionRefused.sort((a, b) => a - b)}
      : {}),
    reason: firstReason,
    storedPages: stored.sort((a, b) => a - b),
  };
};

// "Vision now" — re-read every OCR-only page (source still 'mistral-ocr': its
// live vision failed once, 429/network, and kept the OCR text) through the
// LIVE engine again. force:true because the pages are already in the store; we
// WANT to redo them through vision, not skip them as "already read".
// R3 (audit 2026-07-28): the page already carries its OCR text, so we pass it
// back as the vision hint and SKIP the paid OCR call — "Vision now" costs the
// vision leg only (~0.05 c€/page), not OCR+vision. And an EMPTY 'mistral-ocr'
// entry is a negative-cached blank, not a pending page: re-reading it just
// re-pays to re-confirm blank, so it is left alone (matches the st.ocrDone
// count the button shows). Genuinely-failed pages stay 'mistral-ocr'.
export const finishVisionLive = async (
  deps: CaptureDeps,
  apiKey: string,
  visionSystem: string,
  opts?: {
    onProgress?: (done: number, total: number) => void;
    shouldStop?: () => boolean;
    // v0.86: restrict the pass to one document type. The SYNC STATUS shows a
    // note bar and a PDF bar with separate "Vision now" actions — each finishes
    // only its own type (and each type needs a different render host).
    kind?: 'note' | 'pdf';
    // v0.87 (Auto vision drain): cap the pages attempted this call — the Auto
    // tick shares its MAX_PAGES_PER_TICK budget with this pass. Dropped pages
    // are counted in `truncated` (drain-continue re-pokes for them).
    limit?: number;
    // v0.87: exclude a page (the tick's per-page vision retry cap, and the
    // currently-displayed page whose render would come back blank).
    pageFilter?: (path: string, page: number) => boolean;
    // v0.87: per-page attempt outcome — ok=true when the vision leg actually
    // promoted the entry past 'mistral-ocr'. NOT called for render failures
    // (free, no API attempt) nor for pages skipped by Stop. The tick's
    // session retry counter hangs on this.
    onPageOutcome?: (path: string, page: number, ok: boolean) => void;
  },
): Promise<{
  read: number;
  pending: number;
  truncated: number;
  notes: number;
  noteBlocked?: boolean;
  pdfBlocked?: boolean;
  // Whether this pass actually had PDF pages to work on: a caller may only
  // trust pdfBlocked when it did (review 2026-08-01 round 2 #6).
  pdfAttempted?: boolean;
  reason?: string;
}> => {
  const store = await loadStore();
  const offTargets = (await readSettings()).autoTargets ?? {};
  const byNote = new Map<string, number[]>();
  const ocrHints = new Map<string, {text: string; low?: LowWord[]}>();
  const byPdf = new Map<string, number[]>(); // Option A: PDFs finish Vision too
  for (const [path, doc] of Object.entries(store.docs)) {
    if (effectiveMode(offTargets, path) === 'off') {
      continue; // privacy: an Off file is never sent onward
    }
    const isPdf = /\.pdf$/i.test(path);
    if (!isNotePath(path) && !isPdf) {
      continue; // only rendered docs (notes + PDFs) have a live vision wave
    }
    if (opts?.kind === 'pdf' && !isPdf) {
      continue; // PDF-only pass
    }
    if (opts?.kind === 'note' && isPdf) {
      continue; // note-only pass
    }
    for (const [k, e] of Object.entries(doc.pages)) {
      if (e.source !== 'mistral-ocr' || e.text.trim().length === 0) {
        continue; // past vision / user-edited, or a negative-cached blank
      }
      const page = Number(k);
      if (!Number.isInteger(page)) {
        continue;
      }
      // v0.88 (audit): a NOTE page whose Vision already failed AT THIS ink
      // rev is left alone until the ink changes — no cross-session paid
      // retry loop on pages Vision cannot improve (pure diagrams…).
      // Phase A: a locked page is not collected — the write barrier would
      // refuse anyway, but the drain must not PAY before finding out.
      if (doc.lock === true || e.lock === true) {
        continue;
      }
      // ONE predicate for all three marker formats (audit #5).
      if (visionSettled(e, {isPdf, docHash: doc.docHash})) {
        continue;
      }
      if (opts?.pageFilter !== undefined && !opts.pageFilter(path, page)) {
        continue; // capped-out / current page — the tick's business, not ours
      }
      if (isPdf) {
        const l = byPdf.get(path) ?? [];
        l.push(page);
        byPdf.set(path, l);
      } else {
        const l = byNote.get(path) ?? [];
        l.push(page);
        byNote.set(path, l);
        ocrHints.set(`${path}#${page}`, {text: e.text, low: e.low});
      }
    }
  }
  // Deterministic order per doc, then trim to the caller's budget. Dropped
  // pages are TRUNCATED, not pending: nothing failed, the next tick's drain
  // just continues where this one stopped.
  for (const m of [byNote, byPdf]) {
    for (const pages of m.values()) {
      pages.sort((a, b) => a - b);
    }
  }
  let truncated = 0;
  if (opts?.limit !== undefined) {
    let budget = Math.max(0, Math.floor(opts.limit));
    for (const m of [byNote, byPdf]) {
      for (const [path, pages] of [...m.entries()]) {
        const keep = pages.slice(0, budget);
        truncated += pages.length - keep.length;
        budget -= keep.length;
        if (keep.length === 0) {
          m.delete(path);
        } else {
          m.set(path, keep);
        }
      }
    }
  }
  const total =
    [...byNote.values()].reduce((n, a) => n + a.length, 0) +
    [...byPdf.values()].reduce((n, a) => n + a.length, 0);
  let read = 0;
  let pending = 0;
  let base = 0;
  let reason: string | undefined;
  // v0.87.2: once a doc's renders break (no host), every later doc of the
  // same kind would fail identically — stop that KIND's section, its pages
  // count as pending and retry under the right host. PER KIND (v0.87.4):
  // the drain now runs both kinds each tick as a capability probe, and a
  // note-side abort must not block the PDF section (or vice versa).
  let noteRenderBlocked = false;
  let pdfRenderBlocked = false;
  for (const [notePath, pages] of byNote) {
    if (opts?.shouldStop?.() || noteRenderBlocked) {
      pending += pages.length;
      continue;
    }
    const r = await readNotePages(deps, apiKey, visionSystem, notePath, pages, {
      force: true,
      shouldStop: opts?.shouldStop,
      onProgress: done => opts?.onProgress?.(base + done, total),
      // R3: hand each page its stored OCR back so readOne skips the paid OCR.
      ocrHint: page => ocrHints.get(`${notePath}#${page}`),
    });
    read += r.read;
    // NOTE branch: Stop-skipped pages are re-collected next drain (display
    // count only; readNotePages surfaces Stop via its reason) — accepted
    // asymmetry with the PDF branch's exact `unattempted` (round 12 #3).
    pending += r.failed.length;
    if (r.renderAborted === true) {
      noteRenderBlocked = true;
      pending += Math.max(0, pages.length - r.read - r.failed.length);
    }
    if (reason === undefined && r.reason !== undefined) {
      reason = r.reason; // first failure reason (e.g. HTTP 401) → UI can name it
    }
    // Per-page outcome: a page is only "vision ok" if its entry moved past
    // 'mistral-ocr' — a vision that failed OR came back empty re-stored the
    // OCR text and stays debt ('medium' is Ministral-read text ONLY, user
    // rule 2026-07-30). Render failures never reached the network → silent.
    {
      const after = await loadStore();
      const stillOcr: number[] = [];
      for (const p of pages) {
        if ((r.renderFailed ?? []).includes(p)) {
          continue;
        }
        if ((r.storedPages ?? []).includes(p)) {
          const src = getPage(after, notePath, p)?.source;
          const promoted = src !== 'mistral-ocr';
          opts?.onPageOutcome?.(notePath, p, promoted);
          if (!promoted && !(r.visionRefused ?? []).includes(p)) {
            // Vision DID run and could not improve the page: worth
            // remembering, so the drain stops paying for it every session.
            stillOcr.push(p);
          }
        } else if (r.failed.includes(p)) {
          // The request never landed (401 / 429 / network / render): the
          // page is still owed a Vision pass. Count it for the session cap,
          // but NEVER write the per-rev marker — review 2026-08-01 #2: a
          // quota outage used to exclude those pages from every future
          // drain, permanently.
          opts?.onPageOutcome?.(notePath, p, false);
        }
        // neither stored nor failed: not attempted (Stop) — no outcome
      }
      // v0.88: remember the ink rev this Vision attempt failed at — the
      // collector skips the page until the rev moves (see above).
      if (stillOcr.length > 0) {
        await mutateStore(s => {
          for (const p of stillOcr) {
            const e = getPage(s, notePath, p);
            // The rev-less marker is '' — matched by the collector's
            // rev-less rule above (round 3 #8: refusing to write it meant a
            // rev-less page was re-billed every session, forever).
            if (
              e !== null &&
              e.source === 'mistral-ocr' &&
              !isPageLocked(s, notePath, p)
            ) {
              e.va = e.rev ?? '';
            }
          }
          markDocTouched(notePath);
        });
      }
    }
    base += pages.length;
  }
  // PDFs: Vision-only pass (visionPassPdf reuses the stored OCR, no re-OCR).
  let pdfAttempted = false;
  for (const [pdfPath, pages] of byPdf) {
    if (opts?.shouldStop?.() || pdfRenderBlocked) {
      pending += pages.length;
      continue;
    }
    pdfAttempted = true;
    const rr = await visionPassPdf(deps, apiKey, visionSystem, pdfPath, pages, {
      shouldStop: opts?.shouldStop,
      onProgress: done => opts?.onProgress?.(base + done, total),
    });
    await flushStore();
    read += rr.read;
    pending += rr.failed.length;
    if (rr.renderAborted) {
      pdfRenderBlocked = true;
    }
    // Round 12 #2: exact — only pages the loop never REACHED are pending;
    // mid-pass settles (hash-skips, empty-vision caches, locks) are not.
    pending += rr.unattempted;
    if (reason === undefined && rr.firstReason !== undefined) {
      reason = rr.firstReason;
    }
    if (opts?.onPageOutcome !== undefined) {
      for (const p of rr.stored) {
        opts.onPageOutcome(pdfPath, p, true);
      }
      for (const p of rr.failed) {
        if (!rr.renderFailed.includes(p)) {
          opts.onPageOutcome(pdfPath, p, false);
        }
      }
    }
    base += pages.length;
  }
  console.log(
    '[SmartNoteAI.visionNow]',
    `read ${read}, pending ${pending}, ${byNote.size + byPdf.size} doc(s)` +
      (truncated > 0 ? `, ${truncated} over budget` : '') +
      (reason ? ` — first reason: ${reason}` : ''),
  );
  return {
    read,
    pending,
    truncated,
    notes: byNote.size + byPdf.size,
    // v0.88.3: per-kind render blockage, so the tick can throttle its probes
    // and the Library can auto-rebind the PDF host.
    noteBlocked: noteRenderBlocked,
    pdfBlocked: pdfRenderBlocked,
    // ATTEMPTED, not merely collected: Stop / an active breaker can skip
    // every entry, and that pass must not clear a real block (round 3 #9).
    pdfAttempted,
    ...(reason ? {reason} : {}),
  };
};


// PDF path: one /v1/ocr call for the whole document, all pages stored.
// docHash (byte length) invalidates the lot when the file changes.
// Since v0.22.8 PDFs escalate too (user decision: "même comportement" —
// recipe photos, book figures): pages the OCR is unsure about are
// rendered via generateDocImage and re-read by the vision model.
export const renderDocPage = (
  deps: CaptureDeps,
  docPath: string,
  page: number,
): Promise<string | null> =>
  // Same one-at-a-time gate as the note renders (re-audit 2026-07-19 R1).
  serializeRender(() => renderDocPageInner(deps, docPath, page));

// v0.65 pipeline: doc-page render to a scratch PNG PATH (no read).
export const renderDocPagePng = (
  deps: CaptureDeps,
  docPath: string,
  page: number,
): Promise<string | null> =>
  serializeRender(async () => {
    const dir = await deps.getPluginDirPath().catch(() => null);
    if (typeof dir !== 'string' || dir.length === 0) {
      return null; // no private dir, no render scratch on /sdcard (v0.88)
    }
    const pngPath = `${dir}/sp-doc-${Date.now()}-${page}.png`;
    try {
      const r = await deps.generateDocImage(docPath, page, pngPath, {
        width: 1404,
        height: 1872,
      });
      const ok =
        !!r &&
        typeof r === 'object' &&
        (r as {success?: unknown}).success === true;
      if (!ok) {
        await deps.deleteFile(pngPath).catch(() => false);
        return null;
      }
      return pngPath;
    } catch {
      await deps.deleteFile(pngPath).catch(() => false);
      return null;
    }
  });

const renderDocPageInner = async (
  deps: CaptureDeps,
  docPath: string,
  page: number,
): Promise<string | null> => {
  const dir = await deps.getPluginDirPath().catch(() => null);
  if (typeof dir !== 'string' || dir.length === 0) {
    return null; // no private dir, no render scratch on shared /sdcard (v0.88)
  }
  const pngPath = `${dir}/sp-doc-${Date.now()}-${page}.png`;
  try {
    const r = await deps.generateDocImage(docPath, page, pngPath, {
      width: 1404,
      height: 1872,
    });
    const ok =
      !!r && typeof r === 'object' && (r as {success?: unknown}).success === true;
    if (!ok) {
      await deps.deleteFile(pngPath).catch(() => false);
      return null;
    }
    const native = await readFileB64Native(pngPath);
    if (native !== null) {
      await deps.deleteFile(pngPath).catch(() => false);
      return native;
    }
    const res = await deps.fetchFn(`file://${pngPath}`);
    if (!res.ok) {
      await deps.deleteFile(pngPath).catch(() => false);
      return null;
    }
    const buf = await res.arrayBuffer();
    await deps.deleteFile(pngPath).catch(() => false);
    return bytesToBase64(new Uint8Array(buf));
  } catch {
    await deps.deleteFile(pngPath).catch(() => false);
    return null;
  }
};

// v0.82 (user): handwritten annotations live in a sidecar "<pdf>.mark".
// The PDF's byte length alone can't see an annotation edit (the .mark file
// changes, the PDF doesn't), so the doc "hash" folds in the .mark size —
// editing annotations then re-triggers a read. pdfCovered only checks the
// hash is non-empty, so the `|m…` suffix is safe.
export const markFilePath = (pdfPath: string): string => `${pdfPath}.mark`;
// Phase B: the doc hash identifies the PRINTED bytes only. Annotations are
// per-page (each page's `vh` pixel hash); the .mark byte size is only a
// doorbell (DocEntry.markSz). Pre-B stamps carried "bytes|m<size>" — the
// helpers below tolerate them READ-ONLY, so the existing store never
// triggers a paid re-read on upgrade.
export const pdfDocHash = (pdfSize: number, _markSize = 0): string =>
  `${pdfSize}`;

export const pdfPrintedCovered = (
  doc: {docHash: string} | undefined,
  bytes: number,
): boolean => {
  if (doc === undefined) {
    return false;
  }
  const bar = doc.docHash.indexOf('|');
  const stored = bar >= 0 ? doc.docHash.slice(0, bar) : doc.docHash;
  return stored === String(bytes);
};

export const pdfMarkSzOf = (
  doc: {docHash: string; markSz?: number} | undefined,
): number => {
  if (doc === undefined) {
    return 0;
  }
  if (doc.markSz !== undefined) {
    return doc.markSz;
  }
  const m = doc.docHash.match(/\|m(\d+)$/);
  return m !== null ? Number(m[1]) : 0;
};

// The page indices carrying handwritten annotations (accepts the PDF path;
// the SDK finds the .mark sidecar). NULL on any error or missing SDK —
// distinct from [] (genuinely no annotations): a caller about to stamp an
// annotation revision as handled must NOT do so on an error (round 3 #4:
// stamping over a swallowed SDK hiccup lost the annotations forever).
export const getMarkPagesList = async (
  deps: CaptureDeps,
  pdfPath: string,
): Promise<number[] | null> => {
  if (deps.getMarkPages === undefined) {
    // The SDK method does not exist on this build: there is no readable
    // ink layer AT ALL, so "no annotated pages" is the truth (compositing
    // would be impossible anyway). Distinct from an ERROR below, where the
    // layer exists but could not be listed — that must defer, not lie.
    return [];
  }
  try {
    const raw = await deps.getMarkPages(pdfPath);
    const res = (raw as {result?: unknown})?.result ?? raw;
    return Array.isArray(res)
      ? res.filter((n): n is number => typeof n === 'number')
      : null;
  } catch {
    return null;
  }
};

// Per-page annotation identity: FNV-1a over the rendered page image (the
// same composited PNG the vision model would see). Local and free — no
// Mistral call is ever needed to decide whether a page changed. Round 3
// redesign: the global .mark byte size was ONE identity for ALL pages (one
// new stroke re-billed every annotated page, and sizes can repeat).
export const fnvHex = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
};

export const pageMarkHash = (imageB64: string): string => `mh:${fnvHex(imageB64)}`;

// NOTE-page pixel identity (v1.0.4, collecte ②: write-then-erase used to
// re-bill an unchanged page — the append-only rev moves on ANY edit even
// when the ink ends up identical). Two domains, tagged apart: the JS
// pipeline hashes the base64 string, the native pipeline hashes the PNG
// bytes on the Kotlin side (they never mix on one device — the pipeline
// choice is constant per binary). null = no tag, the check is skipped.
export const notePixelTag = async (
  img: string | {pngPath: string},
): Promise<string | null> => {
  if (typeof img === 'string') {
    return img.length > 0 ? `nh64:${fnvHex(img)}` : null;
  }
  const h = await hashFileFnvNative(img.pngPath);
  return h === null ? null : `nh:${h}`;
};

// Render a PDF page to a base64 PNG; when `annotated`, composite the .mark
// ink over it (multiply) so the vision model sees the page + annotations
// together — the same image the DOC reader shows on screen.
export const renderDocPageWithMarks = async (
  deps: CaptureDeps,
  pdfPath: string,
  page: number,
  annotated: boolean,
): Promise<string | null> => {
  const docPng = await renderDocPagePng(deps, pdfPath, page);
  if (docPng === null) {
    return null;
  }
  try {
    if (
      annotated &&
      deps.generateMarkThumbnails !== undefined &&
      deps.compositePng !== undefined
    ) {
      const dir = (await deps.getPluginDirPath().catch(() => null)) ?? '';
      const markPng = dir.length === 0 ? '' : `${dir}/sp-mark-${Date.now()}-${page}.png`;
      const mr = await deps
        .generateMarkThumbnails(markFilePath(pdfPath), page, markPng, {
          width: 1404,
          height: 1872,
        })
        .catch(() => null);
      const markOk =
        !!mr && typeof mr === 'object' && (mr as {success?: unknown}).success === true;
      if (markOk) {
        // Composite in place (out = docPng). On failure we keep the plain
        // page — better than nothing.
        await deps.compositePng(docPng, markPng, docPng).catch(() => null);
      }
      await deps.deleteFile(markPng).catch(() => false);
    }
    const native = await readFileB64Native(docPng);
    if (native !== null) {
      return native;
    }
    const res = await deps.fetchFn(`file://${docPng}`);
    if (!res.ok) {
      return null;
    }
    return bytesToBase64(new Uint8Array(await res.arrayBuffer()));
  } finally {
    await deps.deleteFile(docPng).catch(() => false);
  }
};

// v0.82 (user, "+Vision" button): force a Vision read of ONE PDF page —
// renders the page (with annotations composited if present) and reads it
// with the vision model, overriding the OCR-only text. Reads schemas the
// OCR misses AND handwritten annotations. Paid, on demand.
// Audit 2026-08-02 #1: this is a PAID read like any other — it must pass
// the same Off gate as readNotePages / readPdf. It did not, so the
// Library's "Redo AI transcript" on an Off PDF page sent it to Mistral and
// stored the result permanently.
export const readPdfPageVision = async (
  deps: CaptureDeps,
  apiKey: string,
  visionSystem: string,
  pdfPath: string,
  page: number,
  opts?: {signal?: AbortSignal; offOk?: boolean; eph?: boolean},
): Promise<ReadOutcome> => {
  if (await offRefused(pdfPath, opts?.offOk)) {
    return {ok: false, read: 0, failed: [page], reason: OFF_READ_REFUSED};
  }
  const marks = await getMarkPagesList(deps, pdfPath);
  if (marks === null) {
    // Round 11 #1: an ERROR listing the ink layer must defer — reading the
    // page un-composited would bill for a transcript missing the user's
    // handwriting, then re-bill later (no pixel identity recorded).
    return {
      ok: false,
      read: 0,
      failed: [page],
      reason: 'Annotation layer unavailable — try again.',
    };
  }
  const annotated = marks.includes(page);
  beginLiveRead();
  try {
    const img = await renderDocPageWithMarks(deps, pdfPath, page, annotated);
    if (img === null) {
      return {ok: false, read: 0, failed: [page], reason: 'render failed'};
    }
    const store = await loadStore();
    const hint = getPage(store, pdfPath, page)?.text ?? '';
    const v = await escalateRead(
      fetchAdapter,
      apiKey,
      visionSystem,
      img,
      hint,
      opts?.signal,
    );
    if (v.ok && v.text.trim().length > 0 && !isBlankAnswer(v.text)) {
      const wrote = await upsertTranscript(
        pdfPath,
        page,
        v.text.trim(),
        'medium',
        {hash: ''},
        undefined,
        opts?.eph === true,
      );
      if (!wrote) {
        return {ok: false, read: 0, failed: [page], reason: 'Page is locked.'};
      }
      if (annotated && wrote) {
        // Round 10 #3: record which pixels this text came from, exactly
        // like the automatic pass — or the next doorbell re-bills a page
        // whose pixels did not change. Round 11 #3: skipped if the page
        // was locked mid-read (the upsert above refused, and stamping a
        // fresh identity onto the OLD text would lie).
        const tag = pageMarkHash(img);
        await mutateStore(st => {
          if (isPageLocked(st, pdfPath, page)) {
            return false; // doc/page locked between write and stamp
          }
          const e = getPage(st, pdfPath, page);
          if (e !== null) {
            e.vh = tag;
          }
          markDocTouched(pdfPath);
        });
      }
      return {ok: true, read: 1, failed: []};
    }
    return {
      ok: false,
      read: 0,
      failed: [page],
      reason: (v as {reason?: string}).reason ?? 'Vision returned nothing.',
    };
  } finally {
    endLiveRead();
  }
};

// PDF path — OCR-first for printed text (v0.38: OCR 4 is strongest and
// cheapest on print — one /v1/ocr call reads the whole doc in column
// order). Two vision passes on top (v0.82): the rare OCR-flagged
// photo/figure page, AND every page carrying handwritten annotations
// (composited so the model reads them). `visionSystem` drives both.
// Pages of a doc (note or PDF) that have OCR text but no Vision yet (source
// 'mistral-ocr', non-empty) — the "Vision to retry" queue. Used to resume
// Vision without re-OCR (Option A, 2026-07-29; generic since v0.87: the Auto
// tick drains the note-side debt with it too).
// Pages of ANY document still owed a Vision pass. Audit 2026-08-02 #8:
// the PDF-only variant below was used as the "is this doc finished?" test
// for notes too, where docHash is '' so no marker ever matched and a
// Manual note's Sync-now order was never released. This one asks the right
// question per kind.
export const pagesOwedVision = (store: Store, path: string): number[] => {
  const doc = store.docs[path];
  if (doc === undefined) {
    return [];
  }
  const isPdf = !isNotePath(path);
  return (Object.entries(doc.pages) as [string, PageEntry][])
    .filter(([, e]) => e.source === 'mistral-ocr' && e.text.trim().length > 0)
    .filter(([, e]) => !visionSettled(e, {isPdf, docHash: doc.docHash}))
    .filter(([k]) => !isPageLocked(store, path, Number(k)))
    .map(([k]) => Number(k))
    .filter(n => Number.isInteger(n))
    .sort((a, b) => a - b);
};

export const pendingVisionPages = (
  store: Store,
  pdfPath: string,
): number[] => {
  const doc = store.docs[pdfPath];
  if (doc === undefined) {
    return [];
  }
  return (Object.entries(doc.pages) as [string, PageEntry][])
    .filter(([, e]) => e.source === 'mistral-ocr' && e.text.trim().length > 0)
    // Locks: same rule as pagesOwedVision, so the tick's covered test and
    // the Sync-now release can never disagree again (round-8 #7).
    .filter(([, e]) => doc.lock !== true && e.lock !== true)
    // Settled = vision already ran on this content and had nothing to add,
    // in EITHER of the PDF marker formats (audit #5).
    .filter(([, e]) => !visionSettled(e, {isPdf: true, docHash: doc.docHash}))
    .map(([k]) => Number(k))
    .filter(n => Number.isInteger(n))
    .sort((a, b) => a - b);
};

// ---- the `va` marker: ONE reader, three writers ----------------------
// `va` records "Vision already ran on this page's CURRENT content and had
// nothing to add". Its value identifies that content, and the identity
// differs by page kind:
//   note page          -> its ink rev ('' when the note has no rev yet)
//   annotated PDF page -> 'mh:<hash of the rendered page+ink image>'
//   plain PDF page     -> 'd:<the document hash it was read at>'
// Audit 2026-08-02 #5: each reader only understood its own format, so an
// annotated PDF page carrying 'mh:…' looked unmarked to the drain (which
// re-billed it and overwrote the marker with 'd:…'), and vice versa. This
// single predicate understands all three, and NOTHING else may test `va`.
export const visionSettled = (
  e: PageEntry,
  ctx: {isPdf: boolean; docHash: string},
): boolean => {
  if (e.va === undefined) {
    return false;
  }
  if (!ctx.isPdf) {
    return e.rev !== undefined ? e.va === e.rev : e.va === '';
  }
  // Plain PDF page: settled at this document revision. Both sides are
  // normalised to the printed-bytes prefix, so markers written before
  // Phase B ("d:bytes|mNN") keep settling after the doorbell migration.
  if (e.va.startsWith('d:')) {
    return e.va.slice(2).split('|')[0] === ctx.docHash.split('|')[0];
  }
  // Annotated PDF page ('mh:<pixel hash>'): the vision pass owns it — it
  // re-renders and re-checks the hash itself when the .mark doorbell
  // moves. For every other caller (drain collector, pending counters) the
  // page is settled: nothing else may spend on it.
  return e.va.startsWith('mh:');
};

// Vision pass over a set of PDF pages (Option A: every page gets Vision, like a
// note). Reuses each page's STORED OCR text as the hint and SKIPS the paid OCR
// (already done by the whole-file /v1/ocr). Skips pages already at 'medium'
// (Vision done) or 'user' (hand-edited), so a resume never re-pays a done page.
// Annotated pages composite their .mark ink into the render.
const visionPassPdf = async (
  deps: CaptureDeps,
  apiKey: string,
  visionSystem: string,
  pdfPath: string,
  pages: number[],
  opts?: {
    signal?: AbortSignal;
    shouldStop?: () => boolean;
    onProgress?: (done: number, total: number) => void;
    // Full review #3: an Off-consent read marks its pages for the boot sweep.
    eph?: boolean;
    // Round 10 #5: the caller may pass the annotated-page list it already
    // fetched; a second divergent fetch treated an SDK error as "no
    // annotations" and read annotated pages without their ink composited.
    annotated?: ReadonlySet<number>;
  },
): Promise<{
  read: number;
  failed: number[];
  renderFailed: number[]; // subset of failed: no API attempt (free)
  renderAborted: boolean; // circuit breaker fired — the host can't render
  // Stop / abort broke the loop: the remaining pages were NOT attempted.
  // A caller settling a doorbell on "no failures" MUST also require this
  // to be false (self-caught before audit 9: Stop used to seal an
  // annotation change away).
  interrupted: boolean;
  // EXACTLY how many pages the loop never reached (round 12 #2: the old
  // pages-minus-read-minus-failed arithmetic counted mid-pass settles —
  // hash-skips, empty-vision caches, lock skips — as pending).
  unattempted: number;
  // Pages skipped because a LOCK landed mid-pass (round 14 #1): the
  // doorbell must NOT settle over them — their ink was never stored.
  lockSkipped: number[];
  stored: number[];
  firstReason?: string;
}> => {
  let annotated: ReadonlySet<number>;
  if (opts?.annotated !== undefined) {
    annotated = opts.annotated;
  } else {
    const marks = await getMarkPagesList(deps, pdfPath);
    if (marks === null) {
      // Cannot KNOW which pages carry ink: reading them un-composited
      // would store wrong text and a lying pixel identity. Defer the
      // whole pass — free, and the debt is retried next time.
      console.log(
        '[SmartNoteAI.read]',
        'vision pass: annotated-page list unavailable, deferred',
      );
      return {
        read: 0,
        failed: [],
        renderFailed: [],
        renderAborted: false,
        interrupted: true,
        unattempted: pages.length,
        lockSkipped: [],
        stored: [],
      };
    }
    annotated = new Set(marks);
  }
  const store0 = await loadStore();
  const failed: number[] = [];
  const renderFailed: number[] = [];
  const stored: number[] = [];
  let read = 0;
  let firstReason: string | undefined;
  let consecRenderFails = 0;
  let renderAborted = false;
  let interrupted = false;
  let processed = 0;
  const lockSkipped: number[] = [];
  // PDF rendering only works when the DOCUMENT app hosts the plugin. We do NOT
  // force a host switch anymore (v0.86.3, user): the plugin must never yank a
  // PDF back to the foreground while you use your device. A page that can't
  // render just stays pending, and the SYNC STATUS tells you to open a PDF —
  // the pass resumes when you do.
  beginLiveRead();
  try {
    for (const page of pages) {
      if (opts?.signal?.aborted || opts?.shouldStop?.()) {
        interrupted = true;
        break;
      }
      processed++;
      const cur = getPage(store0, pdfPath, page);
      const isAnn = annotated.has(page);
      if (isPageLocked(await loadStore(), pdfPath, page)) {
        lockSkipped.push(page); // the user's freeze — and the doorbell hears it
        continue;
      }
      if (cur?.source === 'user') {
        // A hand-corrected page carries no pixel identity to compare
        // against (the text is the user's, not vision's): without PROOF of
        // change it is never touched. Explicit Redo remains available.
        continue;
      }
      if (!isAnn && cur?.source === 'medium') {
        continue; // plain page, Vision done — its pixels only change with the bytes
      }
      const img = await renderDocPageWithMarks(deps, pdfPath, page, isAnn);
      if (img === null) {
        failed.push(page);
        renderFailed.push(page); // free failure — no API call was made
        firstReason =
          firstReason ??
          'Could not render a PDF page: open a PDF in the reader, then retry.';
        if (++consecRenderFails >= CONSEC_RENDER_BREAK) {
          renderAborted = true;
          console.log(
            '[SmartNoteAI.read]',
            `${CONSEC_RENDER_BREAK} renders failed in a row — no PDF host; ` +
              'stopping this Vision pass (the rest waits for a PDF to be open)',
          );
          break;
        }
        continue;
      }
      consecRenderFails = 0;
      // Phase B: an ANNOTATED page's identity is the hash of the image we
      // just rendered (free). Unchanged pixels never reach the paid model —
      // whatever the .mark byte size did.
      const annTag = isAnn ? pageMarkHash(img) : null;
      if (annTag !== null && (cur?.vh === annTag || cur?.va === annTag)) {
        continue;
      }
      const v = await escalateRead(
        fetchAdapter,
        apiKey,
        visionSystem,
        img,
        cur?.text ?? '',
        opts?.signal,
      );
      if (v.ok && v.text.trim().length > 0 && !isBlankAnswer(v.text)) {
        const wrote = await upsertTranscript(
          pdfPath,
          page,
          v.text.trim(),
          'medium',
          {hash: ''},
          cur?.low,
          opts?.eph === true,
        );
        if (!wrote) {
          lockSkipped.push(page); // locked mid-flight (round 13 #1 / 14 #1)
          continue;
        }
        if (annTag !== null) {
          await mutateStore(st => {
            if (isPageLocked(st, pdfPath, page)) {
              return false; // doc/page locked between write and stamp
            }
            const e = getPage(st, pdfPath, page);
            if (e !== null) {
              e.vh = annTag; // the pixels this vision text was made from
            }
            markDocTouched(pdfPath);
          });
        }
        read++;
        stored.push(page);
        if (read % PAID_FLUSH_EVERY === 0) {
          await flushStore(); // R1: bound the loss window on a hard kill
        }
        opts?.onProgress?.(read, pages.length);
      } else if (v.ok) {
        if (isPageLocked(await loadStore(), pdfPath, page)) {
          lockSkipped.push(page); // lock landed during the vision call
          continue;
        }
        // The request LANDED and vision had nothing to add (a full-page
        // figure): remember it durably, keyed to the doc's current hash.
        // Without this the page was re-billed 3 attempts per SESSION,
        // every session, forever (full review 2026-08-02 #8 — the
        // in-memory fail cap re-arms at each restart).
        const dh = getDocHash(await loadStore(), pdfPath);
        await mutateStore(st => {
          // Round 14 #2/#7: doc-aware, BEFORE any entry creation, and an
          // exact `false` so a refusal schedules no persist/notify.
          if (isPageLocked(st, pdfPath, page)) {
            return false;
          }
          let e = getPage(st, pdfPath, page);
          if (e === null && annTag !== null) {
            // An annotated page the whole-doc OCR produced nothing for:
            // create the negative-cache entry so the marker has a home.
            upsertPage(
              st,
              pdfPath,
              page,
              makePageEntry('', 'mistral-ocr', {hash: ''}, Date.now()),
              Date.now(),
            );
            e = getPage(st, pdfPath, page);
          }
          if (e !== null && e.source === 'mistral-ocr') {
            // Annotated: keyed to ITS pixels. Plain: keyed to the doc.
            e.va = annTag ?? `d:${dh}`;
          } else if (e !== null && e.source === 'medium' && annTag !== null) {
            // Audit 9 #2: a 'medium' annotated page whose recheck returned
            // empty keeps its old text — but the CURRENT pixels must be
            // recorded, or every future doorbell re-bills this page.
            e.vh = annTag;
          }
          markDocTouched(pdfPath);
        });
      } else {
        failed.push(page);
        firstReason =
          firstReason ??
          (v as {reason?: string}).reason ??
          'Vision returned nothing.';
      }
    }
  } finally {
    endLiveRead();
  }
  return {
    read,
    failed: failed.sort((a, b) => a - b),
    renderFailed: renderFailed.sort((a, b) => a - b),
    renderAborted,
    interrupted,
    unattempted: Math.max(0, pages.length - processed),
    lockSkipped,
    stored,
    firstReason,
  };
};

// Covered PDF (printed bytes unchanged): finish any pages still awaiting
// Vision WITHOUT re-OCR — and when the .mark doorbell moved, RE-CHECK the
// annotated pages (Phase B: visionPassPdf renders them for free and their
// per-page pixel hash decides which ones actually changed).
const resumePdfVision = async (
  deps: CaptureDeps,
  apiKey: string,
  visionSystem: string,
  pdfPath: string,
  store: Store,
  opts?: {signal?: AbortSignal; eph?: boolean; markSize?: number},
): Promise<ReadOutcome> => {
  const pending = pendingVisionPages(store, pdfPath);
  const doc = store.docs[pdfPath];
  const liveMark = opts?.markSize ?? 0;
  const doorbell = doc !== undefined && pdfMarkSzOf(doc) !== liveMark;
  let recheck: number[] = [];
  let annotatedList: number[] | null = null;
  let anyLockedAnnotated = false;
  // The doorbell may only settle when the annotated-page list was READ:
  // an SDK hiccup must never seal an annotation change away.
  let listOk = false;
  if (doorbell) {
    const marks = await getMarkPagesList(deps, pdfPath);
    if (marks === null) {
      console.log(
        '[SmartNoteAI.read]',
        'annotation recheck: page list unavailable, deferred',
      );
    } else {
      listOk = true;
      annotatedList = marks;
      // Round 10 #8: a LOCKED page is excluded from the recheck AND holds
      // the doorbell open — settling over it would seal its annotation
      // change even after an unlock. Free to keep open: unchanged pages
      // hash-skip on every re-entry.
      const lockedOnes = new Set(
        marks.filter(p2 => isPageLocked(store, pdfPath, p2)),
      );
      anyLockedAnnotated = lockedOnes.size > 0;
      const pendingSet = new Set(pending);
      recheck = marks.filter(p2 => !pendingSet.has(p2) && !lockedOnes.has(p2));
    }
  }
  const settleDoorbell = async (): Promise<void> => {
    await mutateStore(s2 => {
      const d2 = s2.docs[pdfPath];
      if (d2 !== undefined) {
        d2.markSz = liveMark;
        d2.docHash = d2.docHash.split('|')[0]; // shed the legacy suffix
      }
      markDocTouched(pdfPath);
    });
  };
  const todo = [...pending, ...recheck].sort((a, b) => a - b);
  if (todo.length === 0) {
    if (doorbell && listOk && !anyLockedAnnotated) {
      // Round 11 #2: same guard as the main settle — an all-locked
      // annotated doc must keep its doorbell open for the unlock.
      await settleDoorbell();
    }
    return {ok: true, read: 0, failed: []};
  }
  const rr = await visionPassPdf(deps, apiKey, visionSystem, pdfPath, todo, {
    ...opts,
    ...(annotatedList !== null ? {annotated: new Set(annotatedList)} : {}),
  });
  // Settle only when the list was read AND every page was actually
  // attempted (annotated ⊆ pending ∪ recheck, so a clean pass covered them
  // all). A render break or a refused request leaves the doorbell open —
  // re-entry is cheap, unchanged pages hash-skip.
  if (
    doorbell &&
    listOk &&
    !anyLockedAnnotated &&
    rr.lockSkipped.length === 0 &&
    !rr.renderAborted &&
    !rr.interrupted &&
    rr.failed.length === 0
  ) {
    await settleDoorbell();
  }
  await flushStore();
  console.log(
    '[SmartNoteAI.read]',
    `PDF resume: ${rr.read}/${todo.length} page(s) finished with Vision` +
      (recheck.length > 0 ? ` (+${recheck.length} annotated re-checked)` : ''),
  );
  return {
    ok: rr.failed.length === 0,
    read: rr.read,
    failed: rr.failed,
    ...(rr.renderAborted ? {renderAborted: true} : {}),
    storedPages: rr.stored,
    ...(rr.firstReason !== undefined ? {reason: rr.firstReason} : {}),
  };
};

export const readPdf = async (
  deps: CaptureDeps,
  apiKey: string,
  visionSystem: string,
  pdfPath: string,
  // skipVision (v0.87 host split): the OCR leg (/v1/ocr on the file bytes) is
  // host-independent, but every Vision leg renders via generateDocImage,
  // which only works under a PDF host. Callers that know the current host
  // cannot render (note host, no doc open) pass true: the OCR runs and is
  // stored/stamped normally, pages stay 'mistral-ocr', and the Vision debt is
  // drained automatically at the next tick under a PDF host.
  opts?: {
    signal?: AbortSignal;
    force?: boolean;
    offOk?: boolean;
    skipVision?: boolean;
    // Progress heartbeat for the caller's tick-lock freshness (round 3 #6:
    // a long healthy PDF pass with no progress signal got reclaimed and
    // re-billed by a second tick).
    onProgress?: () => void;
    // v0.92.1: ephemeral OFF-doc marking — ONLY for a genuinely Off doc
    // (never derived from offOk; see readNotePages' eph contract).
    eph?: boolean;
  },
): Promise<ReadOutcome> => {
  if (await offRefused(pdfPath, opts?.offOk)) {
    return {ok: false, read: 0, failed: [], reason: OFF_READ_REFUSED};
  }
  // v0.82: the .mark size folds into the doc hash so an annotation edit
  // (which leaves the PDF bytes untouched) still re-triggers a read.
  const markSize =
    (await readFileSize(markFilePath(pdfPath)).catch(() => 0)) ?? 0;
  let b64 = '';
  let useNativePost = false;
  let byteLen: number;
  try {
    // Cheap size stat FIRST (v0.63.2): the docHash early-return used to
    // pull the WHOLE PDF into JS memory just to learn its byte length —
    // on every chat send touching a covered PDF. readFileSize is the
    // same signal the auto tick already compares docHash against.
    let statSize: number | null = null;
    try {
      statSize = await readFileSize(pdfPath);
    } catch {
      statSize = null;
    }
    if (statSize !== null && statSize > 0) {
      byteLen = statSize;
      const store = await loadStore();
      // Adoption (2026-08-03, user): a moved/copied PDF (same name, same
      // printed bytes) inherits its transcripts from the old path instead
      // of being re-billed. In-memory singleton: the covered check below
      // sees the adopted pages immediately.
      if (!opts?.force) {
        let adopted = false;
        await mutateStore(s => {
          adopted = adoptPdfDoc(s, pdfPath, byteLen, Date.now());
          return adopted;
        });
        if (adopted) {
          console.log(
            '[SmartNoteAI.read]',
            `${pdfPath.split('/').pop()}: transcripts adopted by identity ` +
              '(moved/copied PDF — not re-billed)',
          );
        }
      }
      if (
        !opts?.force &&
        pdfPrintedCovered(store.docs[pdfPath], byteLen)
      ) {
        await mutateStore(s => {
          touchDoc(s, pdfPath, Date.now()); // LRU only — see the note branch
          return false;
        });
        // Printed bytes covered: no re-OCR ever. The unified resume pass
        // finishes any Vision debt AND re-checks annotated pages when the
        // .mark doorbell moved (Phase B: their per-page pixel hash decides,
        // locally and for free, which ones actually changed).
        if (opts?.skipVision === true) {
          return {ok: true, read: 0, failed: []};
        }
        return resumePdfVision(deps, apiKey, visionSystem, pdfPath, store, {
          signal: opts?.signal,
          eph: opts?.eph === true,
          markSize,
        });
      }
      // Option A #3 (2026-07-29): with the native file POST, the PDF bytes are
      // base64-STREAMED into the OCR request in Kotlin and NEVER enter the JS
      // heap — the whole-PDF base64 (~40 MB) that OOM-crashed the plugin is gone.
      if (nativePostAvailable()) {
        useNativePost = true;
      } else {
        const native = await readFileB64Native(pdfPath);
        if (native !== null) {
          b64 = native;
        } else {
          const res = await fetch(`file://${pdfPath}`);
          if (!res.ok) {
            return {ok: false, read: 0, failed: [], reason: 'Cannot read the PDF.'};
          }
          b64 = bytesToBase64(new Uint8Array(await res.arrayBuffer()));
        }
      }
    } else {
      // No size stat available: the pre-v0.63.2 path, unchanged.
      const res = await fetch(`file://${pdfPath}`);
      if (!res.ok) {
        return {ok: false, read: 0, failed: [], reason: 'Cannot read the PDF.'};
      }
      const buf = await res.arrayBuffer();
      byteLen = buf.byteLength;
      const store = await loadStore();
      if (
        !opts?.force &&
        pdfPrintedCovered(store.docs[pdfPath], byteLen)
      ) {
        await mutateStore(s => {
          touchDoc(s, pdfPath, Date.now()); // LRU only — see the note branch
          return false;
        });
        // Printed bytes covered: no re-OCR ever. The unified resume pass
        // finishes any Vision debt AND re-checks annotated pages when the
        // .mark doorbell moved (Phase B: their per-page pixel hash decides,
        // locally and for free, which ones actually changed).
        if (opts?.skipVision === true) {
          return {ok: true, read: 0, failed: []};
        }
        return resumePdfVision(deps, apiKey, visionSystem, pdfPath, store, {
          signal: opts?.signal,
          eph: opts?.eph === true,
          markSize,
        });
      }
      b64 = bytesToBase64(new Uint8Array(buf));
    }
  } catch (e) {
    return {
      ok: false,
      read: 0,
      failed: [],
      reason: `PDF read failed: ${(e as Error).message}`,
    };
  }
  // With the native file POST the PDF bytes are streamed in Kotlin (they never
  // enter JS); otherwise fall back to the in-JS base64. Either way release b64
  // right after OCR so it is not held through the per-page Vision pass.
  const r = useNativePost
    ? await ocrPdf(nativeFileFetch(pdfPath), apiKey, '__FILE_B64__', opts?.signal)
    : await ocrPdf(fetchAdapter, apiKey, b64, opts?.signal);
  b64 = '';
  if (!r.ok) {
    return {ok: false, read: 0, failed: [], reason: r.reason};
  }
  if (r.pages.length > 0) {
    // Same word-score diag as the live note path (2026-07-19).
    const withScores = r.pages.filter(p => (p.words ?? 0) > 0).length;
    const lowTotal = r.pages.reduce((n, p) => n + (p.low?.length ?? 0), 0);
    console.log(
      '[SmartNoteAI.ocr]',
      `diag pdf live: ${r.pages.length} p · word scores on ${withScores} · ` +
        `${lowTotal} low(<0.8)` +
        (withScores === 0 ? ' — confidence field ABSENT' : ''),
    );
  }
  // Round 14 #0/#3: lock-skips must flow into EVERY derived artifact —
  // storedPages fed the OFF wipe (a locked hand correction was deleted by
  // the wipe of pages this pass never wrote), and the doorbell stamp
  // sealed annotations the skip never stored.
  const lockSkipped = new Set<number>();
  await mutateStore(s => {
    for (const p of r.pages) {
      // v0.94 audit #4: a whole-file re-OCR used to overwrite EVERY page,
      // hand corrections included. A LOCK is the freeze now, and it is
      // absolute for this automatic pass.
      if (isPageLocked(s, pdfPath, p.page)) {
        lockSkipped.add(p.page);
        continue;
      }
      const e = makePageEntry(p.text, 'mistral-ocr', {hash: ''}, Date.now(), p.low);
      if (opts?.eph === true) {
        e.eph = true; // OFF-doc read only (v0.92.1: never keyed to offOk)
      }
      upsertPage(s, pdfPath, p.page, e, Date.now());
    }
  });
  // Option A (2026-07-29): stamp the OCR completion NOW — after the whole-file
  // OCR, BEFORE Vision — so an interrupted Vision pass resumes via
  // resumePdfVision on the next read, with NO re-OCR. Never at 0 parsed pages
  // (a paid-but-empty OCR must not mark the doc covered until its bytes change).
  if (r.pages.length > 0) {
    const marksRaw = await getMarkPagesList(deps, pdfPath);
    // A LIST ERROR with lock-skips present must hold the doorbell open —
    // we cannot prove the skipped pages carry no ink.
    const annotatedSkipped =
      lockSkipped.size > 0 &&
      (marksRaw === null || [...lockSkipped].some(pg => marksRaw.includes(pg)));
    await mutateStore(s => {
      setDocHash(s, pdfPath, pdfDocHash(byteLen));
      const d = s.docs[pdfPath];
      if (d !== undefined && !annotatedSkipped) {
        // The doorbell settles only when no LOCKED annotated page was
        // skipped — their ink must ring it again after an unlock (#3).
        d.markSz = markSize;
      }
    });
    // Audit 2026-07-30 (money): the whole-file OCR was just paid — it must
    // hit disk NOW, before the (long) Vision pass. The 800 ms persist
    // debounce is a JS timer, frozen the moment the plugin backgrounds: a
    // hard kill in that window lost every OCR page AND the hash, and the
    // next sync re-billed the entire /v1/ocr.
    await flushStore();
  } else {
    console.warn(
      '[SmartNoteAI.read]',
      'ocr returned 0 parseable PDF pages — docHash NOT stamped (will retry)',
    );
  }
  // Vision on EVERY page (like a note): reuses each page's stored OCR as the
  // hint and skips the paid OCR. Interrupted/failed pages stay 'mistral-ocr'
  // and are finished later by resumePdfVision / the Auto tick's Vision drain.
  // skipVision (no PDF host): the OCR result stands alone for now — every
  // page is 'mistral-ocr' debt, drained once a PDF is open.
  if (opts?.skipVision === true) {
    console.log(
      '[SmartNoteAI.read]',
      `ocr: ${r.pages.length} PDF page(s) stored — Vision deferred (no PDF host)`,
    );
    await flushStore();
    return {
      ok: true,
      read: r.pages.length - lockSkipped.size,
      failed: [],
      storedPages: r.pages.map(p => p.page).filter(pg => !lockSkipped.has(pg)),
    };
  }
  const allPages = r.pages.map(p => p.page).sort((a, b) => a - b);
  const vr = await visionPassPdf(deps, apiKey, visionSystem, pdfPath, allPages, {
    signal: opts?.signal,
    onProgress: () => opts?.onProgress?.(),
    eph: opts?.eph === true,
  });
  console.log(
    '[SmartNoteAI.read]',
    `ocr: ${r.pages.length} PDF page(s) stored, ${vr.read} read with Vision` +
      (vr.failed.length > 0 ? `, ${vr.failed.length} Vision pending` : ''),
  );
  await flushStore();
  return {
    ok: vr.failed.length === 0,
    read: r.pages.length - lockSkipped.size,
    failed: vr.failed,
    storedPages: r.pages.map(p => p.page).filter(pg => !lockSkipped.has(pg)),
  };
};

// Offline stopgap: keep the free RECOGNTEXT transcripts flowing into the
// conversation WITHOUT paying and WITHOUT persisting (spec: only paid
// reads persist — RECOGNTEXT re-reads free anytime).
export const pageTextsFromStore = async (
  path: string,
  pages: number[],
  fallback?: Map<number, string>,
): Promise<PageText[]> => {
  const store = await loadStore();
  return pages.map(p => {
    const entry = getPage(store, path, p);
    const text =
      entry !== null && entry.text.trim().length > 0
        ? entry.text
        : fallback?.get(p) ?? '';
    return {page: p, text};
  });
};
