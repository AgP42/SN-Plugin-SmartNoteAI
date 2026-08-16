// The SYNC STATUS pipeline classifier. Every TRACKED page lands in exactly
// ONE of three stages — a STRICT PARTITION, so the counts always sum to
// `tracked` and "Finished" can never exceed it (the progress bar's
// guarantee). Since the batch pipeline was removed there is a single LIVE
// path (OCR 4 → Vision per page), so the only intermediate state is a page
// whose OCR landed but whose vision hasn't (a live vision that failed once,
// 429/network — retried by "Vision now" / the Auto tick).
//
// The one honest limitation, by design: staleness from an edit made SINCE
// the last change-check is not seen here (the stored transcript still reads
// as its old stage). "Check changes" / the Auto tick refresh it.
//
// Pure: Store + per-note totals in, counts out. No IO.
import type {Store} from './transcriptStore';
import {pageStage, docPending} from './transcriptStore';

export type PipelineStages = {
  tracked: number; // total structural pages across tracked notes/PDFs
  queue: number; // 1 · new / edited, not read yet
  ocrDone: number; // 2 · OCR text on device, vision not done (to retry)
  finished: number; // 3 · vision transcript (or hand edit), up to date
};

export type TrackedTotal = {
  total: number;
  isPdf: boolean;
  pdfCovered: boolean;
};

export const classifyPipeline = (
  store: Store,
  trackedTotals: Map<string, TrackedTotal>,
): PipelineStages => {
  const out: PipelineStages = {
    tracked: 0,
    queue: 0,
    ocrDone: 0,
    finished: 0,
  };

  for (const [path, info] of trackedTotals) {
    out.tracked += info.total;
    const doc = store.docs[path];
    // The QUEUE (paid-read) count uses the engine's authoritative owed.read
    // when present (the same value the "N to sync" frame reads, so bar and
    // frame agree); the OCR-DONE (vision-owed) count is ALWAYS structural
    // (pageStage), which self-updates when the batch drain settles a page, so
    // it can never go stale (redesign audit 2026-08-14). Clamp so a stale
    // owed can never break the queue+ocrDone+finished == tracked partition.
    const ctx = {
      isPdf: info.isPdf,
      docHash: doc?.docHash ?? '',
      docLocked: doc?.lock === true,
      pdfCovered: info.pdfCovered,
      hasPageCount: doc?.pageCount !== undefined,
    };
    let structQueue = 0;
    let ocr = 0;
    for (let p = 0; p < info.total; p++) {
      const stage = pageStage(doc?.pages[String(p)], ctx);
      if (stage === 'ocr') {
        ocr++;
      } else if (stage === 'queue') {
        structQueue++;
      }
    }
    // The SAME selection computeSyncFrame uses (docPending), so bar and frame can
    // never disagree: queue = read, ocrDone = vision, finished = the rest.
    const {read, vision} = docPending(
      doc?.owed,
      {queued: structQueue, ocrPending: ocr},
      info.total,
    );
    out.queue += read;
    out.ocrDone += vision;
    out.finished += Math.max(0, info.total - read - vision);
  }
  return out;
};
