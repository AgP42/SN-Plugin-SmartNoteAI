// One conversation turn — user text (context blocks stripped, lasso
// marker) or assistant markdown with the Copy .md / .txt row. Extracted
// VERBATIM from ChatPanel's turn map (UI refactor Lot 3, 2026-08-03).
// Pure render: the scroll anchoring (onLayout y) stays with the parent.
import React from 'react';
import {Text, TouchableOpacity, View, type LayoutChangeEvent} from 'react-native';
import type {PanelStyles} from './panelStyles';
import type {ChatTurn} from './src/core/model/types';
import MarkdownView from './MarkdownView';
import {stripContextBlocks} from './src/core/convo/compose';
import {mdToPlain} from './src/core/text/markdown';

export function TurnBubble(props: {
  styles: PanelStyles;
  turn: ChatTurn;
  index: number;
  scale: number;
  msgText: {fontSize: number; lineHeight: number};
  copied: string | null;
  onCopy: (text: string, key: string) => void;
  onLayout: (e: LayoutChangeEvent) => void;
}): React.JSX.Element {
  const {styles, turn: t, index: i} = props;
  return (
    <View
      onLayout={props.onLayout}
      style={[
        styles.bubble,
        t.role === 'user' ? styles.bubbleUser : styles.bubbleAI,
      ]}>
      {t.role === 'user' ? (
        <Text selectable style={[styles.bubbleText, props.msgText]}>
          {/* v0.81: light marker that this turn carried lasso image(s). */}
          {t.hadImage === true ? '🖼 ' : ''}
          {stripContextBlocks(t.text)}
        </Text>
      ) : (
        <>
        {t.web === true ? (
          <Text style={styles.webBadge}>🌐 web</Text>
        ) : null}
        <MarkdownView
          text={t.text}
          scale={props.scale}
          baseStyle={styles.bubbleText}
          selectable
        />
        </>
      )}
      {t.role === 'assistant' ? (
        <View style={styles.copyRow}>
          <TouchableOpacity
            onPress={() => props.onCopy(t.text, `${i}:md`)}
            style={styles.copyBtn}>
            <Text style={styles.copyText}>
              {props.copied === `${i}:md` ? '✓' : 'Copy .md'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => props.onCopy(mdToPlain(t.text), `${i}:txt`)}
            style={styles.copyBtn}>
            <Text style={styles.copyText}>
              {props.copied === `${i}:txt` ? '✓' : 'Copy .txt'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}
