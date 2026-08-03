import {composePagesText, pagesForContext} from './composeContext';

describe('pagesForContext (0-indexed)', () => {
  const r = {start: 0, end: 0};
  it('page mode → just the current index (clamped to [0,total-1])', () => {
    expect(pagesForContext('page', 3, 10, r)).toEqual([3]);
    expect(pagesForContext('page', 99, 10, r)).toEqual([9]);
    expect(pagesForContext('page', -2, 10, r)).toEqual([0]);
  });
  it('note mode → every page index 0..total-1', () => {
    expect(pagesForContext('note', 3, 4, r)).toEqual([0, 1, 2, 3]);
    expect(pagesForContext('note', 0, 1, r)).toEqual([0]);
  });
  it('range mode → inclusive, clamped, auto-ordered (0-indexed)', () => {
    expect(pagesForContext('range', 0, 10, {start: 2, end: 4})).toEqual([
      2, 3, 4,
    ]);
    expect(pagesForContext('range', 0, 10, {start: 4, end: 2})).toEqual([
      2, 3, 4,
    ]);
    expect(pagesForContext('range', 0, 5, {start: 3, end: 99})).toEqual([3, 4]);
  });
});

describe('composePagesText (labels 1-indexed)', () => {
  it('appends labelled transcriptions (page+1), dropping empty pages', () => {
    const out = composePagesText('Summarize', [
      {page: 0, text: 'hello'},
      {page: 1, text: '   '},
      {page: 2, text: 'world'},
    ]);
    expect(out).toContain('Summarize');
    expect(out).toContain('--- Page 1 (transcribed) ---\nhello');
    expect(out).toContain('--- Page 3 (transcribed) ---\nworld');
    expect(out).not.toContain('Page 2');
  });
  it('returns the bare question when no page has text', () => {
    expect(composePagesText('Hi', [{page: 0, text: ''}])).toBe('Hi');
  });
  it('labels headers with the note name when provided', () => {
    const out = composePagesText('q', [{page: 2, text: 'x'}], 'ToDo');
    expect(out).toContain('--- Page 3 of "ToDo" (transcribed) ---\nx');
  });
});
