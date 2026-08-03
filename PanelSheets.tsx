// The floating panel's BROWSE sheets (context, lasso, added pages),
// extracted from ChatPanel in Lot 2 (structure split). Pure render: every
// state, store access and decision stays in the panel — these components
// receive values and callbacks, nothing else.
import React from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type {PanelStyles} from './panelStyles';
import type {ContextMode} from './src/core/convo/composeContext';
import MarkdownView from './MarkdownView';

// ---- Context sheet (v0.54: tap on the 📄 line) --------------------------
export function ContextSheet(props: {
  styles: PanelStyles;
  btnScale: number;
  open: boolean;
  noteName: string | null; // null = no capture
  ctxMode: ContextMode;
  setCtxMode: (m: ContextMode) => void;
  rangeStart: string;
  setRangeStart: (v: string) => void;
  rangeEnd: string;
  setRangeEnd: (v: string) => void;
  setPanelFocusable: (on: boolean) => void;
  bornOn: string;
  ctxPageOff: boolean;
  contextSent: boolean;
  onClose: () => void;
  onSeeTranscript: () => void;
  onTogglePageOff: () => void;
}): React.JSX.Element | null {
  const {styles, btnScale} = props;
  if (!props.open) {
    return null;
  }
  return (
    <View style={styles.sheetWrap}>
      {/* v0.80.0 (audit L6): tap outside a BROWSE sheet closes it (the
          decision dialogs keep requiring an explicit choice). */}
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={props.onClose}
      />
      <View style={styles.dialog}>
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle} numberOfLines={1}>
            ⌾ Current note
            {props.noteName !== null ? ` · ${props.noteName}` : ''}
          </Text>
          <TouchableOpacity onPress={props.onClose} style={styles.sheetClose}>
            <Text style={styles.sheetCloseText}>✕</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.ctxSheetRow}>
          <Text style={styles.dim}>Send:</Text>
          {(
            [
              ['page', 'This page'],
              ['range', 'Range'],
              ['note', 'Whole note'],
            ] as [ContextMode, string][]
          ).map(([m, label]) => {
            const on = props.ctxMode === m;
            return (
              <TouchableOpacity
                key={m}
                onPress={() => props.setCtxMode(m)}
                style={[
                  styles.ctxChip,
                  {
                    paddingHorizontal: 9 * btnScale,
                    paddingVertical: 5 * btnScale,
                  },
                  on && styles.ctxChipOn,
                ]}>
                <Text
                  style={[
                    styles.ctxChipText,
                    {fontSize: 12 * btnScale},
                    on && styles.ctxChipTextOn,
                  ]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
          {props.ctxMode === 'range' ? (
            <View style={styles.rangeInputs}>
              <TextInput
                style={styles.rangeInput}
                value={props.rangeStart}
                onChangeText={props.setRangeStart}
                keyboardType="number-pad"
                onTouchStart={() => props.setPanelFocusable(true)}
                onFocus={() => props.setPanelFocusable(true)}
                onBlur={() => props.setPanelFocusable(false)}
              />
              <Text style={styles.dim}>–</Text>
              <TextInput
                style={styles.rangeInput}
                value={props.rangeEnd}
                onChangeText={props.setRangeEnd}
                keyboardType="number-pad"
                onTouchStart={() => props.setPanelFocusable(true)}
                onFocus={() => props.setPanelFocusable(true)}
                onBlur={() => props.setPanelFocusable(false)}
              />
            </View>
          ) : null}
        </View>
        <View style={styles.provRow}>
          <TouchableOpacity
            onPress={props.onSeeTranscript}
            disabled={props.noteName === null}
            style={styles.provChip}>
            <Text style={styles.provChipText} numberOfLines={1}>
              📄 See transcript
            </Text>
          </TouchableOpacity>
          <Text style={styles.ctxState} numberOfLines={1}>
            {props.bornOn.length > 0 ? `↩ born on ${props.bornOn} · ` : ''}
            {props.noteName === null
              ? ''
              : props.ctxPageOff
              ? 'this page removed'
              : props.contextSent
              ? 'in context'
              : '• sent with next message'}
          </Text>
        </View>
        {props.noteName !== null ? (
          <TouchableOpacity
            onPress={props.onTogglePageOff}
            style={styles.ctxDropBtn}
            hitSlop={{top: 6, bottom: 6}}>
            <Text style={styles.ctxDropBtnText}>
              {props.ctxPageOff
                ? '＋ Put the current page back in context'
                : '✕ Remove the current page from context'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

// ---- Lasso popup (v0.88.4): the image + Remove, nothing else ------------
export function LassoPopup(props: {
  styles: PanelStyles;
  open: boolean;
  imageB64: string | null; // resolved by the panel
  onClose: () => void;
  onRemove: () => void;
}): React.JSX.Element | null {
  const {styles} = props;
  if (!props.open) {
    return null;
  }
  return (
    <View style={styles.sheetWrap}>
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={props.onClose}
      />
      <View style={styles.dialog}>
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle} numberOfLines={1}>
            🖼 Lasso selection
          </Text>
          <TouchableOpacity onPress={props.onClose} style={styles.sheetClose}>
            <Text style={styles.sheetCloseText}>✕</Text>
          </TouchableOpacity>
        </View>
        {props.imageB64 !== null ? (
          <Image
            source={{uri: `data:image/png;base64,${props.imageB64}`}}
            style={styles.lassoPreview}
            resizeMode="contain"
          />
        ) : null}
        <View style={styles.sheetBtns}>
          <TouchableOpacity onPress={props.onRemove} style={styles.actBtn2}>
            <Text style={styles.actBtn2Text}>🗑 Remove from context</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ---- Added-pages popup (v0.88.4) ----------------------------------------
export type AddedRef = {path: string; page: number; sent?: boolean};

export function AddedPagesPopup(props: {
  styles: PanelStyles;
  open: boolean;
  refs: AddedRef[];
  keyOf: (path: string, page: number) => string;
  nameOf: (path: string) => string;
  onClose: () => void;
  onRemove: (ref: AddedRef) => void;
  onSeeTranscript: () => void; // the panel loads the store and opens the sheet
}): React.JSX.Element | null {
  const {styles} = props;
  if (!props.open) {
    return null;
  }
  return (
    <View style={styles.sheetWrap}>
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={props.onClose}
      />
      <View style={styles.dialog}>
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle} numberOfLines={1}>
            📄 Added pages ({props.refs.length})
          </Text>
          <TouchableOpacity onPress={props.onClose} style={styles.sheetClose}>
            <Text style={styles.sheetCloseText}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.ctxAddedScroll} nestedScrollEnabled={true}>
          {props.refs.map(ref => (
            <View key={props.keyOf(ref.path, ref.page)} style={styles.ctxAddedRow}>
              <Text style={styles.dim} numberOfLines={1}>
                {props.nameOf(ref.path)} · p.{ref.page + 1}
              </Text>
              {ref.sent === true ? (
                <Text style={styles.dim}>in CHAT</Text>
              ) : (
                <TouchableOpacity
                  onPress={() => props.onRemove(ref)}
                  hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}>
                  <Text style={styles.ctxAddedDel}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </ScrollView>
        <View style={styles.sheetBtns}>
          <TouchableOpacity
            onPress={props.onSeeTranscript}
            style={styles.actBtn2}>
            <Text style={styles.actBtn2Text}>📄 See transcript</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ---- Added-pages transcript sheet (these pages ONLY) ---------------------
export function AddedTranscriptSheet(props: {
  styles: PanelStyles;
  volet: {title: string; text: string} | null;
  scale: number;
  onClose: () => void;
}): React.JSX.Element | null {
  const {styles, volet} = props;
  if (volet === null) {
    return null;
  }
  return (
    <View style={styles.sheetWrap}>
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={props.onClose}
      />
      <View style={styles.dialog}>
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle} numberOfLines={1}>
            📄 {volet.title}
          </Text>
          <TouchableOpacity onPress={props.onClose} style={styles.sheetClose}>
            <Text style={styles.sheetCloseText}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.ctxAddedScroll} nestedScrollEnabled={true}>
          <MarkdownView text={volet.text} scale={props.scale} />
        </ScrollView>
      </View>
    </View>
  );
}
