// EXPORT (v0.40): write .md transcripts under the device's /EXPORT folder
// (the same place the Supernote firmware puts its own exports).
//
// Money rule: exporting NEVER calls Mistral. The UI first counts the
// missing pages (countExportGaps) and asks the user; the optional
// "read first" pass reuses the exact same read paths as the rest of the
// app (readNotePages / readPdf, batch-pending guards included) BEFORE
// runExport composes from the store.

import {NativeModules} from 'react-native';
import {loadStore} from './transcriptStoreIo';
import {docPageCount, getPage} from '../core/store/transcriptStore';
import {
  composeExportMd,
  composeExportTxt,
  exportFileNames,
  exportBaseName,
  pageRangeLabel,
  type ExportPage,
} from '../core/export/exportMd';
import {mdToPlain} from '../core/text/markdown';
import {SRC_LABEL} from '../ui/labels';
import {pagesNeedingRead, isNotePath} from './reading';
import {utf8ToBase64} from '../core/util/base64';
import type {CaptureDeps} from './capture';

const {SmartNoteAiOverlay} = NativeModules as {
  SmartNoteAiOverlay?: {
    writeFileBase64: (
      p: string,
      b64: string,
    ) => Promise<{success?: boolean; message?: string}>;
    mkdirs: (p: string) => Promise<{success?: boolean}>;
  };
};

export const EXPORT_ROOT = '/storage/emulated/0/EXPORT';

