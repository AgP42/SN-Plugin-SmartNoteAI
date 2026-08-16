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
