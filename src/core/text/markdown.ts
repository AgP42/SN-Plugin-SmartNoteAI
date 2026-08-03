// Lightweight Markdown parser for transcripts. Transcripts (and AI
// replies) contain simple Markdown — headings, bullet/numbered lists,
// quotes, fenced code, GitHub tables and inline **bold**/*italic*/`code`.
// We render them as formatted text instead of showing the literal
// markers. This module is PURE (no RN, no fetch): a string in, a block
// array out, consumed by MarkdownView.tsx.
//
// Design goals (transcripts are simple, the AI sometimes emits MALFORMED
// markdown): keep it SMALL, NEVER throw, and NEVER lose user text — a
// malformed marker degrades to literal characters rather than dropping
// them. The concatenation of every span's `s` equals the source with
// markers removed only for WELL-FORMED pairs.

export type InlineSpan = {t: 'text' | 'bold' | 'italic' | 'code'; s: string};

export type MdBlock =
  | {k: 'hr'} // horizontal rule (---, ***, ___)
  | {k: 'h'; level: 1 | 2 | 3; spans: InlineSpan[]}
  | {k: 'p'; spans: InlineSpan[]}
  | {k: 'ul'; items: InlineSpan[][]} // bullet list, each item = spans
  | {k: 'ol'; items: InlineSpan[][]; start: number}
  | {k: 'quote'; spans: InlineSpan[]}
  | {k: 'code'; text: string} // fenced ``` block, raw
  | {k: 'table'; header: string[]; rows: string[][]};

// ---- inline ----------------------------------------------------------

// Try to match ONE inline marker starting at index `i`. Order is fixed:
// code first (its content is literal), then bold, then italic. Returns
// null when nothing well-formed starts here, so the caller keeps the
// character as literal text. No nesting — a marker's content is a single
// literal span (first match wins is fine for transcripts).
function matchMarker(
  s: string,
  i: number,
): {span: InlineSpan; end: number} | null {
  const c = s[i];
  // `code` — need a non-empty run before the closing backtick.
  if (c === '`') {
    const j = s.indexOf('`', i + 1);
    if (j > i + 1) {
      return {span: {t: 'code', s: s.slice(i + 1, j)}, end: j + 1};
    }
    return null;
  }
  // **bold** / __bold__ then *italic* / _italic_ (same delimiter char).
  // Flanking rules (audit 2026-07-18): the char after the opener and the
  // char before the closer must be non-space — so '5 * 3 * 2' keeps its
  // asterisks. For '_' we also reject INTRAWORD emphasis so snake_case
  // identifiers survive (CommonMark does the same).
  if (c === '*' || c === '_') {
    const wordCh = /[\wÀ-ÖØ-öø-ÿ]/;
    const two = c + c;
    if (s.startsWith(two, i)) {
      const j = s.indexOf(two, i + 2);
      if (j > i + 2 && !/\s/.test(s[i + 2]) && !/\s/.test(s[j - 1])) {
        return {span: {t: 'bold', s: s.slice(i + 2, j)}, end: j + 2};
      }
      // empty/unclosed/badly-flanked bold → try a single-char italic
    }
    const k = s.indexOf(c, i + 1);
    if (k > i + 1 && !/\s/.test(s[i + 1]) && !/\s/.test(s[k - 1])) {
      if (c === '_') {
        const prev = i > 0 ? s[i - 1] : ' ';
        const next = k + 1 < s.length ? s[k + 1] : ' ';
        if (wordCh.test(prev) || wordCh.test(next)) {
          return null; // intraword underscore → literal (file_name_here)
        }
      }
      return {span: {t: 'italic', s: s.slice(i + 1, k)}, end: k + 1};
    }
    return null;
  }
  return null;
}

export function parseInline(s: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf.length > 0) {
      spans.push({t: 'text', s: buf});
      buf = '';
    }
  };
  let i = 0;
  while (i < s.length) {
    const m = matchMarker(s, i);
    if (m) {
      flush();
      spans.push(m.span);
      i = m.end;
    } else {
      buf += s[i];
      i += 1;
    }
  }
  flush();
  return spans;
}

// ---- blocks ----------------------------------------------------------

