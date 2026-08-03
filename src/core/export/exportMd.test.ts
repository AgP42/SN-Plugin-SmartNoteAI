import {
  composeExportMd,
  stripEmphasis,
  composeExportTxt,
  exportBaseName,
  exportFileNames,
  pageRangeLabel,
} from './exportMd';

describe('pageRangeLabel', () => {
  it('contiguous run → pA-pB (1-indexed)', () => {
    expect(pageRangeLabel([2, 3, 4, 5, 6])).toBe('p3-7');
  });
  it('scattered pages → comma list, mixed with runs', () => {
    expect(pageRangeLabel([0])).toBe('p1');
    expect(pageRangeLabel([0, 2, 4])).toBe('p1,3,5');
    expect(pageRangeLabel([0, 1, 2, 6])).toBe('p1-3,7');
  });
  it('dedupes and sorts', () => {
    expect(pageRangeLabel([4, 2, 2, 3])).toBe('p3-5');
  });
});

describe('exportBaseName / exportFileNames', () => {
  it('strips the .note/.pdf extension only', () => {
    expect(exportBaseName('/Note/Work/Poland.note')).toBe('Poland');
    expect(exportBaseName('/Document/report.PDF')).toBe('report');
    expect(exportBaseName('/Document/v1.2 spec.pdf')).toBe('v1.2 spec');
  });
  it('collision between report.note and report.pdf → extension suffixes', () => {
    const names = exportFileNames([
      '/Note/report.note',
      '/Document/report.pdf',
      '/Note/other.note',
    ]);
    expect(names.get('/Note/report.note')).toBe('report (note).md');
    expect(names.get('/Document/report.pdf')).toBe('report (pdf).md');
    expect(names.get('/Note/other.note')).toBe('other.md');
  });
});

describe('composeExportTxt', () => {
  it('plain frame, markdown stripped through the provided mdToPlain', () => {
    const txt = composeExportTxt(
      'Poland',
      [
        {page: 0, text: '# Trip\n\n- pack **bags**'},
        {page: 1, text: null},
      ],
      {date: '18/07/2026', mdToPlain: md => md.replace(/[#*-]/g, '').trim()},
    );
    expect(txt).toContain('Poland\nExported by SmartNote AI at 18/07/2026 · 1/2 pages');
    expect(txt).toContain('--- Page 1 ---');
    expect(txt).toContain('Trip');
    expect(txt).not.toContain('**');
    expect(txt).toContain('--- Page 2 ---\n\n(not read yet)');
  });
});

describe('composeExportMd', () => {
  it('frames title, export line and per-page headings; text verbatim', () => {
    const md = composeExportMd(
      'Poland',
      [
        {page: 0, text: '# Trip\n\n- pack **bags**'},
        {page: 1, text: null},
        {page: 2, text: '   '},
      ],
      {date: '18/07/2026'},
    );
    expect(md).toContain('# Poland');
    // The blank page WAS read (and negative-cached) — it counts as read.
    expect(md).toContain('> Exported by SmartNote AI at 18/07/2026 · 2/3 pages');
    // v0.52: inline emphasis is STRIPPED on export (any hesitation "mark"
    // the model bolded lives in the plugin only); structure kept.
    expect(md).toContain('## Page 1\n\n# Trip\n\n- pack bags');
    expect(md).toContain('## Page 2\n\n*(not read yet)*');
    expect(md).toContain('## Page 3\n\n*(blank page)*');
    expect(md.endsWith('\n')).toBe(true);
  });
  it('pages come out sorted regardless of input order', () => {
    const md = composeExportMd(
      'X',
      [
        {page: 2, text: 'three'},
        {page: 0, text: 'one'},
      ],
      {date: '18/07/2026'},
    );
    expect(md.indexOf('## Page 1')).toBeLessThan(md.indexOf('## Page 3'));
  });
});

describe('v0.52 export polish', () => {
  it('header carries the transcript source and its datetime when given', () => {
    const md = composeExportMd('Doc', [{page: 0, text: 'hello'}], {
      date: '18/07/2026 21:40',
      source: {label: 'Mistral OCR 4 + Vision', at: '18/07/2026 14:02'},
    });
    expect(md).toContain(
      '> Exported by SmartNote AI at 18/07/2026 21:40 · 1/1 pages · Transcript source: Mistral OCR 4 + Vision at 18/07/2026 14:02',
    );
  });

  it('stripEmphasis: bold/italic removed, structure and code kept', () => {
    expect(stripEmphasis('a **doubt** word')).toBe('a doubt word');
    expect(stripEmphasis('keep *this* and _that_ clean')).toBe(
      'keep this and that clean',
    );
    expect(stripEmphasis('# Title\n- **item** one')).toBe('# Title\n- item one');
    expect(stripEmphasis('intra_word_stays')).toBe('intra_word_stays');
    expect(stripEmphasis('```\n**code** stays\n```')).toBe(
      '```\n**code** stays\n```',
    );
  });

  it('composeExportMd strips inline emphasis from page text', () => {
    const md = composeExportMd('D', [{page: 0, text: 'a **b** c'}], {
      date: 'x',
    });
    expect(md).toContain('a b c');
    expect(md).not.toContain('**');
  });
});
