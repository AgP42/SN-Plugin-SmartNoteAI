// The SYNCHRONISATION frame's aggregation, extracted VERBATIM from
// LibraryScreen's useMemo (UI refactor Lot 2, 2026-08-03) so the money
// math — what counts as "to sync", per mode — is a pure, testable
// function instead of 100 lines inside a 3000-line screen.
import {
  resolveAutoTarget,
  isAutoFolderKey,
  type AutoTarget,
} from '../../src/core/store/autoEngine';
import {docPending, type DocSummary} from '../../src/core/store/transcriptStore';

export type SyncAgg = {
  notes: number; // all files (notes + PDFs)
  noteFiles: number;
  pdfFiles: number;
  pages: number; // all tracked pages (notes + PDFs)
  notePages: number; // pages belonging to .note files
  pdfPages: number; // pages belonging to .pdf files
  toRead: number; // pages needing a PAID read (queued — matches pagesNeedingRead)
  visionPending: number; // read as OCR, Vision still owed (the cheaper leg)
  pdfUnknown: number;
};

export type SyncFrame = {
  agg: Record<'auto' | 'manual' | 'off', SyncAgg>;
  autoPendingNames: string[];
  atMistralPages: number;
  atMistralPdfs: number;
  toSync: number;
  upToDate: number;
  canSync: boolean;
  foldersCnt: {auto: number; manual: number; off: number};
};

export const computeSyncFrame = (
  lib: DocSummary[],
  treeCache: Record<string, Array<{name: string; isDir: boolean}>>,
  autoTargets: Record<string, AutoTarget>,
  pageCounts: Record<string, number>,
): SyncFrame => {
  const libByPath = new Map(lib.map(d => [d.path, d]));
  const autoPendingNames: string[] = [];
  const zero = (): SyncAgg => ({
    notes: 0,
    noteFiles: 0,
    pdfFiles: 0,
    pages: 0,
    notePages: 0,
    pdfPages: 0,
    toRead: 0,
    visionPending: 0,
    pdfUnknown: 0,
  });
  const agg: Record<'auto' | 'manual' | 'off', SyncAgg> = {
    auto: zero(),
    manual: zero(),
    off: zero(),
  };
  const seen = new Set<string>();
  const addFile = (p: string): void => {
    if (seen.has(p)) {
      return;
    }
    seen.add(p);
    const t = resolveAutoTarget(autoTargets, p);
    if (t === null) {
      return; // untracked — not part of the frame
    }
    const a = agg[t.mode];
    a.notes++;
    const isPdf = /\.pdf$/i.test(p);
    if (isPdf) {
      a.pdfFiles++;
    } else {
      a.noteFiles++;
    }
    // Split the tracked page total by file type so the frame can show
    // "y notes (xx pages) · n pdf (xx pages)" (user 2026-08-14).
    const addPages = (n: number): void => {
      a.pages += n;
      if (isPdf) {
        a.pdfPages += n;
      } else {
        a.notePages += n;
      }
    };
    const d = libByPath.get(p);
    if (d !== undefined) {
      addPages(d.total);
      // total - READ (not total - non-empty): a page read but found
      // blank is done, not pending (else it never drains). pdfCovered:
      // a docHash-stamped PDF is fully read — its text-less pages have
      // no entry by design and showed as a phantom "N to sync" forever.
      // The stale map (v0.53) overrides structure when known; it only
      // applies to docs CURRENTLY Manual (2026-07-19 evening: a note
      // flipped to Auto kept its stale count).
      // Authoritative owed READ count written by the engine (redesign
      // 2026-08-14): owed.read IS what "Sync now" would read, so the count can
      // no longer disagree with it. Fall back to structural `queued` only for a
      // doc the engine has not processed; clamp to total (a stale owed can
      // never show an impossible page count). The Vision count is ALWAYS
      // structural (ocrPending, self-updating) so the batch Vision drain can
      // never leave it stale.
      // The SAME selection classifyPipeline uses (docPending), so the frame and
      // the SYNC bar can never disagree: read = engine's owed.read (else the
      // structural queue), vision = owed.vision (else structural ocrPending),
      // DISJOINT and clamped so read+vision never exceeds total.
      const {read: filePend, vision: filePendVision} = docPending(
        d.owed,
        {queued: d.queued, ocrPending: d.ocrPending},
        d.total,
      );
      a.toRead += filePend;
      a.visionPending += filePendVision;
      if (t.mode === 'auto' && filePend + filePendVision > 0) {
        autoPendingNames.push(
          `${p.split('/').pop()} (${filePend + filePendVision})`,
        );
      }
    } else {
      const n = pageCounts[p] ?? 0;
      if (n > 0) {
        addPages(n);
        a.toRead += n; // store never saw it → all pending
        if (t.mode === 'auto') {
          autoPendingNames.push(`${p.split('/').pop()} (${n})`);
        }
      } else {
        a.pdfUnknown++; // no local count (PDF, or not swept yet)
      }
    }
  };
  for (const d of lib) {
    addFile(d.path);
  }
  for (const [dir, kids] of Object.entries(treeCache)) {
    for (const k of kids) {
      if (!k.isDir) {
        addFile(`${dir}/${k.name}`);
      }
    }
  }
  // Batch removed: there is no server-side job wave anymore. Everything
  // Manual that still needs reading is simply "to sync"; nothing sits "at
  // Mistral". These zeros keep the return shape stable for the UI.
  const atMistralPages = 0;
  const atMistralPdfs = 0;
  const man = agg.manual;
  const toSync = man.toRead;
  // Up to date = fully done (neither a paid read nor Vision owed). OCR-only
  // pages are NOT up to date — they still owe Vision (LibraryScreen:1928: the
  // tree used to show "✓ / 0 to sync" over pages Vision had not reached).
  const upToDate = Math.max(0, man.pages - man.toRead - man.visionPending);
  // Sync-now is offered when ANY work remains — a paid read OR an owed Vision
  // leg — so the button is not greyed out while OCR-only pages await Vision.
  const canSync = toSync > 0 || man.visionPending > 0 || man.pdfUnknown > 0;
  const foldersCnt = {auto: 0, manual: 0, off: 0};
  for (const [k, t] of Object.entries(autoTargets)) {
    if (isAutoFolderKey(k) && t.mode in foldersCnt) {
      foldersCnt[t.mode]++;
    }
  }
  return {
    agg,
    autoPendingNames,
    atMistralPages,
    atMistralPdfs,
    toSync,
    upToDate,
    canSync,
    foldersCnt,
  };
};
