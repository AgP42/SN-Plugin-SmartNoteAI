import {parseInline, parseMarkdown, type MdBlock} from './markdown';

// Concatenate every inline span's text back into one string — used to
// prove the parser never loses characters.
const flat = (blocks: MdBlock[]): string =>
  blocks
    .map(b => {
      switch (b.k) {
        case 'h':
        case 'p':
        case 'quote':
          return b.spans.map(s => s.s).join('');
        case 'ul':
        case 'ol':
          return b.items.map(it => it.map(s => s.s).join('')).join('\n');
        case 'code':
          return b.text;
        case 'table':
          return [b.header, ...b.rows].map(r => r.join('|')).join('\n');
      }
    })
    .join('\n');

describe('parseMarkdown — blocks', () => {
  it('parses headings and clamps levels 4-6 to 3', () => {
    const b = parseMarkdown('# One\n## Two\n### Three\n#### Four\n###### Six');
    expect(b.map(x => x.k === 'h' && x.level)).toEqual([1, 2, 3, 3, 3]);
    expect(b[0]).toMatchObject({k: 'h', level: 1});
    expect((b[0] as any).spans[0].s).toBe('One');
  });

  it('groups consecutive bullet lines into one ul (marker stripped)', () => {
    const b = parseMarkdown('- a\n* b\n+ c');
    expect(b).toHaveLength(1);
    expect(b[0].k).toBe('ul');
    const ul = b[0] as Extract<MdBlock, {k: 'ul'}>;
    expect(ul.items.map(it => it.map(s => s.s).join(''))).toEqual(['a', 'b', 'c']);
  });

  it('groups numbered lines into one ol keeping the first number as start', () => {
    const b = parseMarkdown('3. first\n4. second');
    expect(b).toHaveLength(1);
    const ol = b[0] as Extract<MdBlock, {k: 'ol'}>;
    expect(ol.start).toBe(3);
    expect(ol.items.map(it => it.map(s => s.s).join(''))).toEqual([
      'first',
      'second',
    ]);
  });

  it('merges consecutive quote lines with a space', () => {
    const b = parseMarkdown('> line one\n> line two');
    expect(b).toHaveLength(1);
    expect(b[0].k).toBe('quote');
    expect((b[0] as any).spans.map((s: any) => s.s).join('')).toBe(
      'line one line two',
    );
  });

  it('parses a closed fenced code block raw', () => {
    const b = parseMarkdown('```\nconst x = 1;\n**not bold**\n```');
    expect(b).toHaveLength(1);
    expect(b[0]).toEqual({k: 'code', text: 'const x = 1;\n**not bold**'});
  });

  it('treats an unclosed fence as code to the end', () => {
    const b = parseMarkdown('before\n\n```\nstill code\nmore');
    expect(b[b.length - 1]).toEqual({k: 'code', text: 'still code\nmore'});
  });

  it('parses a GitHub-style table with trimmed cells', () => {
    const b = parseMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
    expect(b).toHaveLength(1);
    expect(b[0]).toEqual({
      k: 'table',
      header: ['a', 'b'],
      rows: [
        ['1', '2'],
        ['3', '4'],
      ],
    });
  });

  it('reflows consecutive plain lines into one paragraph', () => {
    const b = parseMarkdown('hello world\nsecond line\n\nnew para');
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({k: 'p'});
    expect((b[0] as any).spans.map((s: any) => s.s).join('')).toBe(
      'hello world second line',
    );
    expect((b[1] as any).spans.map((s: any) => s.s).join('')).toBe('new para');
  });

  it('does not merge a paragraph across a heading/list boundary', () => {
    const b = parseMarkdown('para text\n# Heading\n- item');
    expect(b.map(x => x.k)).toEqual(['p', 'h', 'ul']);
  });
});

