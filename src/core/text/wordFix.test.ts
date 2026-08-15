// The exact device report of 2026-08-12: the same unsure word twice on one
// page — correcting one changed the other, and the untouched one stopped
// being flagged.
import {
  replaceNthWord,
  containsWord,
  lowAfterFix,
  wordOffsets,
  replaceAtOffset,
} from './wordFix';

const TEXT = 'Voir avec Lemaire pour le budget, puis relancer Lemaire jeudi.';

describe('replaceNthWord', () => {
  it('rewrites the SECOND occurrence when the second one was tapped', () => {
    expect(replaceNthWord(TEXT, 'Lemaire', 1, 'Lemaître')).toBe(
      'Voir avec Lemaire pour le budget, puis relancer Lemaître jeudi.',
    );
  });

  it('rewrites the first when the first was tapped', () => {
    expect(replaceNthWord(TEXT, 'Lemaire', 0, 'Lemaître')).toBe(
      'Voir avec Lemaître pour le budget, puis relancer Lemaire jeudi.',
    );
  });

  it('leaves the text alone when the ordinal is out of range', () => {
    expect(replaceNthWord(TEXT, 'Lemaire', 7, 'X')).toBe(TEXT);
  });

  it('never touches a longer word that merely contains it', () => {
    expect(replaceNthWord('Lemairent Lemaire', 'Lemaire', 0, 'X')).toBe(
      'Lemairent X',
    );
  });

  it('a correction containing $ is inserted verbatim (no group re-expansion)', () => {
    expect(replaceNthWord('coût de 100 euros', '100', 0, '$100')).toBe(
      'coût de $100 euros',
    );
  });

  it('respects accents at the boundary', () => {
    expect(replaceNthWord('réunion réunions', 'réunion', 0, 'point')).toBe(
      'point réunions',
    );
  });
});

describe('lowAfterFix', () => {
  const low = [{t: 'Lemaire', c: 0.4}, {t: 'budget', c: 0.6}];

  it('KEEPS the word flagged while another occurrence is still there', () => {
    const after = replaceNthWord(TEXT, 'Lemaire', 1, 'Lemaître');
    expect(lowAfterFix(low, 'Lemaire', after).map(w => w.t)).toEqual([
      'Lemaire',
      'budget',
    ]);
  });

  it('drops it once the last occurrence is gone', () => {
    let after = replaceNthWord(TEXT, 'Lemaire', 1, 'Lemaître');
    after = replaceNthWord(after, 'Lemaire', 0, 'Lemaître');
    expect(containsWord(after, 'Lemaire')).toBe(false);
    expect(lowAfterFix(low, 'Lemaire', after).map(w => w.t)).toEqual(['budget']);
  });
});

// Audit 2026-08-12: MarkdownView keys occurrences case-insensitively and hands
// out a case-insensitive ordinal. When the same flagged word shows up in mixed
// case, a case-sensitive recount here reopened the very twice-on-a-page bug.
describe('mixed case — the ordinal comes from MarkdownView (case-insensitive)', () => {
  it('corrects the SECOND occurrence even when it is a different case', () => {
    // "Unsure" (nth 0) … "unsure" (nth 1); the user taps the lowercase twin.
    expect(replaceNthWord('Unsure about it. It is unsure again.', 'unsure', 1, 'sure')).toBe(
      'Unsure about it. It is sure again.',
    );
  });

  it('corrects the FIRST even when the tapped token is lower than the text', () => {
    expect(replaceNthWord('Unsure about it.', 'unsure', 0, 'Sure')).toBe(
      'Sure about it.',
    );
  });

  it('KEEPS the word flagged while a differently-cased twin survives', () => {
    // Fix the lowercase one; "Unsure" (capitalised) is still on the page and
    // still flagged — it must not silently leave the low list.
    const low = [{t: 'unsure', c: 0.4}];
    const after = replaceNthWord('It is unsure. Truly Unsure.', 'unsure', 0, 'sure');
    expect(after).toBe('It is sure. Truly Unsure.');
    expect(containsWord(after, 'unsure')).toBe(true);
    expect(lowAfterFix(low, 'unsure', after).map(w => w.t)).toEqual(['unsure']);
  });

  it('drops the word only once every case-variant occurrence is gone', () => {
    const low = [{t: 'unsure', c: 0.4}];
    let after = replaceNthWord('It is unsure. Truly Unsure.', 'unsure', 1, 'Sure');
    after = replaceNthWord(after, 'unsure', 0, 'sure');
    expect(containsWord(after, 'unsure')).toBe(false);
    expect(lowAfterFix(low, 'unsure', after)).toEqual([]);
  });
});

