// Smoke test — UI refactor Lot 1 (2026-08-03). PageView renders one
// page's transcript + controls from real-shaped props. Pins the v1.0.4
// lock behaviour: Redo / Rotate±redo are DISABLED (greyed) whenever the
// page or the whole document is locked.
import React from 'react';
import {Text, View} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import PageView, {type PageViewProps} from './PageView';
import {
  flatText as texts,
  instanceText,
  pressByText as press,
} from '../../src/ui/componentTestUtils';

const subHeader = (title: string): React.JSX.Element => (
  <View>
    <Text>{title}</Text>
  </View>
);

const baseProps = (over: Partial<PageViewProps> = {}): PageViewProps => ({
  browseDoc: '/Note/Work/meeting.note',
  browsePage: 0,
  browsePages: [
    {page: 0, snippet: 'du texte', src: 'mistral-ocr'},
    {page: 1, snippet: 'suite', src: 'mistral-ocr'},
  ],
  pageView: {text: 'Bonjour le monde', label: 'Mistral OCR', low: []},
  pageEditing: false,
  setPageEditing: jest.fn(),
  pageDraft: '',
  setPageDraft: jest.fn(),
  pageBusy: false,
  wordFix: null,
  setWordFix: jest.fn(),
  pageImg: null,
  pageImgFail: false,
  nativeOcr: null,
  keyOk: true,
  scale: 1,
  btnScale: 1,
  openPage: jest.fn(async () => {}),
  savePageEdit: jest.fn(async () => {}),
  applyWordFix: jest.fn(async () => {}),
  rereadPage: jest.fn(async () => {}),
  pageLocked: false,
  docLocked: false,
  onTogglePageLock: jest.fn(),
  goToNotePage: jest.fn(),
  refreshBrowsePages: jest.fn(async () => {}),
  setBrowsePage: jest.fn(),
  subHeader,
  agents: [],
  onAddContext: jest.fn(),
  ctxFlash: '',
  ...over,
});

const render = (props: PageViewProps): ReactTestRenderer => {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(<PageView {...props} />);
  });
  return r;
};

// The disabled state of the pressable whose flattened label contains `label`.
const disabledOf = (r: ReactTestRenderer, label: string): boolean => {
  const btn = r.root
    .findAll(n => typeof n.props.onPress === 'function')
    .find(n => instanceText(n).includes(label));
  if (btn === undefined) {
    throw new Error(`no pressable containing "${label}"`);
  }
  return btn.props.disabled === true;
};

describe('PageView smoke', () => {
  it('shows the transcript, its source label and the page position', () => {
    const r = render(baseProps());
    const t = texts(r);
    expect(t).toContain('Bonjour le monde');
    expect(t).toContain('Source: Mistral OCR');
    expect(t).toContain('p.1/2');
  });

  it('unlocked: Redo fires rereadPage, Edit opens the editor', () => {
    const p = baseProps();
    const r = render(p);
    expect(disabledOf(r, 'Redo AI transcript')).toBe(false);
    press(r, 'Redo AI transcript');
    expect(p.rereadPage).toHaveBeenCalled();
    press(r, '✎ Edit');
    expect(p.setPageEditing).toHaveBeenCalledWith(true);
  });

  it('page locked: Redo and both Rotate+redo are disabled, the lock note shows', () => {
    const r = render(baseProps({pageLocked: true}));
    expect(texts(r)).toContain('Page locked');
    expect(disabledOf(r, 'Redo AI transcript')).toBe(true);
    expect(disabledOf(r, 'Rotate right + redo')).toBe(true);
    expect(disabledOf(r, 'Rotate left + redo')).toBe(true);
  });

  it('doc locked: same greying, and the page-lock toggle is frozen too', () => {
    const r = render(baseProps({docLocked: true}));
    expect(texts(r)).toContain('Document locked');
    expect(disabledOf(r, 'Redo AI transcript')).toBe(true);
    expect(disabledOf(r, 'Locked with the whole document')).toBe(true);
  });
});
