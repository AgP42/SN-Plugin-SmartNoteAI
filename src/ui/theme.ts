// Shared UI styles (phase 4, spec §2.2): the parts of App.tsx's old
// StyleSheet used by TWO OR MORE screens, extracted VERBATIM. Each screen
// keeps a local StyleSheet for its own styles and merges:
//   const styles = {...theme, ...local};
// so the moved JSX kept its original `styles.x` references untouched.

import {StyleSheet} from 'react-native';

// Not a style, but shared by HomeScreen and KeyAppScreen (moved here with
// the split — App can no longer export it without an import cycle).
export const maskKey = (k: string): string =>
  k.length <= 8 ? '••••' : `${k.slice(0, 4)}••••${k.slice(-2)}`;

// Shared styles as a FUNCTION of the user's text/button scale (Appearance):
// every fontSize follows `scale`, every button/chip padding follows
// `btnScale`. Screens call `useMemo(() => makeTheme(scale, btnScale), […])`.
// `theme` below is the unscaled default (scale=1) for any direct importer.
export const makeTheme = (scale: number, btnScale: number) =>
  StyleSheet.create({
  root: {flex: 1, backgroundColor: '#ffffff'},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
  },
  title: {flexShrink: 1, minWidth: 0, fontSize: 20 * scale, fontWeight: '700', color: '#000000', marginHorizontal: 8},
  body: {padding: 20},
  msg: {fontSize: 12 * scale, color: '#555555', marginTop: 8},
  modelNote: {fontSize: 12 * scale, color: '#555555', marginTop: 6, fontStyle: 'italic'},
  smallBtn: {alignSelf: 'flex-start', marginTop: 8, borderWidth: 1, borderColor: '#000000', borderRadius: 8, paddingHorizontal: 12 * btnScale, paddingVertical: 7 * btnScale},
  smallBtnOff: {borderColor: '#999999'},
  smallBtnText: {fontSize: 13 * scale, color: '#000000'},
  section: {fontSize: 16 * scale, fontWeight: '700', color: '#000000', marginTop: 26, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: '#000000', paddingBottom: 4},
  label: {fontSize: 13 * scale, color: '#333333', marginTop: 14, marginBottom: 2, fontWeight: '600'},
  input: {borderWidth: 1, borderColor: '#000000', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 * scale, color: '#000000', marginTop: 6},
  persona: {minHeight: 70, maxHeight: 160, textAlignVertical: 'top'},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8},
  chip: {borderWidth: 1, borderColor: '#000000', borderRadius: 8, paddingHorizontal: 12 * btnScale, paddingVertical: 7 * btnScale},
  chipOn: {backgroundColor: '#000000'},
  chipText: {fontSize: 13 * scale, color: '#000000'},
  chipTextOn: {color: '#ffffff'},
  manual: {fontSize: 13 * scale, color: '#000000', lineHeight: 20 * scale, marginTop: 6},
  b: {fontWeight: '700'},
  qaCard: {borderWidth: 1, borderColor: '#000000', borderRadius: 8, padding: 8, marginTop: 8},
  gapTop: {marginTop: 8},
  bottomPad: {height: 40},
  libSectionRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14},
  flex1: {flex: 1},
  clearMini: {
    borderWidth: 1.5,
    borderColor: '#000000',
    borderRadius: 7,
    paddingHorizontal: 9 * btnScale,
    paddingVertical: 4 * btnScale,
    // #8 (user 2026-07-25): a shared floor so row-end buttons (Sync chip,
    // agent badges, + Add, Export) all line up at the same height.
    minHeight: 30 * btnScale,
    justifyContent: 'center',
  },
  // v0.80.0 (audit L2): black, not grey — these are the Library's most-used
  // action buttons and #555 on white reads faint on e-ink.
  clearMiniText: {fontSize: 11 * scale, fontWeight: '700', color: '#000000'},
  pageTileText: {fontSize: 10 * scale, lineHeight: 14 * scale, color: '#000000'},
});

// Unscaled default for any importer that doesn't pass a scale yet.
export const theme = makeTheme(1, 1);
