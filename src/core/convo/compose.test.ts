import {composeUserText, DEFAULT_SYSTEM} from './compose';

describe('composeUserText', () => {
  it('returns just the message when there is no page text', () => {
    expect(composeUserText('  hello  ', '')).toBe('hello');
  });
  it('appends the transcribed page under a labelled header', () => {
    const out = composeUserText('what is this?', '  Meeting notes ');
    expect(out).toContain('what is this?');
    expect(out).toContain('--- Page (transcribed) ---');
    expect(out).toContain('Meeting notes');
  });
  it('labels the header with the note name when provided', () => {
    const out = composeUserText('q', 'txt', 'ToDo');
    // Must keep the '--- Page' prefix — the UI strip marker.
    expect(out).toContain('--- Page of "ToDo" (transcribed) ---');
  });
  it('has a non-empty default system prompt', () => {
    expect(DEFAULT_SYSTEM.length).toBeGreaterThan(20);
  });
});

// v0.54: "add to context" blocks + the shared strip helper.
import {composeAddedText, stripContextBlocks} from './compose';

describe('composeAddedText', () => {
  it('returns the base unchanged with no blocks', () => {
    expect(composeAddedText('q', [])).toBe('q');
  });
  it('appends one labelled block per added page, 1-indexed', () => {
    const out = composeAddedText('q', [
      {name: 'Meetings', page: 3, text: ' budget Q3 '},
      {name: 'Projet', page: 10, text: 'serré'},
    ]);
    expect(out).toContain('--- Added: "Meetings" p.4 (transcribed) ---\nbudget Q3');
    expect(out).toContain('--- Added: "Projet" p.11 (transcribed) ---\nserré');
    expect(out.startsWith('q\n\n')).toBe(true);
  });
  it('skips blocks whose text is empty', () => {
    expect(composeAddedText('q', [{name: 'N', page: 0, text: '  '}])).toBe('q');
  });
});

describe('stripContextBlocks', () => {
  it('returns plain text unchanged', () => {
    expect(stripContextBlocks('hello')).toBe('hello');
  });
  it('cuts at a page block', () => {
    expect(
      stripContextBlocks('q\n\n--- Page (transcribed) ---\ntxt'),
    ).toBe('q');
  });
  it('cuts at an added block', () => {
    expect(
      stripContextBlocks('q\n\n--- Added: "N" p.2 (transcribed) ---\ntxt'),
    ).toBe('q');
  });
  it('cuts at the EARLIEST marker when both are present', () => {
    const out = stripContextBlocks(
      'q\n\n--- Added: "N" p.2 (transcribed) ---\nt\n\n--- Page (transcribed) ---\np',
    );
    expect(out).toBe('q');
  });
});