const RE_FENCE = /^\s*```/;
const RE_FENCE_END = /^\s*```\s*$/;
const RE_BLANK = /^\s*$/;
const RE_H = /^(#{1,6})\s+(.*)$/;
// Horizontal rule (---, ***, ___ alone) and the SALVAGE form for
// transcripts stored before v0.65.1, where the reflow glued the next
// sentence onto the rule ("--- une phrase" — device report 2026-07-20).
const RE_HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const RE_HR_GLUED = /^\s*(-{3,})\s+(\S.*)$/;
const RE_QUOTE = /^\s*>\s?(.*)$/;
const RE_UL = /^\s*[-*+\u2022\u00b7]\s+(.*)$/;
// Lines that must stay on their OWN line, glyph kept verbatim (the store
// reflow deliberately preserves them; joining them into prose was a
// display regression — audit 2026-07-18): checkbox items and `N)` items.
const RE_KEEPLINE = /^\s*([\u2713\u2611\u2717\u2610]|\d+\))\s/;
const RE_OL = /^\s*(\d+)\.\s+(.*)$/;

// Split a `|a|b|` row into trimmed cells (outer pipes optional).
function splitCells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) {
    t = t.slice(1);
  }
  if (t.endsWith('|')) {
    t = t.slice(0, -1);
  }
  return t.split('|').map(c => c.trim());
}

// A `|---|:--:|` GitHub table separator line.
function isSeparatorRow(line: string): boolean {
  // Must contain a pipe: a bare '---' horizontal rule after a sentence
  // with a '|' in it is NOT a table (audit 2026-07-18).
  if (!line.includes('-') || !line.includes('|')) {
    return false;
  }
  const cells = splitCells(line);
  return cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c));
}

// A line that would begin its own block (used to stop paragraph reflow).
function isStarter(l: string): boolean {
  return (
    RE_FENCE.test(l) ||
    RE_HR.test(l) ||
    RE_HR_GLUED.test(l) ||
    RE_H.test(l) ||
    RE_QUOTE.test(l) ||
    RE_UL.test(l) ||
    RE_OL.test(l) ||
    RE_KEEPLINE.test(l)
  );
}

function parseBlocks(src: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = (src ?? '').split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // fenced code — raw text between fences; unclosed → rest is code.
    if (RE_FENCE.test(line)) {
      const after = line.replace(/^\s*```/, '');
      const close = after.indexOf('```');
      if (close >= 0) {
        // One-line ```…``` (audit 2026-07-18: its content was DROPPED and
        // the rest of the document swallowed as an unclosed block). Render
        // as an inline-code paragraph; text after the close stays literal.
        const spans: InlineSpan[] = [];
        if (close > 0) {
          spans.push({t: 'code', s: after.slice(0, close)});
        }
        const rest = after.slice(close + 3);
        if (rest.trim().length > 0) {
          spans.push(...parseInline(rest));
        }
        if (spans.length > 0) {
          blocks.push({k: 'p', spans});
        }
        i += 1;
        continue;
      }
      i += 1;
      const body: string[] = [];
      // Content on the opening-fence line (```echo hi) is kept, not lost.
      if (after.trim().length > 0) {
        body.push(after);
      }
      while (i < lines.length && !RE_FENCE_END.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) {
        i += 1; // consume the closing fence
      }
      blocks.push({k: 'code', text: body.join('\n')});
      continue;
    }

    if (RE_BLANK.test(line)) {
      i += 1;
      continue;
    }

    const h = RE_H.exec(line);
    if (h) {
      const level = Math.min(3, h[1].length) as 1 | 2 | 3;
      blocks.push({k: 'h', level, spans: parseInline(h[2].trim())});
      i += 1;
      continue;
    }

    if (RE_HR.test(line)) {
      blocks.push({k: 'hr'});
      i += 1;
      continue;
    }
    // Pre-v0.65.1 stores: "--- une phrase" (rule + glued sentence) →
    // render as a rule followed by the sentence, no re-read needed.
    const glued = RE_HR_GLUED.exec(line);
    if (glued) {
      blocks.push({k: 'hr'});
      blocks.push({k: 'p', spans: parseInline(glued[2].trim())});
      i += 1;
      continue;
    }

    // quote — merge consecutive `>` lines with a space.
    if (RE_QUOTE.test(line)) {
      const parts: string[] = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) {
        parts.push((RE_QUOTE.exec(lines[i]) as RegExpExecArray)[1]);
        i += 1;
      }
      blocks.push({k: 'quote', spans: parseInline(parts.join(' ').trim())});
      continue;
    }

    // table — a pipe row immediately followed by a separator row.
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      isSeparatorRow(lines[i + 1])
    ) {
      const header = splitCells(line);
      i += 2; // header + separator
      const rows: string[][] = [];
      while (
        i < lines.length &&
        lines[i].includes('|') &&
        !RE_BLANK.test(lines[i])
      ) {
        rows.push(splitCells(lines[i]));
        i += 1;
      }
      blocks.push({k: 'table', header, rows});
      continue;
    }

    // unordered list — group consecutive -/*/+ lines.
    if (RE_UL.test(line)) {
      const items: InlineSpan[][] = [];
      while (i < lines.length && RE_UL.test(lines[i])) {
        const c = (RE_UL.exec(lines[i]) as RegExpExecArray)[1];
        items.push(parseInline(c.trim()));
        i += 1;
      }
      blocks.push({k: 'ul', items});
      continue;
    }

    // ordered list — group consecutive `N.` lines, start = first number.
    if (RE_OL.test(line)) {
      const start = parseInt((RE_OL.exec(line) as RegExpExecArray)[1], 10);
      const items: InlineSpan[][] = [];
      while (i < lines.length && RE_OL.test(lines[i])) {
        const c = (RE_OL.exec(lines[i]) as RegExpExecArray)[2];
        items.push(parseInline(c.trim()));
        i += 1;
      }
      blocks.push({k: 'ol', items, start});
      continue;
    }

    // paragraph — reflow consecutive plain lines with a space, but never
    // across a blank line or into another block.
    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      !RE_BLANK.test(lines[i]) &&
      !isStarter(lines[i]) &&
      !(
        lines[i].includes('|') &&
        i + 1 < lines.length &&
        isSeparatorRow(lines[i + 1])
      )
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({k: 'p', spans: parseInline(para.join(' ').trim())});
  }
  return blocks;
}