describe('parseInline', () => {
  it('parses well-formed bold, italic and code', () => {
    expect(parseInline('a **b** c')).toEqual([
      {t: 'text', s: 'a '},
      {t: 'bold', s: 'b'},
      {t: 'text', s: ' c'},
    ]);
    expect(parseInline('_it_ and `co`')).toEqual([
      {t: 'italic', s: 'it'},
      {t: 'text', s: ' and '},
      {t: 'code', s: 'co'},
    ]);
    expect(parseInline('__strong__')).toEqual([{t: 'bold', s: 'strong'}]);
  });

  it('keeps code content literal (no inner markers parsed)', () => {
    expect(parseInline('`**x**`')).toEqual([{t: 'code', s: '**x**'}]);
  });
});

describe('robustness — malformed markdown never loses text or throws', () => {
  it('unbalanced ** stays literal', () => {
    const r = parseInline('a **bold and no close');
    expect(() => parseInline('a **bold and no close')).not.toThrow();
    expect(r.map(s => s.s).join('')).toBe('a **bold and no close');
  });

  it('empty **, empty ``, and a stray * are kept as literal text', () => {
    expect(parseInline('****').map(s => s.s).join('')).toBe('****');
    expect(parseInline('``').map(s => s.s).join('')).toBe('``');
    expect(parseInline('a * b').map(s => s.s).join('')).toBe('a * b');
  });

  it('parseMarkdown never throws on messy input', () => {
    expect(() =>
      parseMarkdown('# \n> \n- \n```\n| broken |\nstray ** text _'),
    ).not.toThrow();
  });
});

describe('plain-text round-trip preserves every word', () => {
  it('plain input with no markers yields paragraphs equal to the input lines', () => {
    const src = 'The quick brown fox\njumps over the lazy dog';
    const b = parseMarkdown(src);
    expect(b).toHaveLength(1);
    expect(b[0].k).toBe('p');
    // reflowed with a space, no characters lost
    expect((b[0] as any).spans.map((s: any) => s.s).join('')).toBe(
      'The quick brown fox jumps over the lazy dog',
    );
  });

  it('flattened output of a mixed document contains all the text', () => {
    const src = 'Intro para\n\n# Title\n- one\n- two\n\n> quoted';
    expect(flat(parseMarkdown(src))).toContain('Intro para');
    expect(flat(parseMarkdown(src))).toContain('one');
    expect(flat(parseMarkdown(src))).toContain('quoted');
  });
});

import {mdToPlain} from './markdown';

describe('mdToPlain (compact previews)', () => {
  it('strips heading/bold/code markers to clean text', () => {
    expect(mdToPlain('# Title\n\nsome **bold** and `code` here')).toBe(
      'Title\nsome bold and code here',
    );
  });
  it('keeps bullet/number structure readably', () => {
    expect(mdToPlain('- one\n- two')).toBe('• one\n• two');
    expect(mdToPlain('3. a\n4. b')).toBe('3. a\n4. b');
  });
  it('flattens a table to dotted rows', () => {
    const t = '| A | B |\n|---|---|\n| 1 | 2 |';
    expect(mdToPlain(t)).toBe('A · B\n1 · 2');
  });
  it('plain text passes through unchanged', () => {
    expect(mdToPlain('just words here')).toBe('just words here');
  });
});

