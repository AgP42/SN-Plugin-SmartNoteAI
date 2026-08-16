// Phase 4 §2.3: the chat's context-gathering flow, extracted from
// ChatPanel.send() (it lived inline between the consent gates and the
// HTTP call — ~190 lines inside a component). Everything money-related
// in a send happens HERE: the batch-pending filter, the big-read
// estimate gate, the paid reads, and the Off ephemeral wipe (in a
// finally, so Stop or an error can never leave Off transcripts on disk).
//
// The caller owns the DIALOGS (consent, Off, estimate): it runs them
// BEFORE calling gather (consent/Off) or AFTER on a 'estimate' result.

import type {CaptureDeps} from './capture';
import {captureDocText} from './capture';
import type {ContextMode, PageText} from '../core/convo/composeContext';
import {pagesForContext, composePagesText} from '../core/convo/composeContext';
import {composeUserText} from '../core/convo/compose';
import {
  isNotePath,
  pagesNeedingRead,
  readNotePages,
  readPdf,
  pageTextsFromStore,
  markFilePath,
  pdfPrintedCovered,
  pdfMarkSzOf,
} from './reading';
import {readStoredTranscripts, readFileSize} from './noteTranscripts';
import {
  loadStore,
  mutateStore,
  flushStore,
  isDegradedLoad,
  isDocReadOnly,
} from './transcriptStoreIo';
import {removePages} from '../core/store/transcriptStore';
import {eurosTotal, FULL_PAGE_READ_CENTS} from '../core/model/reader';
import {OCR_COST_CENTS} from '../core/model/ocr';

export const isOfflineReason = (reason?: string): boolean =>
  reason !== undefined && /network error|timed out/i.test(reason);

// One parsed scope object (0-indexed bounds) replaces the ctxMode /
// rangeStart / rangeEnd trio and its five duplicated
// `(parseInt(x,10)||1)-1` blocks.
export type GatherScope = {
  mode: ContextMode;
  start: number; // 0-indexed, range mode only
  end: number;
};

export const parseScope = (
  mode: ContextMode,
  rangeStart: string,
  rangeEnd: string,
): GatherScope => ({
  mode,
  start: (parseInt(rangeStart, 10) || 1) - 1,
  end: (parseInt(rangeEnd, 10) || 1) - 1,
});

export type GatherOutcome =
  | {kind: 'ok'; userText: string; pages: number[]; offline: string}
  // >100 pages: ask first. For a PDF nobody has read yet the page count is
  // NOT knowable (no SDK call returns it, getNoteTotalPageNum answers 1),
  // so the estimate carries the honest UPPER bound too and the dialog shows
  // a range instead of a fabricated number (release audit 2026-08-12).
  | {kind: 'estimate'; count: number; euros: string; upTo?: number; eurosUpTo?: string}
  | {kind: 'stopped'};

