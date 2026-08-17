// MdTable height pin (v1.0.38) — the device-repro'd "giant void under a
// .md table". The horizontal ScrollView's height must follow the INNER
// table View's onLayout — contentSize was the poisoned source (it reports
// the container height, which the add-a-turn re-measure pass can stretch
// to the whole outer chat height; the old grow-only pin then kept that
// giant frame forever). Following onLayout both ways lets a bad frame
// heal on the next real layout pass.
import React from 'react';
import {ScrollView} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import MarkdownView from './MarkdownView';

const MD_TABLE = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |';

const flatHeight = (style: unknown): number | undefined => {
  const arr = Array.isArray(style) ? style : [style];
  let h: number | undefined;
  for (const s of arr) {
    if (s && typeof s === 'object' && 'height' in s) {
      h = (s as {height?: number}).height;
    }
  }
  return h;
};

describe('MdTable height pin', () => {
  const render = (): ReactTestRenderer => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<MarkdownView text={MD_TABLE} scale={1} />);
    });
    return r;
  };
  const tableScroll = (r: ReactTestRenderer) =>
    r.root.findAllByType(ScrollView).find(s => s.props.horizontal === true)!;
  const layTable = (r: ReactTestRenderer, height: number): void => {
    // The inner table View is the horizontal ScrollView's direct child.
    const inner = tableScroll(r).props.children;
    act(() => {
      inner.props.onLayout({nativeEvent: {layout: {height}}});
    });
  };

  it('renders the table cells inside a horizontal ScrollView', () => {
    const r = render();
    const sv = tableScroll(r);
    expect(sv).toBeDefined();
    // contentSize is no longer a height source — the poisoned reading.
    expect(sv.props.onContentSizeChange).toBeUndefined();
  });

  it('height follows the table onLayout — and SHRINKS back (poison heals)', () => {
    const r = render();
    expect(flatHeight(tableScroll(r).props.style)).toBeUndefined(); // pre-measure
    layTable(r, 120);
    expect(flatHeight(tableScroll(r).props.style)).toBe(120);
    // A pathological stretched pass pinned a giant frame…
    layTable(r, 4000);
    expect(flatHeight(tableScroll(r).props.style)).toBe(4000);
    // …and the next REAL pass heals it (the old grow-only pin never did).
    layTable(r, 120);
    expect(flatHeight(tableScroll(r).props.style)).toBe(120);
  });
});