// K3 (full-scope audit 2026-08-12): the tap ordinal from MarkdownView skips
// table cells and code spans, but a by-count replace on the RAW markdown did
// not — so tapping a paragraph word rewrote a table cell that held the same
// word. wordOffsets skips exactly those regions, so the ordinal maps to the
// occurrence actually on screen.
describe('wordOffsets / replaceAtOffset — table & code aware (K3)', () => {
  const TABLE =
    '| config |\n| --- |\n| x |\n\nThe config value is set.';

  it('skips a table cell: the only tappable "config" is the paragraph one', () => {
    const offs = wordOffsets(TABLE, 'config');
    expect(offs.length).toBe(1); // NOT the table-cell occurrence
    // The single offset points at the paragraph word.
    expect(TABLE.slice(offs[0], offs[0] + 6)).toBe('config');
    expect(TABLE.slice(0, offs[0])).toContain('The '); // it is in the sentence
  });

  it('correcting the tapped (nth 0) word never touches the table cell', () => {
    const off = wordOffsets(TABLE, 'config')[0];
    const out = replaceAtOffset(TABLE, off, 'config', 'context');
    expect(out).toBe('| config |\n| --- |\n| x |\n\nThe context value is set.');
    expect(out).toContain('| config |'); // the table is untouched
  });

  it('skips inline code spans', () => {
    const t = 'Use `config` here, then config again.';
    const offs = wordOffsets(t, 'config');
    expect(offs.length).toBe(1); // the code-span one is skipped
    expect(t.slice(offs[0], offs[0] + 6)).toBe('config');
  });

  it('plain prose: offsets match every occurrence in order', () => {
    const t = 'config then Config then CONFIG';
    expect(wordOffsets(t, 'config')).toEqual([0, 12, 24]); // case-insensitive
  });

  it('replaceAtOffset is a no-op on a stale offset (never corrupts text)', () => {
    const t = 'the config value';
    expect(replaceAtOffset(t, 999, 'config', 'x')).toBe(t); // out of range
    expect(replaceAtOffset(t, 0, 'config', 'x')).toBe(t); // "the" ≠ "config"
  });

  it('a --- rule (no pipe) under a pipe sentence is NOT masked as a table', () => {
    // Regression audit 2026-08-12: the mask's separator test must match the
    // parser (require a pipe). "Cost | ~50 unsure" is a PARAGRAPH here (the next
    // line "---" has no pipe), so "unsure" is tappable at nth 0.
    const t = 'Cost | ~50 unsure\n---\nMore text here.';
    const offs = wordOffsets(t, 'unsure');
    expect(offs.length).toBe(1);
    expect(t.slice(offs[0], offs[0] + 6)).toBe('unsure');
  });

  it('a ```-prefixed content line inside a fence does not close it early', () => {
    // Only a BARE ``` closes a fence (parser rule). The "```json still code"
    // line must NOT close it (a naive any-``` toggle would, then re-open and
    // swallow the prose). "unsure" after the real close is the single tap.
    const t = '```\nline one\n```json still code\n```\nthen unsure here';
    const offs = wordOffsets(t, 'unsure');
    expect(offs.length).toBe(1);
    expect(t.slice(offs[0], offs[0] + 6)).toBe('unsure');
  });

  it('does NOT match inside a hyphenated compound (après-midi)', () => {
    // Re-audit 2026-08-12: apostrophe/hyphen are WORD chars (like WORD_SPLIT),
    // so "midi" must not match inside "après-midi" — only the standalone one.
    const t = 'Rendez-vous cet après-midi. Le midi compte.';
    const offs = wordOffsets(t, 'midi');
    expect(offs.length).toBe(1);
    expect(t.slice(offs[0], offs[0] + 4)).toBe('midi');
    expect(t.slice(0, offs[0])).toContain('Le '); // the standalone one
    // And a fix hits the standalone, never the compound.
    const out = replaceAtOffset(t, offs[0], 'midi', 'soir');
    expect(out).toBe('Rendez-vous cet après-midi. Le soir compte.');
  });

  it('does NOT match after an elision apostrophe (l’heure)', () => {
    const t = 'On perd l’heure. Quelle heure est-il ?';
    const offs = wordOffsets(t, 'heure');
    expect(offs.length).toBe(1); // not the "heure" inside "l’heure"
    expect(t.slice(0, offs[0])).toContain('Quelle ');
  });

  it('a one-line ```code``` leaves its trailing prose tappable', () => {
    // The parser renders "```x```" as inline code + the rest as a paragraph.
    const t = 'Set ```x``` then unsure remains here.';
    const offs = wordOffsets(t, 'unsure');
    expect(offs.length).toBe(1);
    expect(t.slice(offs[0], offs[0] + 6)).toBe('unsure');
  });

  it('a leftover in a table cell does NOT keep the word flagged', () => {
    const low = [{t: 'config', c: 0.4}];
    // Fix the only paragraph occurrence; a table-cell "config" remains but is
    // not tappable/flagged on screen, so the chip must go.
    const off = wordOffsets(TABLE, 'config')[0];
    const after = replaceAtOffset(TABLE, off, 'config', 'context');
    expect(lowAfterFix(low, 'config', after)).toEqual([]);
  });
});