// dd/mm/yyyy hh:mm — the user wants the TIME too (request 2026-07-18).
export const fmtExportDate = (epochMs: number): string => {
  const d = new Date(epochMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
};

/* ---------------- gap counting (for the "read first?" dialog) ---------------- */

export type ExportGaps = {
  notePages: number; // missing .note pages (billable count, per page)
  pdfDocs: number; // PDFs with no transcript at all (one OCR call each)
};

// How much is missing from the store for these docs. Notes get an exact
// per-page count (same pagesNeedingRead as everywhere); a PDF is either
// covered (>=1 stored page) or entirely unread.
export const countExportGaps = async (
  deps: CaptureDeps,
  docPaths: string[],
  selection?: number[], // single-doc selection export: restrict the count
): Promise<ExportGaps> => {
  const store = await loadStore();
  let notePages = 0;
  let pdfDocs = 0;
  for (const path of docPaths) {
    if (isNotePath(path)) {
      let pages = selection;
      if (pages === undefined) {
        let total = docPageCount(store, path);
        try {
          const raw = await deps.getNoteTotalPageNum(path);
          const n =
            typeof raw === 'number'
              ? raw
              : ((raw as {result?: unknown})?.result as number);
          if (typeof n === 'number' && n > 0) {
            total = Math.max(total, n);
          }
        } catch {
          // store view only
        }
        pages = Array.from({length: total}, (_, i) => i);
      }
      const needed = await pagesNeedingRead(deps, path, pages).catch(
        () => [] as number[],
      );
      notePages += needed.length;
    } else if (docPageCount(store, path) === 0) {
      pdfDocs++;
    }
  }
  return {notePages, pdfDocs};
};

/* ---------------- the export itself (store → /EXPORT, zero API) ---------------- */

export type ExportResult = {
  written: string[]; // full target paths
  failed: string[]; // doc paths whose write failed
};

const writeMd = async (target: string, content: string): Promise<boolean> => {
  const dir = target.slice(0, target.lastIndexOf('/'));
  try {
    await SmartNoteAiOverlay?.mkdirs?.(dir);
  } catch {
    // fall through — the write reports PARENT_MISSING if it mattered
  }
  try {
    const r = await SmartNoteAiOverlay?.writeFileBase64(
      target,
      utf8ToBase64(content),
    );
    return r?.success === true;
  } catch {
    return false;
  }
};

// Target path for one doc. `baseDir` = the folder whose EXPORT mirrors the
// tree (folder / library export): /Note/Work/a.note with baseDir /Note
// lands at /EXPORT/Note/Work/a.md. null = flat single-doc export.
const targetFor = (
  docPath: string,
  fileName: string,
  baseDir: string | null,
): string => {
  if (baseDir === null) {
    return `${EXPORT_ROOT}/${fileName}`;
  }
  const parent = baseDir.slice(0, baseDir.lastIndexOf('/')); // keep baseDir's own name
  const relDir = docPath.slice(parent.length + 1, docPath.lastIndexOf('/'));
  return relDir.length > 0
    ? `${EXPORT_ROOT}/${relDir}/${fileName}`
    : `${EXPORT_ROOT}/${fileName}`;
};

export type ExportFormat = 'md' | 'txt';

export const runExport = async (
  deps: CaptureDeps,
  docPaths: string[],
  opts: {
    // ONE format per run (user decision 2026-07-18: two buttons, not twins).
    fmt: ExportFormat;
    baseDir?: string | null; // mirror tree under /EXPORT from this folder
    selection?: number[]; // single-doc: export only these 0-indexed pages
    now: number; // epoch ms stamped in the export line
    onProgress?: (label: string, done: number, total: number) => void;
  },
): Promise<ExportResult> => {
  const store = await loadStore();
  const names = exportFileNames(docPaths);
  const written: string[] = [];
  const failed: string[] = [];
  const date = fmtExportDate(opts.now);
  for (const [i, path] of docPaths.entries()) {
    const docName = exportBaseName(path);
    opts.onProgress?.(docName, i + 1, docPaths.length);
    let pageNums: number[];
    if (opts.selection !== undefined) {
      pageNums = [...opts.selection].sort((a, b) => a - b);
    } else {
      let total = docPageCount(store, path);
      if (isNotePath(path)) {
        try {
          const raw = await deps.getNoteTotalPageNum(path);
          const n =
            typeof raw === 'number'
              ? raw
              : ((raw as {result?: unknown})?.result as number);
          if (typeof n === 'number' && n > 0) {
            total = Math.max(total, n);
          }
        } catch {
          // store view only
        }
      }
      pageNums = Array.from({length: total}, (_, i2) => i2);
    }
    const entries = pageNums.map(p => ({p, e: getPage(store, path, p)}));
    const pages: ExportPage[] = entries.map(({p, e}) => ({
      page: p,
      text: e === null ? null : e.text,
    }));
    // Document-level provenance for the header (request 2026-07-18):
    // one label when uniform, the distinct labels joined otherwise, and
    // the LATEST transcript datetime.
    const srcEntries = entries
      .map(x => x.e)
      .filter((e): e is NonNullable<typeof e> => e !== null);
    const srcLabels = [...new Set(srcEntries.map(e => SRC_LABEL[e.source]))];
    const srcAt = srcEntries.reduce((m, e) => Math.max(m, e.at), 0);
    const source =
      srcLabels.length > 0 && srcAt > 0
        ? {label: srcLabels.join(' + '), at: fmtExportDate(srcAt)}
        : undefined;
    let fileName = names.get(path) ?? `${docName}.md`;
    if (opts.selection !== undefined) {
      fileName = fileName.replace(
        /\.md$/,
        ` ${pageRangeLabel(opts.selection)}.md`,
      );
    }
    if (opts.fmt === 'txt') {
      fileName = fileName.replace(/\.md$/, '.txt');
    }
    const target = targetFor(path, fileName, opts.baseDir ?? null);
    // For a page SELECTION, the header still shows the DOC total (4/106).
    const docTotal =
      opts.selection !== undefined ? docPageCount(store, path) : undefined;
    const content =
      opts.fmt === 'txt'
        ? composeExportTxt(docName, pages, {date, mdToPlain, source, docTotal})
        : composeExportMd(docName, pages, {date, source, docTotal});
    const ok = await writeMd(target, content);
    (ok ? written : failed).push(ok ? target : path);
  }
  return {written, failed};
};
