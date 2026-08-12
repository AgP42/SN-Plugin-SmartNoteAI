// The exact device report of 2026-08-12: the same unsure word twice on one
// page — correcting one changed the other, and the untouched one stopped
// being flagged.
import {replaceNthWord, containsWord, lowAfterFix} from './wordFix';

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
