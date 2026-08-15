// Smoke test — UI refactor Lot 2 (2026-08-03). Search hit rows: open /
// go-to / add-to wiring, and the Off refusal chip in place of the picker.
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import SearchHitsList, {type SearchHitsListProps} from './SearchHitsList';
import type {SearchHit} from '../../src/core/store/librarySearch';
import {
  flatText as texts,
  pressByText as press,
} from '../../src/ui/componentTestUtils';

const hit = (over: Partial<SearchHit> = {}): SearchHit =>
  ({
    path: '/Note/Work/meeting.note',
    name: 'meeting',
    page: 2,
    snippet: 'relire le budget mardi',
    terms: ['budget'],
    ...over,
  } as SearchHit);

const baseProps = (over: Partial<SearchHitsListProps> = {}): SearchHitsListProps => ({
  hits: [hit()],
  autoTargets: {},
  agents: [],
  scale: 1,
  btnScale: 1,
  onOpenHit: jest.fn(),
  onGoToPage: jest.fn(),
  onAddContext: jest.fn(),
  ...over,
});

const render = (p: SearchHitsListProps): ReactTestRenderer => {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(<SearchHitsList {...p} />);
  });
  return r;
};

describe('SearchHitsList smoke', () => {
  it('empty: explains why nothing matched', () => {
    const r = render(baseProps({hits: []}));
    expect(texts(r)).toContain('No match');
  });

  it('a hit row shows name · page and snippet; Transcript and Go to page wired', () => {
    const p = baseProps();
    const r = render(p);
    expect(texts(r)).toContain('meeting · p.3');
    expect(texts(r)).toContain('budget');
    press(r, 'Transcript');
    expect(p.onOpenHit).toHaveBeenCalled();
    press(r, 'Go to page');
    expect(p.onGoToPage).toHaveBeenCalledWith('/Note/Work/meeting.note', 2);
  });

  it('a tracked doc offers + Add to ▾', () => {
    // Default mode is Off (2026-08-12), so the doc must be explicitly tracked
    // to offer the picker — an untracked doc now shows the Off chip.
    const r = render(
      baseProps({autoTargets: {'/Note/Work/meeting.note': {mode: 'manual'}}}),
    );
    expect(texts(r)).toContain('+ Add to ▾');
    expect(texts(r)).not.toContain('Off');
  });

  it('an Off doc shows the grey refusal chip INSTEAD of the picker', () => {
    const r = render(
      baseProps({autoTargets: {'/Note/Work/meeting.note': {mode: 'off'}}}),
    );
    expect(texts(r)).toContain('Off');
    expect(texts(r)).not.toContain('+ Add to');
  });
});
