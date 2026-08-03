// The "The page is blank." detector (collecte ①). Strict on purpose:
// only an answer that IS the statement is eaten — never content that
// merely contains it.

import {isBlankAnswer} from './blankAnswer';

describe('isBlankAnswer', () => {
  it.each([
    'The page is blank.',
    'This page is blank',
    'The page appears to be blank.',
    'This page appears empty.',
    'Blank page.',
    '(blank page)',
    'Empty page',
    'No text on this page.',
    'No content visible.',
    'La page est vide.',
    'Page blanche.',
    '  The page is empty.  ',
  ])('detects %j', t => {
    expect(isBlankAnswer(t)).toBe(true);
  });

  it.each([
    '', // empty is not a STATEMENT (the empty path already handles it)
    'The page is blank at the top, then lists three action items: …',
    'Notes: the page is blank in my dream journal, funny thought.',
    'Réunion du 3 mars — budget vide à compléter',
    'blank', // too bare to be safely eaten? no — must mention a page
    'A'.repeat(200), // long content never matches
  ])('never eats real content: %j', t => {
    expect(isBlankAnswer(t)).toBe(false);
  });
});
