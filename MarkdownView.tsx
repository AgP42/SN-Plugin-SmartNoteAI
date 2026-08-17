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
      showsHorizontalScrollIndicator>
      {/* v1.0.38 (device repro 2026-08-17, "giant void under a .md
          table"): the pin follows the TABLE's own onLayout, no longer the
          scroll view's contentSize. On the add-a-turn re-measure pass the
          nested horizontal ScrollView can be given the OUTER chat's whole
          content height (the v0.78.3 ballooning), and contentSize then
          REPORTS that stretched height — one such reading poisoned the
          v0.81 grow-only pin forever: a huge blank box under the table,
          the bubble border showing as a stray full-height line, and the
          end-anchored auto-scroll landing in the void ("all white"). The
          inner View is alignSelf:'flex-start', so its layout height IS
          the real table height whatever the container got stretched to —
          and following it both ways (grow AND shrink) lets a poisoned
          frame heal instead of ratcheting. Setting the scroll view's
          height does not change the flex-start child's height, so this
          cannot feedback-loop. */}
      <View
        style={styles.table}
        onLayout={e => {
          const lh = e.nativeEvent.layout.height;
          if (lh > 0) {
            setH(prev => {
              if (prev === lh) {
                return prev;
              }
              // Diagnostic (v1.0.39, giant-void hunt): every pin move,
              // with the table's shape — structure only, never content.
              console.log(
                '[SmartNoteAI.md]',
                `table pin ${prev ?? '∅'} → ${Math.round(lh)} ` +
                  `(${rows.length + 1}x${cols})`,
              );
              return lh;
            });
          }
        }}>
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
const LOW_STYLE: TextStyle = {
  fontWeight: '700',
  textDecorationLine: 'underline',
};
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
  // Diagnostic (v1.0.39, giant-void hunt): when a text carries a table,
  // log the whole BLOCK STRUCTURE once — kinds and sizes only (a table's
  // rows×cols, a code block's line count), never any content. This is
  // what tells us WHICH block owns a blank frame on a device report.
  React.useEffect(() => {
    if (!blocks.some(b => b.k === 'table')) {
      return;
    }
    const chars = (spans: InlineSpan[]): number =>
      spans.reduce((n, sp) => n + sp.s.length, 0);
    const shape = blocks
      .map(b => {
        switch (b.k) {
          case 'table':
            return `table(${b.rows.length + 1}x${Math.max(
              b.header.length,
              ...b.rows.map(r => r.length),
              1,
            )})`;
          case 'code':
            return `code(${b.text.split('\n').length}l)`;
          case 'p':
          case 'quote':
            return `${b.k}(${chars(b.spans)}c)`;
          case 'h':
            return `h${b.level}(${chars(b.spans)}c)`;
          case 'ul':
          case 'ol':
            return `${b.k}(${b.items.length}i,${b.items.reduce(
              (n, it) => n + chars(it),
              0,
            )}c)`;
          default:
            return b.k;
        }
      })
      .join(' ');
    console.log('[SmartNoteAI.md]', `blocks: ${shape}`);
  }, [blocks]);
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
                onPress={
                  onWordPress ? () => onWordPress(part, nth) : undefined
                }>
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

  // Diagnostic (v1.0.40, giant-void hunt round 2): any single block
  // taller than 800dp names itself — the turn-level log said WHICH turn
  // balloons (6218dp) while every block reads as fixed-style Text/View;
  // this says WHICH block carries the invisible height.
  const diagLayout =
    (key: number, kind: string) =>
    (e: {nativeEvent: {layout: {height: number}}}): void => {
      const bh = e.nativeEvent.layout.height;
      if (bh > 800) {
        console.log(
          '[SmartNoteAI.md]',
          `block[${key}] ${kind} height ${Math.round(bh)}dp`,
        );
      }
    };

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
          <Text
            key={key}
            onLayout={diagLayout(key, 'h')}
            selectable={selectable}
            style={[baseStyle, hs]}>
            {renderSpans(b.spans)}
          </Text>
        );
      }
      case 'p':
        return (
          <Text
            key={key}
            onLayout={diagLayout(key, 'p')}
            selectable={selectable}
            style={[baseStyle, base, {marginBottom: gap}]}>
            {renderSpans(b.spans)}
          </Text>
        );
      case 'ul':
        return (
          <View
            key={key}
            onLayout={diagLayout(key, 'ul')}
            style={{paddingLeft: fs, marginBottom: gap}}>
            {b.items.map((item, ii) => (
              <Text key={ii} selectable={selectable} style={[baseStyle, base]}>
                {'•  '}
                {renderSpans(item)}
              </Text>
            ))}
          </View>
        );
      case 'ol':
        return (
          <View
            key={key}
            onLayout={diagLayout(key, 'ol')}
            style={{paddingLeft: fs, marginBottom: gap}}>
            {b.items.map((item, ii) => (
              <Text key={ii} selectable={selectable} style={[baseStyle, base]}>
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
            onLayout={diagLayout(key, 'quote')}
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
          <View
            key={key}
            onLayout={diagLayout(key, 'code')}
            style={[styles.codeBox, {marginBottom: gap}]}>
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
