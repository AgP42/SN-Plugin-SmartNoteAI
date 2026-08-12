/**
 * MarkdownView — renders the lightweight Markdown produced by the AI /
 * stored in transcripts as formatted React Native text, so `#`, `**`,
 * `-`, tables etc. DISPLAY as headings, bold, bullets and grids instead
 * of showing their literal markers. Parsing lives in the pure core
 * (src/core/text/markdown.ts); this is a thin, robust view over it.
 *
 * e-ink: pure black on transparent, no theme. `scale` multiplies every
 * font size (base ~14×scale, matching how ChatPanel sizes its text). The
 * whole thing is copy-selectable.
 */
import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import type {TextStyle} from 'react-native';

import {
  parseMarkdown,
  type InlineSpan,
  type MdBlock,
} from './src/core/text/markdown';
import {WORD_SPLIT} from './src/core/text/lowMatch';

// v0.78.3: a Markdown table rendered in a HORIZONTAL ScrollView (so wide
// tables scroll instead of cramming into character-wrapping columns), with
// its height PINNED to the measured content height. Pinning is what stops
// the old ballooning bug: a horizontal ScrollView nested in the chat's
// vertical ScrollView otherwise gets re-measured to the OUTER content
// height when a new turn is added. Own component so it can hold that
// measured-height state (a hook can't live inside renderBlock's map).
function MdTable({
  header,
  rows,
  fs,
  gap,
  selectable,
}: {
  header: string[];
  rows: string[][];
  fs: number;
  gap: number;
  selectable: boolean;
}): React.JSX.Element {
  const [h, setH] = React.useState<number | undefined>(undefined);
  const cols = Math.max(header.length, ...rows.map(r => r.length), 1);
  const pad = (r: string[]): string[] =>
    r.length >= cols ? r : [...r, ...Array(cols - r.length).fill('')];
  const cell: TextStyle = {
    minWidth: fs * 6,
    maxWidth: fs * 16,
    fontSize: fs,
    lineHeight: fs * 1.4,
    color: BLACK,
    paddingHorizontal: fs * 0.5,
    paddingVertical: fs * 0.25,
  };
  const rowStyle = {flexDirection: 'row' as const};
  return (
    <ScrollView
      horizontal
      style={{marginBottom: gap, height: h}}
      showsHorizontalScrollIndicator
      // v0.81 (user): height follows the REAL content height (grow-only, so
      // no feedback loop / freeze) — the old set-once onLayout pin measured
      // too early and clipped the bottom rows of tall tables (the "can't
      // scroll to the bottom" bug). onContentSizeChange fires AFTER the
      // cells wrap, so the box always shows the whole table; the outer chat
      // scroll handles the vertical, this one the horizontal.
      onContentSizeChange={(_w, ch) => {
        if (ch > 0 && ch > (h ?? 0)) {
          setH(ch);
        }
      }}>
      <View style={styles.table}>
        <View style={rowStyle}>
          {pad(header).map((c, ci) => (
            <Text
              key={ci}
              selectable={selectable}
              style={[styles.tableCell, cell, {fontWeight: '700'}]}>
              {c}
            </Text>
          ))}
        </View>
        {rows.map((row, ri) => (
          <View key={ri} style={rowStyle}>
            {pad(row).map((c, ci) => (
              <Text
                key={ci}
                selectable={selectable}
                style={[styles.tableCell, cell]}>
                {c}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

type Props = {
  text: string;
  scale?: number;
  baseStyle?: object;
  selectable?: boolean;
  // v0.38.1: low-confidence words the OCR was unsure about. When present,
  // matching words inside the rendered Markdown are shown bold + underlined
  // and, if onWordPress is given, are tappable (Library page view: tap to
  // correct one word).
  lowWords?: string[];
  // The ordinal tells the caller WHICH occurrence was tapped (0-based,
  // document order). Without it a page carrying the same unsure word twice
  // corrected the wrong one — the fix replaced the first match whichever
  // one you touched (device report 2026-08-12).
  onWordPress?: (w: string, nth: number) => void;
};

const BLACK = '#000000';
const CODE_BG = '#e8e8e8';
const LOW_STYLE: TextStyle = {fontWeight: '700', textDecorationLine: 'underline'};
// WORD_SPLIT is imported from core/text/lowMatch and SHARED with
// matchedLowWords, so the "N unsure" label always counts exactly what
// gets underlined here.

function inlineStyle(t: InlineSpan['t']): TextStyle | null {
  switch (t) {
    case 'bold':
      return {fontWeight: '700'};
    case 'italic':
      return {fontStyle: 'italic'};
    case 'code':
      return {fontFamily: 'monospace', backgroundColor: CODE_BG};
    default:
      return null;
  }
}

function MarkdownView(props: Props): React.JSX.Element {
  const {text, scale = 1, baseStyle, selectable = true, onWordPress} = props;
  const blocks = React.useMemo(() => parseMarkdown(text ?? ''), [text]);
  const lowSet = React.useMemo(
    () => new Set((props.lowWords ?? []).map(w => w.toLowerCase())),
    [props.lowWords],
  );

  // Render inline spans as nested <Text>; children inherit the parent's
  // fontSize / lineHeight / color, so we only set the per-span accents.
  // When a low-word set is active, each span's text is split so matching
  // words get the underline/bold + tap treatment.
  // Counts occurrences PER WORD in document order across the whole render,
  // so each tappable occurrence knows which one it is. Reset per render
  // pass: the tree below is built synchronously, in order.
  const lowSeen = new Map<string, number>();
  const renderSpans = (spans: InlineSpan[]): React.ReactNode =>
    spans.map((sp, idx) => {
      const accent = inlineStyle(sp.t) ?? undefined;
      if (lowSet.size === 0 || sp.t === 'code') {
        return (
          <Text key={idx} selectable={selectable} style={accent}>
            {sp.s}
          </Text>
        );
      }
      const parts = sp.s.split(WORD_SPLIT);
      return (
        <Text key={idx} selectable={selectable} style={accent}>
          {parts.map((part, pi) => {
            if (!lowSet.has(part.toLowerCase())) {
              return part;
            }
            const key = part.toLowerCase();
            const nth = lowSeen.get(key) ?? 0;
            lowSeen.set(key, nth + 1);
            return (
              <Text
                key={pi}
                selectable={selectable}
                style={LOW_STYLE}
                onPress={onWordPress ? () => onWordPress(part, nth) : undefined}>
                {part}
              </Text>
            );
          })}
        </Text>
      );
    });

  const fs = 14 * scale;
  const base: TextStyle = {
    fontSize: fs,
    lineHeight: fs * 1.5,
    color: BLACK,
  };

  // Robust fallback: nothing parsed → show the raw text plainly.
  if (blocks.length === 0) {
    return (
      <Text selectable={selectable} style={[baseStyle, base]}>
        {text}
      </Text>
    );
  }

  const gap = fs * 0.4;

  const renderBlock = (b: MdBlock, key: number): React.JSX.Element => {
    switch (b.k) {
      case 'h': {
        const mult = b.level === 1 ? 1.35 : b.level === 2 ? 1.2 : 1.08;
        const hs: TextStyle = {
          fontSize: fs * mult,
          lineHeight: fs * mult * 1.4,
          fontWeight: '700',
          color: BLACK,
          marginTop: gap * 2,
          marginBottom: gap,
        };
        return (
          <Text key={key} selectable={selectable} style={[baseStyle, hs]}>
            {renderSpans(b.spans)}
          </Text>
        );
      }
      case 'p':
        return (
          <Text
            key={key}
            selectable={selectable}
            style={[baseStyle, base, {marginBottom: gap}]}>
            {renderSpans(b.spans)}
          </Text>
        );
      case 'ul':
        return (
          <View key={key} style={{paddingLeft: fs, marginBottom: gap}}>
            {b.items.map((item, ii) => (
              <Text
                key={ii}
                selectable={selectable}
                style={[baseStyle, base]}>
                {'•  '}
                {renderSpans(item)}
              </Text>
            ))}
          </View>
        );
      case 'ol':
        return (
          <View key={key} style={{paddingLeft: fs, marginBottom: gap}}>
            {b.items.map((item, ii) => (
              <Text
                key={ii}
                selectable={selectable}
                style={[baseStyle, base]}>
                {`${b.start + ii}. `}
                {renderSpans(item)}
              </Text>
            ))}
          </View>
        );
      case 'hr':
        return (
          <View
            key={key}
            style={{
              height: 1,
              backgroundColor: BLACK,
              opacity: 0.5,
              marginVertical: gap,
            }}
          />
        );
      case 'quote':
        return (
          <View
            key={key}
            style={{
              borderLeftWidth: 2,
              borderLeftColor: BLACK,
              paddingLeft: fs * 0.6,
              marginBottom: gap,
            }}>
            <Text
              selectable={selectable}
              style={[baseStyle, base, {fontStyle: 'italic'}]}>
              {renderSpans(b.spans)}
            </Text>
          </View>
        );
      case 'code':
        return (
          <View key={key} style={[styles.codeBox, {marginBottom: gap}]}>
            <Text
              selectable={selectable}
              style={{
                fontFamily: 'monospace',
                fontSize: fs * 0.92,
                lineHeight: fs * 1.4,
                color: BLACK,
              }}>
              {b.text}
            </Text>
          </View>
        );
      case 'table':
        return (
          <MdTable
            key={key}
            header={b.header}
            rows={b.rows}
            fs={fs}
            gap={gap}
            selectable={selectable}
          />
        );
      default:
        return <View key={key} />;
    }
  };

  return <View>{blocks.map(renderBlock)}</View>;
}

const styles = StyleSheet.create({
  codeBox: {
    backgroundColor: CODE_BG,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  table: {
    borderWidth: 1,
    borderColor: BLACK,
    // v0.78.4: do NOT let the horizontal ScrollView's row contentContainer
    // stretch this View to the (ballooned) full parent height. Without this,
    // onLayout below measures the stretched height and pins a giant empty
    // frame under a 3-row table. flex-start = wrap the real content height.
    alignSelf: 'flex-start',
  },
  tableCell: {
    borderWidth: 0.5,
    borderColor: BLACK,
  },
});

// Memoized (perf audit 2026-07-20): every store notification re-renders
// the whole ChatPanel; without memo every chat turn re-built its full
// span tree each time a background job stored a page. Call sites pass
// stable props (string text, StyleSheet refs), so shallow compare holds.
export default React.memo(MarkdownView);