describe('audit 2026-07-18 regressions', () => {
  it('unicode bullets and checkboxes keep their lines (no prose-join)', () => {
    const b = parseMarkdown('• milk\n• eggs\n✓ done\n✗ not done');
    expect(b[0]).toEqual({
      k: 'ul',
      items: [
        [{t: 'text', s: 'milk'}],
        [{t: 'text', s: 'eggs'}],
      ],
    });
    // checkbox lines stay separate paragraphs, glyph kept
    expect(b[1].k).toBe('p');
    expect((b[1] as any).spans[0].s).toBe('✓ done');
    expect(b[2].k).toBe('p');
    expect((b[2] as any).spans[0].s).toBe('✗ not done');
  });

  it('N) numbering lines are not merged together', () => {
    const b = parseMarkdown('1) first\n2) second');
    expect(b).toHaveLength(2);
    expect((b[0] as any).spans[0].s).toBe('1) first');
  });

  it('one-line ```code``` keeps its content (was dropped)', () => {
    const b = parseMarkdown('Use this:\n```ls -la```\nthen done');
    expect(b[1]).toEqual({k: 'p', spans: [{t: 'code', s: 'ls -la'}]});
    expect((b[2] as any).spans[0].s).toBe('then done');
  });

  it('content on an opening fence line is kept as first body line', () => {
    const b = parseMarkdown('```echo hi\nmore\n```');
    expect(b[0]).toEqual({k: 'code', text: 'echo hi\nmore'});
  });

  it("a bare '---' after a line with a pipe is NOT a table", () => {
    const b = parseMarkdown('Price: 5 | Qual: 8\n---\nnext para');
    expect(b.every(x => x.k !== 'table')).toBe(true);
  });

  it('flanking rules: spaced asterisks and snake_case stay literal', () => {
    const flat = (s: string) =>
      parseMarkdown(s)
        .flatMap(x => (x.k === 'p' ? (x as any).spans : []))
        .map((sp: any) => sp.s)
        .join('');
    expect(flat('5 * 3 * 2')).toBe('5 * 3 * 2');
    expect(flat('file_name_here')).toBe('file_name_here');
    // real emphasis still works
    expect(parseMarkdown('a *b* c')[0]).toEqual({
      k: 'p',
      spans: [
        {t: 'text', s: 'a '},
        {t: 'italic', s: 'b'},
        {t: 'text', s: ' c'},
      ],
    });
  });
});

describe('horizontal rules (v0.65.1 — the "--- une phrase" report)', () => {
  it('a bare --- line becomes an hr block', () => {
    const b = parseMarkdown('avant\n\n---\n\naprès');
    expect(b.map(x => x.k)).toEqual(['p', 'hr', 'p']);
  });

  it('SALVAGE: a pre-fix glued "--- une phrase" renders as hr + paragraph', () => {
    const b = parseMarkdown('--- une phrase importante');
    expect(b.map(x => x.k)).toEqual(['hr', 'p']);
    expect(
      b[1].k === 'p' && b[1].spans.map(s => s.s).join(''),
    ).toBe('une phrase importante');
  });

  it('*** and ___ work too; -- (two dashes) stays text', () => {
    expect(parseMarkdown('***')[0].k).toBe('hr');
    expect(parseMarkdown('___')[0].k).toBe('hr');
    expect(parseMarkdown('-- tiret double')[0].k).toBe('p');
  });

  it('corpus: every construct Mistral emits renders as its block, no raw markers', () => {
    const corpus = [
      '# Titre', '## Sous-titre', 'Para **gras** *italique* `code`.',
      '---', '- puce un', '- puce deux', '1. num un', '2. num deux',
      '> citation', '```', 'code fence', '```',
      '| a | b |', '|---|---|', '| 1 | 2 |',
    ].join('\n');
    const kinds = parseMarkdown(corpus).map(b => b.k);
    expect(kinds).toEqual(['h', 'h', 'p', 'hr', 'ul', 'ol', 'quote', 'code', 'table']);
  });
});

describe('unclosed-wrapper self-heal (pages stored before the fence-aware reflow)', () => {
  it('salvages a mangled wrapper: opening fence + closing glued on the last word', () => {
    const stored = '```markdown\n# Plugin dev\n\nIdée : utiliser adb.\n\n- point un\n- point deux ```';
    const blocks = parseMarkdown(stored);
    expect(blocks.map(b => b.k)).toEqual(['h', 'p', 'ul']);
  });

  it('leaves a properly closed lone code block untouched', () => {
    const stored = '```\nadb logcat -d\n```';
    const blocks = parseMarkdown(stored);
    expect(blocks).toEqual([{k: 'code', text: 'adb logcat -d'}]);
  });

  it('a truly unclosed code page with no markdown inside stays code', () => {
    const stored = '```\nline one\nline two';
    const blocks = parseMarkdown(stored);
    expect(blocks.map(b => b.k)).toEqual(['code']);
  });
});
