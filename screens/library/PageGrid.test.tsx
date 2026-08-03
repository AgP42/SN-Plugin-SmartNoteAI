// Smoke test — UI refactor Lot 1 (2026-08-03). PageGrid renders one
// document's tiles from real-shaped props: read, blank-read and unread
// pages each show their honest label, and tapping a tile opens the page.
import React from 'react';
import {Text, View} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import PageGrid, {type PageGridProps} from './PageGrid';
import {BLANK_SRC_LABEL} from '../../src/ui/labels';
import {
  flatText as texts,
  pressByText as press,
} from '../../src/ui/componentTestUtils';

const subHeader = (title: string): React.JSX.Element => (
  <View>
    <Text>{title}</Text>
  </View>
);

const baseProps = (over: Partial<PageGridProps> = {}): PageGridProps => ({
  browseDoc: '/Note/Work/meeting.note',
  browsePages: [
    {page: 0, snippet: 'premier contenu lu', src: 'mistral-ocr'},
    {page: 1, snippet: '', src: 'mistral-ocr'}, // read, found blank
    {page: 2, snippet: '', src: null}, // never read
  ],
  exportSel: null,
  setExportSel: jest.fn(),
  exporting: false,
  msg: '',
  exportAskCard: null,
  exportDone: null,
  startExport: jest.fn(async () => {}),
  openPage: jest.fn(async () => {}),
  setBrowseDoc: jest.fn(),
  subHeader,
  scale: 1,
  btnScale: 1,
  agents: [],
  onAddContext: jest.fn(),
  onClearDocTranscript: jest.fn(),
  docLocked: false,
  lockedPages: 0,
  onToggleDocLock: jest.fn(),
  ctxFlash: '',
  ...over,
});

const render = (props: PageGridProps): ReactTestRenderer => {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(<PageGrid {...props} />);
  });
  return r;
};

describe('PageGrid smoke', () => {
  it('shows the doc name, the transcribed count and one honest tile per state', () => {
    const r = render(baseProps());
    const t = texts(r);
    expect(t).toContain('meeting.note');
    expect(t).toContain('2 transcribed / 3 page(s)');
    expect(t).toContain('premier contenu lu'); // read tile: its snippet
    expect(t).toContain('(blank page)'); // blank tile body
    expect(t).toContain(BLANK_SRC_LABEL); // blank tile source — never Mistral
    expect(t).toContain('not read yet'); // unread tile
  });

  it('tapping a tile opens that page', () => {
    const p = baseProps();
    const r = render(p);
    press(r, 'premier contenu lu');
    expect(p.openPage).toHaveBeenCalledWith(0);
  });

  it('the document lock chip reflects the locked state', () => {
    const locked = render(baseProps({docLocked: true}));
    expect(texts(locked)).toContain('🔓 Unlock document');
    const partial = render(baseProps({lockedPages: 2}));
    expect(texts(partial)).toContain('🔒 Lock document (2 p. locked)');
  });
});
