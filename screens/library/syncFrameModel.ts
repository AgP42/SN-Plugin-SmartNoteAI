// The SYNCHRONISATION frame's aggregation, extracted VERBATIM from
// LibraryScreen's useMemo (UI refactor Lot 2, 2026-08-03) so the money
// math — what counts as "to sync", per mode — is a pure, testable
// function instead of 100 lines inside a 3000-line screen.
import {
  resolveAutoTarget,
  isAutoFolderKey,
  type AutoTarget,
} from '../../src/core/store/autoEngine';
import type {DocSummary} from '../../src/core/store/transcriptStore';

export type SyncAgg = {
  notes: number; // all files (notes + PDFs)
  noteFiles: number;
  pdfFiles: number;
  pages: number;
  toRead: number;
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
  manualStale: ReadonlyMap<string, number>,
): SyncFrame => {
  const libByPath = new Map(lib.map(d => [d.path, d]));
  const autoPendingNames: string[] = [];
  const agg: Record<'auto' | 'manual' | 'off', SyncAgg> = {
    auto: {notes: 0, noteFiles: 0, pdfFiles: 0, pages: 0, toRead: 0, pdfUnknown: 0},
    manual: {notes: 0, noteFiles: 0, pdfFiles: 0, pages: 0, toRead: 0, pdfUnknown: 0},
    off: {notes: 0, noteFiles: 0, pdfFiles: 0, pages: 0, toRead: 0, pdfUnknown: 0},
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
    if (/\.pdf$/i.test(p)) {
      a.pdfFiles++;
    } else {
      a.noteFiles++;
    }
    const d = libByPath.get(p);
    if (d !== undefined) {
      a.pages += d.total;
      // total - READ (not total - non-empty): a page read but found
      // blank is done, not pending (else it never drains). pdfCovered:
      // a docHash-stamped PDF is fully read — its text-less pages have
      // no entry by design and showed as a phantom "N to sync" forever.
      // The stale map (v0.53) overrides structure when known; it only
      // applies to docs CURRENTLY Manual (2026-07-19 evening: a note
      // flipped to Auto kept its stale count).
      const stale = t.mode === 'manual' ? manualStale.get(p) : undefined;
      const filePend =
        stale !== undefined
          ? stale
          : d.pdfCovered
          ? 0
          : Math.max(0, d.total - d.read);
      a.toRead += filePend;
      if (t.mode === 'auto' && filePend > 0) {
        autoPendingNames.push(`${p.split('/').pop()} (${filePend})`);
      }
    } else {
      const n = pageCounts[p] ?? 0;
      if (n > 0) {
        a.pages += n;
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
  const upToDate = Math.max(0, man.pages - man.toRead);
  const canSync = toSync > 0 || man.pdfUnknown > 0;
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
