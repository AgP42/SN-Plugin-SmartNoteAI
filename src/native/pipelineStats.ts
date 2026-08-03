// Async bridge for the SYNC STATUS pipeline (v0.69): loads the store
// (in-memory singleton) and runs the pure classifier. The store is the
// only thing the UI can't derive from its DocSummary list, so this is
// the one place that reaches for it. No footer reads — staleness from an
// edit since the last check is intentionally not seen here (Check changes
// refreshes it), so this stays a cheap in-memory pass.
import {loadStore} from './transcriptStoreIo';
import {
  classifyPipeline,
  type TrackedTotal,
  type PipelineStages,
} from '../core/store/pipeline';

export const pipelineFromStore = async (
  trackedTotals: Map<string, TrackedTotal>,
): Promise<{stages: PipelineStages; oldestOcrDoneAt: number}> => {
  const store = await loadStore();
  const stages = classifyPipeline(store, trackedTotals);
  // Oldest page sitting at "OCR done, vision to retry" — its stored `at`.
  let oldest = 0;
  for (const [path] of trackedTotals) {
    const doc = store.docs[path];
    if (doc === undefined) {
      continue;
    }
    for (const e of Object.values(doc.pages)) {
      if (e.source === 'mistral-ocr' && e.text.trim().length > 0) {
        oldest = oldest === 0 ? e.at : Math.min(oldest, e.at);
      }
    }
  }
  return {stages, oldestOcrDoneAt: oldest};
};

// v0.86 (user): the SYNC STATUS is split by document type — notes and PDFs
// have DIFFERENT host requirements for rendering (note pages render only under
// the note app, PDF pages only under the document app), so their progress is
// shown as two separate bars. One store load, two classifier passes over the
// note-only and PDF-only subsets of the tracked map.
export const pipelineFromStoreSplit = async (
  trackedTotals: Map<string, TrackedTotal>,
): Promise<{notes: PipelineStages; pdfs: PipelineStages}> => {
  const store = await loadStore();
  const notesMap = new Map<string, TrackedTotal>();
  const pdfsMap = new Map<string, TrackedTotal>();
  for (const [path, info] of trackedTotals) {
    (info.isPdf ? pdfsMap : notesMap).set(path, info);
  }
  return {
    notes: classifyPipeline(store, notesMap),
    pdfs: classifyPipeline(store, pdfsMap),
  };
};