// SELF-HEAL (device report 2026-07-20): transcripts stored BEFORE the
// fence-aware reflow can carry a mangled wrapper — an opening ``` on the
// first line whose closing fence the old reflow glued onto the last
// word. Unclosed, it swallows the whole page into ONE raw code block.
// When a doc parses to exactly that, drop the leading fence marker and
// a trailing ``` and parse the remainder — no paid re-read. A properly
// CLOSED single code block is untouched (its closing fence stands
// alone, so `hasClose` is true).
export function parseMarkdown(src: string): MdBlock[] {
  const blocks = parseBlocks(src);
  if (blocks.length === 1 && blocks[0].k === 'code') {
    const lines = (src ?? '').split(/\r?\n/);
    const first = lines.find(l => l.trim().length > 0);
    const hasClose = lines
      .slice(lines.indexOf(first ?? '') + 1)
      .some(l => RE_FENCE_END.test(l));
    // Only clear damage signatures qualify: a ```markdown/md tag (never
    // legit code) or a closing fence glued after text on the last line.
    // A bare unclosed ``` with prose stays code — could be a truncated
    // real code page.
    const damaged =
      /^\s*```(?:markdown|md)\s*$/i.test(first ?? '') ||
      /\S[ \t]+```\s*$/.test(src);
    if (first !== undefined && RE_FENCE.test(first) && !hasClose && damaged) {
      const repaired = src
        .replace(/^\s*```[a-zA-Z]*[ \t]*\n?/, '')
        .replace(/(\s|^)```\s*$/, '');
      const again = parseBlocks(repaired);
      if (again.length > 1 || (again.length === 1 && again[0].k !== 'code')) {
        return again;
      }
    }
  }
  return blocks;
}

// Flatten Markdown to clean PLAIN text — for compact previews (Library
// overview tiles) where rendering headings/tables makes no sense and the
// literal markers (#, **, `) are just noise. Reuses the parser so it
// tracks the same grammar (and stays robust to malformed input).
export function mdToPlain(src: string): string {
  const spans = (ss: InlineSpan[]): string => ss.map(s => s.s).join('');
  const out: string[] = [];
  for (const b of parseMarkdown(src)) {
    switch (b.k) {
      case 'h':
      case 'p':
      case 'quote':
        out.push(spans(b.spans));
        break;
      case 'ul':
        out.push(b.items.map(it => `• ${spans(it)}`).join('\n'));
        break;
      case 'ol':
        out.push(
          b.items.map((it, i) => `${b.start + i}. ${spans(it)}`).join('\n'),
        );
        break;
      case 'code':
        out.push(b.text);
        break;
      case 'table':
        out.push(
          [b.header, ...b.rows].map(r => r.join(' · ')).join('\n'),
        );
        break;
    }
  }
  return out.join('\n').trim();
}