export const gatherContext = async (
  deps: CaptureDeps,
  capture: {notePath: string; page: number; totalPages: number},
  scope: GatherScope,
  text: string,
  noteName: string,
  apiKey: string,
  opts: {
    // The file is Off and the user consented for THIS conversation: reads
    // are allowed (offOk) and everything read is wiped in the finally.
    isOff: boolean;
    skipEstimate: boolean;
    freshVisionSystem: () => Promise<string>;
    freshPdfVisionSystem: () => Promise<string>;
    shouldStop: () => boolean;
    signal: AbortSignal;
    onProgress: (label: string, done: number, total: number) => void;
  },
): Promise<GatherOutcome> => {
  const notePath = capture.notePath;
  let pages: number[] = [capture.page];
  let pageTexts: PageText[] = [];
  // What the send's banner should say afterwards ('' = online, fine).
  let offline = '';
  // Set once a read of an Off file has STARTED: the ephemeral wipe in the
  // finally below must run even when Stop or an error bails out mid-read
  // (readNotePages persists each page as it lands — audit 2026-07-17).
  let offReadStarted = false;
  // PDF reads store the WHOLE document, not just the selected context
  // pages — the wipe must cover what was written (v0.36).
  let offWipePages: number[] | null = null;
  // Round 5 #6: a memory-only session cannot persist, so any paid read
  // would be billed and then lost. Serve what memory holds and say so.
  const degraded = isDegradedLoad() || isDocReadOnly(notePath);
  try {
    if (degraded) {
      console.warn(
        '[SmartNoteAI]',
        'degraded store session — chat serves stored text only (no paid read)',
      );
      offline = 'Storage unavailable: stored transcript only';
      pageTexts = await pageTextsFromStore(notePath, pages);
    } else if (isNotePath(notePath)) {
      // Flush the open note ONCE, before ANY walk of this send (v0.54.1,
      // device log 2026-07-19: the flush lived inside readNotePages, AFTER
      // the estimate guard had already walked the 106-page note — the
      // footer moved and every later reader re-walked: 3 × 9 s before the
      // first byte reached Mistral). Flushed here, the estimate walk
      // already describes the post-flush file and the content-verified
      // cache serves everything after it (readNotePages' own save stays
      // as a harmless no-op for its other callers).
      await deps.saveCurrentNote().catch(() => {});
      pages = pagesForContext(scope.mode, capture.page, capture.totalPages, {
        start: scope.start,
        end: scope.end,
      });

      // Single engine: OCR 4 + vision, always (v0.38).
      // Big-read confirmation (decision U2: dialog above 100 pages).
      if (!opts.skipEstimate) {
        const needed = await pagesNeedingRead(deps, notePath, pages, {
          eph: opts.isOff,
        });
        if (needed.length > 100) {
          return {
            kind: 'estimate',
            count: needed.length,
            // Both engine legs are billed (audit 2026-07-18: the estimate
            // ignored the vision leg, −12%).
            euros: eurosTotal(needed.length, FULL_PAGE_READ_CENTS),
          };
        }
      }
      offReadStarted = opts.isOff;
      const outcome = await readNotePages(
        deps,
        apiKey,
        await opts.freshVisionSystem(),
        notePath,
        pages,
        {
          onProgress: (d, t) => opts.onProgress('reading (ocr)', d, t),
          shouldStop: opts.shouldStop,
          signal: opts.signal,
          // This flow ran the Off consent dialog (caller) and wipes the
          // entries in the finally — the reading-layer gate defers.
          offOk: true,
          // Ephemeral marking is for OFF docs ONLY (v0.92.1 critical fix:
          // keying it to offOk marked every ordinary chat-read page and
          // the boot sweep destroyed legitimate paid transcripts).
          eph: opts.isOff,
        },
      );
      // The OFF wipe covers exactly what THIS run wrote (audit C1
      // 2026-07-19): pages already covered by an earlier paid read or a
      // hand edit were not touched here and must survive.
      offWipePages = outcome.storedPages ?? [];
      // Offline: fall back to any stored transcript so the chat stays
      // usable, degraded not blocked.
      let fallback: Map<number, string> | undefined;
      if (!outcome.ok && isOfflineReason(outcome.reason)) {
        fallback = await readStoredTranscripts(notePath).catch(
          () => new Map<number, string>(),
        );
        offline = 'Offline: stored transcript only';
      } else if (!outcome.ok && outcome.reason) {
        console.warn(
          '[SmartNoteAI.read]',
          `${outcome.failed.length} page(s) failed: ${outcome.reason}`,
        );
      }
      pageTexts = await pageTextsFromStore(notePath, pages, fallback);
    } else if (/\.pdf$/i.test(notePath)) {
      // PDF: one /v1/ocr call stores every page; the context modes then
      // select within what the store knows.
      {
        // Big-read confirmation, PDF leg (full review 2026-08-02 #4: the
        // U2 dialog only existed for notes — one chat question on a fresh
        // 300-page PDF billed OCR + Vision over every page with no gate).
        if (!opts.skipEstimate) {
          const st0 = await loadStore();
          const bytes = await readFileSize(notePath).catch(() => null);
          const mark =
            (await readFileSize(markFilePath(notePath)).catch(() => 0)) ?? 0;
          const covered =
            bytes !== null &&
            pdfPrintedCovered(st0.docs[notePath], bytes) &&
            pdfMarkSzOf(st0.docs[notePath]) === mark;
          // Audit 2026-08-02 #7: getDocPageCount is a STORE lookup (0 for
          // an unread PDF), so the previous 'real count' was still 1 and
          // the gate never fired. Measure the FILE instead: a PDF's page
          // count is knowable from its bytes, and a size-based lower bound
          // is enough to decide "is this a big read?" — the exact count
          // only matters for the euro figure, which we round anyway.
          const storedPages = Object.keys(st0.docs[notePath]?.pages ?? {}).length;
          let total = Math.max(capture.totalPages, storedPages);
          if (!covered) {
            const bytes2 = bytes ?? 0;
            // ~40 kB/page is a deliberately CONSERVATIVE floor for scanned
            // and text PDFs alike: it under-estimates, so it never invents
            // a dialog, and it fires on everything genuinely large.
            // 300 kB/page ≈ a 300 dpi scan page: scans (the heavy case)
            // are estimated about right, text PDFs under-estimate and are
            // caught by the store/capture counts instead. The old 40 kB
            // floor over-estimated scans 5-25x and invented false dialogs
            // (round-8 #9). Exact counting arrives with the OCR-first
            // estimate in Phase C.
            const approx = Math.floor(bytes2 / 300_000);
            total = Math.max(total, approx);
          }
          // Chat pays NOTHING on a covered doc since the vision resume was
          // cut from this path (user decision 2026-08-16: a chat question
          // answers from the STORED transcript; the vision backlog belongs
          // to the drain and to Sync). Only an UNCOVERED (changed/unread)
          // doc still costs — its whole-file OCR, host-free, vision skipped.
          const needed = covered ? 0 : total;
          // The 300 kB/page divisor above describes a 300 dpi SCAN. A born-
          // digital text PDF runs 10-50 kB/page, so for those it under-counts
          // 6-30x — and the gate never fired: a 520-page textbook was OCR'd
          // and Visioned whole to answer one question (release audit, money
          // critical). When no trustworthy count exists (never read, and the
          // host reports 1 page for a PDF), decide on the UPPER bound and
          // show the range: erring toward asking costs a tap, erring the
          // other way costs euros.
          // NOT storedPages: a single page redone by hand makes it 1 and
          // used to disable this gate entirely — the 520-page textbook was
          // read whole again (verification pass 2026-08-12). Only a real
          // page COUNT can be trusted here.
          const trusted = covered || capture.totalPages > 1;
          const upper = trusted ? needed : Math.floor((bytes ?? 0) / 20_000);
          if (!covered && Math.max(needed, upper) > 100) {
            const cents = OCR_COST_CENTS; // vision is never paid on this path
            return {
              kind: 'estimate',
              count: needed,
              euros: eurosTotal(needed, cents),
              ...(trusted || upper <= needed
                ? {}
                : {upTo: upper, eurosUpTo: eurosTotal(upper, cents)}),
            };
          }
        }
        opts.onProgress('reading (ocr)', 0, 1);
        offReadStarted = opts.isOff;
        const outcome = await readPdf(
          deps,
          apiKey,
          await opts.freshPdfVisionSystem(),
          notePath,
          // offOk: consent + ephemeral wipe handled by this flow.
          // skipVision (user decision 2026-08-16): the chat path NEVER pays
          // vision — a covered doc returns instantly and the answer comes
          // from the stored transcript; a changed doc runs its host-free
          // OCR only (the "reading (ocr)" banner is now always literally
          // true). The vision backlog belongs to the drain and to Sync —
          // before this, one chat question about a covered PDF silently
          // drained its WHOLE vision debt synchronously (device logs
          // 2026-08-16: "PDF resume: 15/35" behind a frozen 0/1 banner).
          {signal: opts.signal, offOk: true, eph: opts.isOff, skipVision: true},
        );
        // Same C1 rule as the note branch: wipe what was written, never
        // a fallback selection. A hash-match early return wrote nothing.
        offWipePages = outcome.storedPages ?? [];
        if (!outcome.ok && isOfflineReason(outcome.reason)) {
          offline = 'Offline: embedded text only';
        }
      }
      const store = await loadStore();
      const pdfPages = Object.keys(store.docs[notePath]?.pages ?? {}).length;
      pages =
        pdfPages > 0
          ? pagesForContext(scope.mode, capture.page, pdfPages, {
              start: scope.start,
              end: scope.end,
            })
          : [capture.page];
      // Embedded text of the open page as fallback (fetched at gather
      // time — the capture object is location-only now).
      const docText = await captureDocText(deps, capture.page);
      pageTexts = await pageTextsFromStore(
        notePath,
        pages,
        new Map([[capture.page, docText]]),
      );
    } else {
      // Other docs (EPUB…): the page's embedded text.
      pageTexts = [
        {page: capture.page, text: await captureDocText(deps, capture.page)},
      ];
    }

    if (opts.shouldStop()) {
      return {kind: 'stopped'};
    }
    const userText =
      pages.length === 1
        ? composeUserText(text, pageTexts[0]?.text ?? '', noteName)
        : composePagesText(text, pageTexts, noteName);
    return {kind: 'ok', userText, pages, offline};
  } finally {
    // OFF = ephemeral: wipe ONLY the pages THIS run wrote (audit C1 —
    // never a whole selection: older paid or source:'user' entries the
    // run didn't touch must survive), and flush NOW so a kill can't
    // leave them on disk (P3). In a finally so Stop / errors can't skip
    // it. `offWipePages ?? []`: an exception before the read reported
    // back means nothing is known to have been written — wiping a guess
    // would destroy paid data, the worse failure mode.
    const wipe = offReadStarted ? offWipePages ?? [] : [];
    if (wipe.length > 0) {
      try {
        await mutateStore(s => removePages(s, notePath, wipe));
        await flushStore();
      } catch (e) {
        console.warn('[SmartNoteAI]', `off-file wipe failed: ${String(e)}`);
      }
    }
  }
};
