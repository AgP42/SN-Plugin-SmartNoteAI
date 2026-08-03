/**
 * 1 · API key, privacy, backup & appearance — key storage (encrypted), privacy
 * reset, transcript wipe, text/button sizes, toolbar side.
 * Extracted VERBATIM from App.tsx (phase 4, spec §2.2).
 */
import React, {useCallback, useMemo, useState} from 'react';
import {
  NativeModules,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import type {ModelConfig} from '../src/core/model/types';
import {
  exportSettings,
  importSettings,
  restoreDefaultAgents,
  EXPORT_SETTINGS_PATH,
} from '../src/native/settings';
import {setApiKey, deleteLegacyKeyFile} from '../src/native/secureKey';
import {maskKey, makeTheme} from '../src/ui/theme';
import {useArmedConfirm} from '../src/ui/useArmedConfirm';
import type {ChipRowFn, KeyState, SubHeaderFn} from '../App';

const TEXT_SIZES: {label: string; scale: number}[] = [
  {label: 'S', scale: 1},
  {label: 'M', scale: 1.15},
  {label: 'L', scale: 1.3},
  {label: 'XL', scale: 1.5},
];
export const DEFAULT_SCALE = 1.15;

const BUTTON_SIZES: {label: string; scale: number}[] = [
  {label: 'S', scale: 1},
  {label: 'M', scale: 1.25},
  {label: 'L', scale: 1.5},
  {label: 'XL', scale: 1.8},
];
export const DEFAULT_BTN_SCALE = 1.25;

export type ToolbarSide = 'none' | 'left' | 'right' | 'top' | 'bottom';
const TOOLBAR_SIDES: [ToolbarSide, string][] = [
  ['none', 'None'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['top', 'Top'],
  ['bottom', 'Bottom'],
];

export interface KeyAppScreenProps {
  keyState: KeyState;
  legacyPresent: boolean;
  setLegacyPresent: (v: boolean) => void;
  msg: string;
  setMsg: (m: string) => void;
  // Reload key + settings after a key save (owned by App).
  load: () => Promise<void>;
  // v0.88 (audit): flush App's debounced save before Save key / Import —
  // load() then repaints from disk without discarding a pending edit, and
  // a pending pre-import timer can no longer overwrite the imported state.
  flushSettings?: () => Promise<unknown>;
  // Armed-confirm actions stay in App (single shared instance, spec §2.1).
  onDeleteKey: () => Promise<void>;
  confirmDelKey: boolean;
  clearAll: () => void;
  confirmClear: string | null;
  scale: number;
  setScale: (v: number) => void;
  btnScale: number;
  setBtnScale: (v: number) => void;
  toolbarSide: ToolbarSide;
  setToolbarSide: (v: ToolbarSide) => void;
  chipRow: ChipRowFn;
  subHeader: SubHeaderFn;
}

function KeyAppScreen({
  keyState,
  legacyPresent,
  setLegacyPresent,
  msg,
  setMsg,
  load,
  flushSettings,
  onDeleteKey,
  confirmDelKey,
  clearAll,
  confirmClear,
  scale,
  setScale,
  btnScale,
  setBtnScale,
  toolbarSide,
  setToolbarSide,
  chipRow,
  subHeader,
}: KeyAppScreenProps): React.JSX.Element {

  const [keyInput, setKeyInput] = useState<string>('');

  /* ---------- key ---------- */

  // v0.76.1 (user): the Supernote keyboard has no Paste, and typing a long
  // key by hand is error-prone — so a Paste button pulls it from the system
  // clipboard (native), same as the chat input.
  const onPasteKey = useCallback(async () => {
    try {
      const r = await (
        (NativeModules as {SmartNoteAiOverlay?: unknown}).SmartNoteAiOverlay as {
          getClipboardText?: () => Promise<{success?: boolean; text?: string}>;
        }
      )?.getClipboardText?.();
      if (r?.success === true && (r.text ?? '').trim().length > 0) {
        setKeyInput((r.text as string).trim());
      }
    } catch {
      // old binary / empty clipboard — the field stays editable
    }
  }, []);

  const onSaveKey = useCallback(async () => {
    await flushSettings?.().catch(() => {});
    const ok = await setApiKey(keyInput);
    if (!ok) {
      setMsg('Could not store the key.');
      return;
    }
    setKeyInput('');
    setMsg('Key saved (encrypted, device-local).');
    await load();
  }, [keyInput, load, setMsg, flushSettings]);

  const onDeleteLegacy = useCallback(async () => {
    const ok = await deleteLegacyKeyFile();
    setMsg(ok ? 'Old key file deleted.' : 'Could not delete the old key file.');
    if (ok) {
      setLegacyPresent(false);
    }
  }, [setLegacyPresent, setMsg]);

  /* ---------- settings backup (v0.58) ---------- */
  // Settings live in the plugin's PRIVATE storage (never cloud-synced —
  // the 2026-07-18 sync conflict is why). These two buttons are the ONLY
  // bridge to the visible MyStyle folder: an explicit export (backup /
  // hand-editing / device transfer) and an explicit, armed import.
  // v0.80.0 (audit M1): armed via the shared hook — the old bare useState
  // never auto-disarmed, so a stray tap HOURS later still replaced all
  // settings. Now it disarms after 4 s like every sibling confirm.
  const {armed: importArmed, confirm: importConfirm} = useArmedConfirm(4000);

  const onExportSettings = useCallback(async () => {
    const path = await exportSettings();
    setMsg(
      path !== null
        ? `Settings exported to ${path.replace('/storage/emulated/0/', '')}.`
        : 'Export failed: could not write the file.',
    );
  }, [setMsg]);

  const onImportSettings = useCallback(async () => {
    if (!importConfirm('import')) {
      return;
    }
    await flushSettings?.().catch(() => {});
    const r = await importSettings();
    if (r.ok) {
      setMsg(`Settings imported (${r.fields.join(', ')}).`);
      await load(); // reflect the new state everywhere
    } else {
      setMsg(`Import failed: ${r.error ?? 'unknown error'}.`);
    }
  }, [importConfirm, load, setMsg, flushSettings]);

  const onRestoreAgents = useCallback(async () => {
    const n = await restoreDefaultAgents();
    setMsg(
      n > 0
        ? `Added ${n} starter agent(s): open "3 · CHAT & AGENTS…" to try them.`
        : 'All starter agents are already in your config.',
    );
  }, [setMsg]);

  // K13 (device feedback): the chosen text size applies to the config
  // pages themselves, not just the panel. Shared styles now follow the
  // scale too (every button/label, not just the mf/nf/sf inline overrides).
  const styles = useMemo(() => makeTheme(scale, btnScale), [scale, btnScale]);
  const mf = {fontSize: 13 * scale, lineHeight: 20 * scale};
  const nf = {fontSize: 12 * scale, lineHeight: 17 * scale};
  const sf = {fontSize: 16 * scale};
  const lf = {fontSize: 13 * scale};
  const keyOk = keyState.kind === 'ok';

    return (
      <View style={styles.root}>
        {subHeader('1 · API key, privacy, backup & appearance')}
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={[styles.section, sf]}>Mistral API key</Text>
          <Text style={[styles.manual, mf]}>
            {keyOk
              ? `Current key: ${maskKey((keyState as {config: ModelConfig}).config.apiKey)}, stored encrypted in the plugin's private storage (never synced).`
              : 'No key stored yet. Paste your Mistral API key below.'}
          </Text>
          <Text style={[styles.modelNote, nf]}>
            Get one at https://console.mistral.ai/ → API Keys → Create (about
            3 clicks). The free tier allows using all features of this plugin,
            but only a paid plan guarantees Mistral never uses your data to
            train its models.
          </Text>
          <TextInput
            style={styles.input}
            value={keyInput}
            onChangeText={setKeyInput}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="paste a new Mistral API key…"
          />
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8}}>
            <TouchableOpacity onPress={onPasteKey} style={styles.smallBtn}>
              <Text style={styles.smallBtnText}>Paste from clipboard</Text>
            </TouchableOpacity>
            {keyInput.length > 0 ? (
              <TouchableOpacity
                onPress={() => setKeyInput('')}
                style={styles.smallBtn}>
                <Text style={styles.smallBtnText}>Clear</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <TouchableOpacity
            onPress={onSaveKey}
            disabled={keyInput.trim().length === 0}
            style={[styles.smallBtn, keyInput.trim().length === 0 && styles.smallBtnOff]}>
            <Text style={styles.smallBtnText}>Save key (encrypted)</Text>
          </TouchableOpacity>
          {keyOk ? (
            <TouchableOpacity
              onPress={onDeleteKey}
              style={[
                styles.smallBtn,
                confirmDelKey && {backgroundColor: '#000000'},
              ]}>
              <Text
                style={[
                  styles.smallBtnText,
                  confirmDelKey && {color: '#ffffff'},
                ]}>
                {confirmDelKey
                  ? 'Really delete the stored key?'
                  : 'Delete stored key'}
              </Text>
            </TouchableOpacity>
          ) : null}
          {legacyPresent ? (
            <>
              <Text style={[styles.modelNote, nf]}>
                The old key file (MyStyle/…/mistral-key.txt) still exists.
                MyStyle syncs to the Supernote cloud; once the key works
                here, delete it.
              </Text>
              <TouchableOpacity onPress={onDeleteLegacy} style={styles.smallBtn}>
                <Text style={styles.smallBtnText}>Delete old key file</Text>
              </TouchableOpacity>
            </>
          ) : null}

          <Text style={[styles.section, sf]}>Privacy</Text>
          <Text style={[styles.manual, mf]}>
            Using CHAT or a Sync sends your questions and the pages' content
            (text, and images when reading) to Mistral (EU) with your own
            key. Nothing is stored on their servers, and only a paid Mistral
            plan guarantees your data never trains their models. Files set
            to Off are never sent.
          </Text>
          <Text style={[styles.modelNote, nf]}>
            Transcripts stay on this device only. This wipes every one of
            them for good (same as the Library button).
          </Text>
          {/* v0.80.1 (user): armed = inverted video, everywhere. */}
          <TouchableOpacity
            onPress={clearAll}
            style={[
              styles.smallBtn,
              confirmClear === 'ALL' && {backgroundColor: '#000000'},
            ]}>
            <Text
              style={[
                styles.smallBtnText,
                confirmClear === 'ALL' && {color: '#ffffff'},
              ]}>
              {confirmClear === 'ALL'
                ? 'Really clear ALL transcripts?'
                : 'Clear ALL transcripts'}
            </Text>
          </TouchableOpacity>

          <Text style={[styles.section, sf]}>Settings backup</Text>
          <Text style={[styles.manual, mf]}>
            Settings are stored in the plugin's private storage (never
            cloud-synced). Export writes a readable copy to{' '}
            {EXPORT_SETTINGS_PATH.replace('/storage/emulated/0/', '')} —
            as a backup, to edit by hand, or to move to another device.
            Import replaces ALL settings with that file.
          </Text>
          <TouchableOpacity onPress={onExportSettings} style={styles.smallBtn}>
            <Text style={styles.smallBtnText}>Export settings</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onImportSettings}
            style={[
              styles.smallBtn,
              importArmed === 'import' && {backgroundColor: '#000000'},
            ]}>
            <Text
              style={[
                styles.smallBtnText,
                importArmed === 'import' && {color: '#ffffff'},
              ]}>
              {importArmed === 'import'
                ? 'Really replace ALL settings from the file?'
                : 'Import settings (replace all)'}
            </Text>
          </TouchableOpacity>
          {/* v0.80.0 (audit M8): renamed — a fresh install ships with no
              agents, so there is nothing to "restore"; this ADDS the
              starter presets (same as "+ Add preset" in door 3). */}
          <TouchableOpacity onPress={onRestoreAgents} style={styles.smallBtn}>
            <Text style={styles.smallBtnText}>Add starter agents</Text>
          </TouchableOpacity>

          {/* v0.79.12: the transcript-library backup moved to the LIBRARY
              page (its 'saved' feedback already lives there). */}

          <Text style={[styles.section, sf]}>Appearance</Text>
          <Text style={[styles.label, lf]}>Text size</Text>
          {chipRow(
            TEXT_SIZES.map(t => [t.scale, t.label] as [number, string]),
            scale,
            setScale,
          )}
          <Text style={[styles.label, lf]}>Button size</Text>
          {chipRow(
            BUTTON_SIZES.map(t => [t.scale, t.label] as [number, string]),
            btnScale,
            setBtnScale,
          )}
          <Text style={[styles.label, lf]}>Note toolbar side (snaps won't cover it)</Text>
          {chipRow(TOOLBAR_SIDES, toolbarSide, setToolbarSide)}
          {msg.length > 0 ? <Text style={styles.msg}>{msg}</Text> : null}
          <View style={styles.bottomPad} />
        </ScrollView>
      </View>
    );
}


export default KeyAppScreen;
