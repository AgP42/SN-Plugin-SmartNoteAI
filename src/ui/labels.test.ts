// Shared UI vocabulary. Pins the provenance names the user decided on
// (2026-07-12) and the date/name formatters the whole UI leans on.

import {SRC_LABEL, SRC_LONG, fmtDay, fmtDateTime, baseName} from './labels';

describe('provenance labels', () => {
  it('keeps the user-decided names, one per source', () => {
    expect(SRC_LABEL['mistral-ocr']).toBe('Mistral OCR');
    expect(SRC_LABEL.medium).toBe('Mistral OCR+Vision');
    expect(SRC_LABEL.improved).toBe('Mistral OCR+Vision'); // same family
    expect(SRC_LABEL.user).toBe('Manual');
    expect(SRC_LABEL.guide).toBe('Guide');
    // SRC_LONG tells medium and improved apart from the short label side.
    expect(SRC_LONG.user).toContain('edited by you');
    expect(Object.keys(SRC_LONG).sort()).toEqual(
      Object.keys(SRC_LABEL).sort(),
    );
  });
});

describe('date formatters', () => {
  // Built from LOCAL components so the assertions are TZ-proof.
  const at = new Date(2026, 6, 5, 14, 3).getTime(); // 5 July 2026, 14:03

  it('fmtDay → "5/07" (compact chip day)', () => {
    expect(fmtDay(at)).toBe('5/07');
  });

  it('fmtDateTime carries the date AND the time (user 2026-07-15)', () => {
    const s = fmtDateTime(at);
    expect(s).toContain('2026');
    expect(s).toContain('14:03');
  });
});

describe('baseName', () => {
  it('strips the directory and the known extensions, case-insensitive', () => {
    expect(baseName('/storage/Note/Work/Réunion.note')).toBe('Réunion');
    expect(baseName('/storage/Document/spec.PDF')).toBe('spec');
    expect(baseName('/x/book.epub')).toBe('book');
  });

  it('strips only the LAST extension (a .pdf.mark keeps its .pdf identity)', () => {
    expect(baseName('/x/annotated.pdf.mark')).toBe('annotated.pdf');
  });

  it('leaves unknown extensions alone and survives odd paths', () => {
    expect(baseName('/x/archive.zip')).toBe('archive.zip');
    expect(baseName('bare.note')).toBe('bare');
    expect(baseName('')).toBe('');
  });
});
