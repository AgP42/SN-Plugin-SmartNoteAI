// EXPORT (v0.40): compose the Markdown / plain-text files for a document's
// transcripts.
// Pure — the native side (src/native/exporter.ts) feeds it store content
// and writes the result under /EXPORT.
//
// The transcripts are ALREADY Markdown (v0.38 pipeline asks the vision
// model for it), so a page's text is emitted verbatim; this module only
// adds the document frame (title, export line, per-page headings).

export type ExportPage = {
  page: number; // 0-indexed
  text: string | null; // null = not read yet (exported as a marker)
};

// "p3-p7" for a contiguous run, "p3,p5,p9" otherwise (1-indexed, compact
// mixed form like "p1-p3,p7"). Used in selection-export file names.
export const pageRangeLabel = (pages: number[]): string => {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) {
      j++;
    }
    parts.push(
      j > i ? `${sorted[i] + 1}-${sorted[j] + 1}` : `${sorted[i] + 1}`,
    );
    i = j + 1;
  }
  return `p${parts.join(',')}`;
};

// Document base name: file name without its .note/.pdf extension.
export const exportBaseName = (docPath: string): string => {
  const name = docPath.split('/').pop() ?? docPath;
  return name.replace(/\.(note|pdf)$/i, '');
};

// Target .md names for a batch of documents, collision-safe: when two
// sources map to the same base (report.note AND report.pdf in one run),
// each gets its extension as a suffix — "report (note).md" / "report (pdf).md".
export const exportFileNames = (docPaths: string[]): Map<string, string> => {
  const byBase = new Map<string, string[]>();
  for (const p of docPaths) {
    const b = exportBaseName(p);
    byBase.set(b, [...(byBase.get(b) ?? []), p]);
  }
  const out = new Map<string, string>();
  for (const [base, paths] of byBase) {
    for (const p of paths) {
      const ext = /\.pdf$/i.test(p) ? 'pdf' : 'note';
      out.set(p, paths.length > 1 ? `${base} (${ext}).md` : `${base}.md`);
    }
  }
  return out;
};

// Inline-emphasis stripper (v0.52, user decision: exports must be CLEAN —
// the model sometimes bolds words it hesitated on, which read as "marks"
// in the exported file; any such signal lives in the plugin only).
// Removes **bold**, *italic* and _italic_ pairs OUTSIDE fenced code
// blocks; document structure (headings, lists, tables, quotes) stays.
export const stripEmphasis = (md: string): string =>
  md
    .split(/(```[\s\S]*?```)/)
    .map((seg, i) =>
      i % 2 === 1
        ? seg // inside a fence — untouched
        : seg
            .replace(/\*\*([^*\n][^*]*?)\*\*/g, '$1')
            .replace(/(^|[^\w*])\*([^*\n]+?)\*(?=[^\w*]|$)/gm, '$1$2')
            .replace(/(^|[^\w_])_([^_\n]+?)_(?=[^\w_]|$)/gm, '$1$2'),
    )
    .join('');

// A document-level transcript provenance line for the export header.
export type ExportSource = {label: string; at: string};

// The exported file. `date` is a preformatted display DATETIME —
// passed in so the composer stays deterministic.
// Plain-text twin (user request 2026-07-18: the Supernote reader opens
// .txt natively, not .md). Same frame, Markdown stripped via mdToPlain.
export const composeExportTxt = (
  docName: string,
  pages: ExportPage[],
  opts: {
    date: string;
    mdToPlain: (md: string) => string;
    source?: ExportSource;
    // Doc-level page total (v0.53): a 4-page SELECTION out of a 106-page
    // doc must read "4/106", not "4/4" (device report).
    docTotal?: number;
  },
): string => {
  const read = pages.filter(p => p.text !== null).length;
  const lines: string[] = [
    docName,
    `Exported by SmartNote AI at ${opts.date} · ${read}/${opts.docTotal ?? pages.length} pages` +
      (opts.source !== undefined
        ? ` · Transcript source: ${opts.source.label} at ${opts.source.at}`
        : ''),
  ];
  for (const p of [...pages].sort((a, b) => a.page - b.page)) {
    lines.push('', `--- Page ${p.page + 1} ---`, '');
    if (p.text === null) {
      lines.push('(not read yet)');
    } else if (p.text.trim().length === 0) {
      lines.push('(blank page)');
    } else {
      lines.push(opts.mdToPlain(p.text.trim()));
    }
  }
  return lines.join('\n') + '\n';
};

export const composeExportMd = (
  docName: string,
  pages: ExportPage[],
  opts: {date: string; source?: ExportSource; docTotal?: number},
): string => {
  const read = pages.filter(p => p.text !== null).length;
  const lines: string[] = [
    `# ${docName}`,
    '',
    `> Exported by SmartNote AI at ${opts.date} · ${read}/${opts.docTotal ?? pages.length} pages` +
      (opts.source !== undefined
        ? ` · Transcript source: ${opts.source.label} at ${opts.source.at}`
        : ''),
  ];
  for (const p of [...pages].sort((a, b) => a.page - b.page)) {
    lines.push('', `## Page ${p.page + 1}`, '');
    if (p.text === null) {
      lines.push('*(not read yet)*');
    } else if (p.text.trim().length === 0) {
      lines.push('*(blank page)*');
    } else {
      lines.push(stripEmphasis(p.text.trim()));
    }
  }
  return lines.join('\n') + '\n';
};
