/**
 * Home (hub) — user guide, module map, config doors, Ko-fi footer.
 * Extracted VERBATIM from App.tsx (phase 4, spec §2.2).
 */
import React, {useMemo} from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {maskKey, makeTheme} from '../src/ui/theme';
import type {KeyState, Screen} from '../App';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const APP_ICON = require('../assets/icon.png');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const KOFI_QR = require('../assets/kofi-qr.png');

export interface HomeScreenProps {
  keyState: KeyState;
  msg: string;
  scale: number;
  btnScale: number;
  setScreen: (s: Screen) => void;
  // v0.60: open (re-installing if needed) the embedded User Guide PDF.
  openGuide: () => void;
  // Rendered by App (it owns the assistant + close-plugin actions).
  headerRight: () => React.JSX.Element;
}

function HomeScreen({
  keyState,
  msg,
  scale,
  btnScale,
  setScreen,
  openGuide,
  headerRight,
}: HomeScreenProps): React.JSX.Element {
  // v0.80.0 (audit): the text/button-size settings finally apply here —
  // build the shared theme at the chosen scale (KeyAppScreen pattern).
  const styles = useMemo(
    () => ({...makeTheme(scale, btnScale), ...local}),
    [scale, btnScale],
  );

  // K13 (device feedback): the chosen text size applies to the config
  // pages themselves, not just the panel.
  const mf = {fontSize: 13 * scale, lineHeight: 20 * scale};
  const nf = {fontSize: 12 * scale, lineHeight: 17 * scale};
  const sf = {fontSize: 16 * scale};

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Image source={APP_ICON} style={styles.titleIcon} resizeMode="contain" />
          <Text style={styles.title}>SmartNote AI</Text>
        </View>
        {headerRight()}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.section, sf]}>User Guide</Text>
        <Text style={[styles.manual, mf]}>
          Your Supernote in the age of AI — privacy first!{'\n'}
          Two ways to use it:{'\n'}
          <Text style={styles.b}>① Just ask.</Text> Open the floating
          assistant on any note and ask the AI about the page, a range of
          pages or the full note; or lasso a part of it for a quick question.
          The transcription will be generated live.{'\n'}
          <Text style={styles.b}>② Build a library (READ).</Text>{' '}
          You can also transcribe a selection of your notes and PDFs into a
          local library, this will open up more features: powerful SEARCH, AI
          AGENTS that know your documents, and EXPORT.
        </Text>
        <View style={styles.treeWrap}>
          <View style={[styles.treeBox, styles.treeBoxOn]}>
            <Text style={styles.treeTextOn}>READ</Text>
          </View>
          <Text style={styles.treeLink}>│</Text>
          <View style={styles.treeRow}>
            <View style={[styles.treeBox, styles.treeBoxOn]}>
              <Text style={styles.treeTextOn}>CHAT</Text>
            </View>
            <View style={[styles.treeBox, styles.treeBoxOn]}>
              <Text style={styles.treeTextOn}>AI AGENTS</Text>
            </View>
            <View style={[styles.treeBox, styles.treeBoxOn]}>
              <Text style={styles.treeTextOn}>SEARCH</Text>
            </View>
            <View style={[styles.treeBox, styles.treeBoxOn]}>
              <Text style={styles.treeTextOn}>EXPORT</Text>
            </View>
          </View>
        </View>
        <Text style={[styles.manual, mf]}>
          <Text style={styles.b}>READ</Text>: transcribe notes and PDFs with
          Mistral OCR 4 + Ministral 14B Vision; correct anything by hand.
          Three modes per folder or note/PDF: Auto, Manual, Off.{'\n'}
          <Text style={styles.b}>CHAT</Text>: ask any Mistral model about a
          page, a range or the whole note; add any extra context, or lasso a
          zone for a quick question.{'\n'}
          <Text style={styles.b}>AI AGENTS</Text>: custom chats with
          their own persona, model and library documents.{'\n'}
          <Text style={styles.b}>SEARCH</Text>: powerful search into your
          local transcripts.{'\n'}
          <Text style={styles.b}>EXPORT</Text>: export your local transcripts
          in .md or .txt.{'\n\n'}
          <Text style={styles.b}>Privacy first</Text>: open source plugin,
          AI from Mistral AI only (EU/GDPR, a paid plan never trains on your
          data, nothing stored on their servers), your own key kept in the
          plugin's private storage, transcripts local-only. Anyhow, do not
          share confidential
          information.{'\n\n'}
          Guide and sources: github.com/AgP42/SN-Plugin-SmartNoteAI
        </Text>

        {/* v0.60: the guide ships INSIDE the plugin — a PDF in
            Document/SmartNote AI/, transcript pre-seeded in the library
            (browse/search/export it without an API key; chat with it
            once the key is set). The button re-installs it if deleted. */}
        <TouchableOpacity
          onPress={openGuide}
          style={[styles.navBtn, {paddingVertical: 12 * btnScale}]}>
          <Text style={[styles.navBtnText, {fontSize: 14 * btnScale}]}>
            Open the User Guide (PDF) →
          </Text>
        </TouchableOpacity>

        <Text style={[styles.status, mf]}>
          {keyState.kind === 'ok'
            ? `✓ key loaded (${maskKey(keyState.config.apiKey)})`
            : keyState.kind === 'missing'
            ? '⚠ No API key yet: set it in "1 · API key, privacy, backup & appearance"'
            : 'Loading…'}
        </Text>
        {msg.length > 0 ? <Text style={styles.msg}>{msg}</Text> : null}

        <Text style={[styles.section, sf, styles.gapTop]}>Configuration</Text>
        {(
          [
            ['keyapp', '1 · API key, privacy, backup & appearance'],
            ['read', '2 · READ: AI transcript params'],
            ['analyse', '3 · CHAT & AGENTS: your assistants'],
          ] as [Screen, string][]
        ).map(([s, label]) => (
          <TouchableOpacity
            key={s}
            onPress={() => setScreen(s)}
            style={[styles.navBtn, {paddingVertical: 12 * btnScale}]}>
            <Text style={[styles.navBtnText, {fontSize: 14 * btnScale}]}>
              {label} →
            </Text>
          </TouchableOpacity>
        ))}

        {/* v0.88.2 (user, nav rework): the "Plugin modules" section is gone —
            Library and Chat are reached from the MENU (and the Assistant
            button stays in the top bar). This page is configuration only. */}
        <View style={styles.bottomPad} />
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.kofiRow}>
          <View style={styles.kofiTextWrap}>
            <Text style={[styles.kofiText, nf]}>
              SmartNote AI is a personal project built by a Supernote user,
              for Supernote users. It is not an official product of
              Supernote or Mistral AI, just a plugin that loves them both.
              I built it with love, time, skills and expensive tokens ;-)
              If you like it, please consider a small contribution:
            </Text>
            <Text selectable style={[styles.kofiLink, nf]}>
              https://ko-fi.com/agp42
            </Text>
          </View>
          <Image source={KOFI_QR} style={styles.kofiQr} resizeMode="contain" />
        </View>
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  titleRow: {flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, marginRight: 8},
  titleIcon: {width: 30, height: 30},
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#000000',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: '#ffffff',
  },
  status: {fontSize: 13, color: '#000000', lineHeight: 19, marginTop: 14, marginBottom: 6},
  navBtn: {marginTop: 12, borderWidth: 2, borderColor: '#000000', borderRadius: 10, backgroundColor: '#ffffff', paddingHorizontal: 14},
  navBtnText: {color: '#000000', fontWeight: '700'},
  kofiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  kofiTextWrap: {flex: 1},
  kofiText: {fontSize: 12, color: '#000000', lineHeight: 17},
  kofiLink: {fontSize: 12, color: '#000000', fontWeight: '700', marginTop: 2},
  kofiQr: {width: 74, height: 74, borderWidth: 1, borderColor: '#000000'},
  treeWrap: {alignItems: 'center', marginTop: 10, marginBottom: 4},
  treeRow: {flexDirection: 'row', gap: 8, marginTop: 6},
  treeBox: {
    borderWidth: 1.5,
    borderColor: '#aaaaaa',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  treeBoxOn: {borderColor: '#000000'},
  treeTextOn: {fontSize: 12, fontWeight: '700', color: '#000000'},
  treeLink: {fontSize: 10, color: '#000000', marginTop: 2},
});
export default HomeScreen;
