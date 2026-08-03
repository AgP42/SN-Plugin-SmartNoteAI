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
    if (info.isPdf) {
      // Option A: PDFs are read per page (OCR then Vision), so they carry the
      // same three stages as notes. A page with 'mistral-ocr' text is awaiting
      // Vision (stage 2). A page with NO entry is a text-less page (finished
      // once the doc is covered — OCR ran and found nothing) or still queued
      // for the first OCR pass (not covered yet).
      for (let p = 0; p < info.total; p++) {
        const e = doc?.pages[String(p)];
        if (e !== undefined && e.text.trim().length > 0) {
          if (e.source === 'mistral-ocr') {
            out.ocrDone++;
          } else {
            out.finished++; // medium / improved / user
          }
        } else if (info.pdfCovered) {
          out.finished++; // text-less page, OCR done
        } else {
          out.queue++;
        }
      }
      continue;
    }
    for (let p = 0; p < info.total; p++) {
      const e = doc?.pages[String(p)];
      if (e !== undefined && e.text.trim().length > 0) {
        if (e.source === 'mistral-ocr') {
          out.ocrDone++;
        } else {
          out.finished++; // medium / improved / user
        }
      } else {
        out.queue++; // never read, or read-blank (negative cache)
      }
    }
  }
  return out;
};
