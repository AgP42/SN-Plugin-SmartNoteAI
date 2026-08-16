/**
 * SmartNote AI — config HUB. Home + three doors (screen state):
 *   1 · keyapp   — API key (encrypted), sizes, privacy
 *   2 · read     — how pages are transcribed: vision prompt blocks, test
 *   3 · analyse  — CHAT & AGENTS (unified v0.59): every assistant on one
 *                  page — the default CHAT (persona, model, answer style,
 *                  quick actions) + up to 4 agents in collapsible zones
 *   library      — browse / search / edit transcripts, per-folder
 *                  Off/Manual/Auto chips, Sync now (live OCR → Vision)
 *
 * Reading is lazy by design: asking about a page that is not in the
 * library yet reads and stores it automatically — nothing here is a
 * prerequisite, it is all tuning and housekeeping.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  AppState,
  NativeModules,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';

import {DEFAULT_MODEL} from './src/core/config/keyFile';
import {useArmedConfirm} from './src/ui/useArmedConfirm';
import {
  resolveQuickActions,
  type QuickActionItem,
} from './src/core/actions/quickActions';
import type {ModelConfig} from './src/core/model/types';
import {DEFAULT_CHAT_MAX_TOKENS} from './src/core/model/types';
import {docsSummary, type DocSummary} from './src/core/store/transcriptStore';
import {type AutoTarget} from './src/core/store/autoEngine';
import {pokeAuto} from './src/native/autoTranscript';
import {readSettings, updateSettings} from './src/native/settings';
import {consumeNavIntent} from './src/native/navIntent';
import {
  loadStore,
  clearAllRespectingLocks,
  subscribeStore,
} from './src/native/transcriptStoreIo';
import {getApiKey, deleteApiKey} from './src/native/secureKey';
import {PANEL, applyScreenSize} from './src/ui/panelConfig';
import {theme} from './src/ui/theme';
import HomeScreen from './screens/HomeScreen';
import MenuScreen, {type MenuItem} from './screens/MenuScreen';
import {buildMenuItems} from './src/ui/menuVocab';
import {ensureUserGuide, openUserGuide} from './src/native/guideSeed';
import {captureBridge} from './src/native/captureBridge';
import {captureCurrent} from './src/native/capture';
import {consumeLibTargetIntent} from './src/native/libTargetIntent';
import KeyAppScreen, {
  DEFAULT_SCALE,
  DEFAULT_BTN_SCALE,
  type ToolbarSide,
} from './screens/KeyAppScreen';
import ReadConfigScreen from './screens/ReadConfigScreen';
import ChatAgentsScreen from './screens/ChatAgentsScreen';
import LibraryScreen from './screens/library/LibraryScreen';
import {
  type Agent,
  DEFAULT_LASSO_DIRECTIVE,
  DEFAULT_IMAGE_QUICK_ACTIONS,
} from './src/core/agents/agents';

const {SmartNoteAiOverlay} = NativeModules;


export type KeyState =
  | {kind: 'loading'}
  | {kind: 'missing'}
  | {kind: 'ok'; config: ModelConfig};

export type Screen =
  | 'menu'
  | 'home'
  | 'keyapp'
  | 'read'
  | 'library'
  | 'analyse';

// Prop-function types shared with the screens (phase 4): the sub-screen
// header factory and the generic chip row are built in App (they close
// over navigation, openAssistant and the button scale) and passed down.
export type SubHeaderFn = (
  title: string,
  onBack?: () => void,
  // v0.72: a labelled back button instead of the bare "←" (the Library
  // passes "Config" so the arrow reads as where it goes).
  backLabel?: string,
) => React.JSX.Element;
export type ChipRowFn = <T>(
  entries: [T, string][],
  value: T,
  onPick: (v: T) => void,
) => React.JSX.Element;

// Provenance labels + date formatters live in the shared UI kit
// (src/ui/labels.ts, phase 4) — App and ChatPanel used to carry
// diverging copies.

function App(): React.JSX.Element {
  const [keyState, setKeyState] = useState<KeyState>({kind: 'loading'});
  const [legacyPresent, setLegacyPresent] = useState<boolean>(false);
  const [model, setModel] = useState<string>('');
  const [persona, setPersona] = useState<string>('');
  const [scale, setScale] = useState<number>(DEFAULT_SCALE);
  const [btnScale, setBtnScale] = useState<number>(DEFAULT_BTN_SCALE);
  const [toolbarSide, setToolbarSide] = useState<ToolbarSide>('left');
  const [promptBlocks, setPromptBlocks] = useState<Record<string, string>>({});
  // v0.30 per-folder / per-note Auto TARGET {mode,power} (Library chips).
  const [autoTargets, setAutoTargets] = useState<Record<string, AutoTarget>>(
    {},
  );
  const [answerStyle, setAnswerStyle] = useState<
    'precise' | 'balanced' | 'creative'
  >('balanced');
  // v0.81 lasso mode (user): the "there is an image to read" directive
  // (edited in door 2 READ; empty = send nothing) and the image quick
  // actions (edited in door 3 CHAT; shown only when an image is in context).
  const [lassoDirective, setLassoDirective] = useState<string>(
    DEFAULT_LASSO_DIRECTIVE,
  );
  const [imageQuickActions, setImageQuickActions] = useState<QuickActionItem[]>(
    DEFAULT_IMAGE_QUICK_ACTIONS,
  );
  const [quickActions, setQuickActions] = useState<QuickActionItem[]>(() =>
    resolveQuickActions(),
  );
  // v0.55 AI Agents (persona + docs + model, max 4).
  const [agents, setAgents] = useState<Agent[]>([]);
  // Library browser (v0.22.1): doc list, per-doc page list, page view.
  const [lib, setLib] = useState<DocSummary[]>([]);
  // The sidebar entries (index.js) set a nav intent BEFORE the view
  // mounts. Consume it ONCE here for the initial screen (no home flash on
  // a fresh open straight to the Library). 'chat' isn't a screen — it's
  // handled by the effect after openAssistant is defined.
  const [bootIntent] = useState<string | null>(() => consumeNavIntent());
  const [screen, setScreen] = useState<Screen>(
    bootIntent === 'library'
      ? 'library'
      : bootIntent === 'home'
      ? 'home'
      : 'menu', // v0.85: the single toolbar entry lands on the hub
  );
  // v0.85: a Library deep-link target set by the menu ("current note/page
  // transcript"); LibraryScreen opens it on mount, then it is cleared. The menu
  // overlay is a separate root, so it hands the target over via a module.
  const [libTarget, setLibTarget] = useState<
    {doc: string; page: number | null} | null
  >(() => (bootIntent === 'library' ? consumeLibTargetIntent() : null));
  const [msg, setMsg] = useState<string>('');
  // v0.80.0 (audit L7): navigating retires stale feedback — a "Key saved…"
  // line must not follow the user from screen to screen.
  const navTo = useCallback((s: Screen) => {
    setMsg('');
    setScreen(s);
  }, []);
  // "User manual & OCR config" collapsible in the Library (was the READ page).
  const loaded = useRef(false);

  const refreshLib = useCallback(async () => {
    const s = await loadStore();
    setLib(docsSummary(s));
  }, []);

  const load = useCallback(async () => {
    const [ks, saved] = await Promise.all([getApiKey(), readSettings()]);
    // UNCONDITIONAL setters with defaults (v0.59, self-audit M1): load()
    // used to only set fields present in the file, so an Import of a
    // file WITHOUT one of them kept the old App state — and the
    // debounced save wrote the stale value right back. "Import replaces
    // all" must hold for every field.
    setPersona(saved.persona ?? '');
    setScale(saved.textScale ?? DEFAULT_SCALE);
    setBtnScale(saved.buttonScale ?? DEFAULT_BTN_SCALE);
    setToolbarSide(saved.toolbarSide ?? 'left');
    setPromptBlocks(saved.promptBlocks ?? {});
    // No settings-driven store wipe here any more (v0.58, audit C3): the
    // transcript store versions its own content (contentV in its
    // index.json) and handles its own fresh starts at load.
    setAutoTargets(saved.autoTargets ?? {});
    setAnswerStyle(saved.answerStyle ?? 'balanced');
    // v0.81: empty lassoDirective is meaningful (send none); only `undefined`
    // falls back to the shipped default.
    setLassoDirective(
      typeof saved.lassoDirective === 'string'
        ? saved.lassoDirective
        : DEFAULT_LASSO_DIRECTIVE,
    );
    setImageQuickActions(
      saved.imageQuickActions !== undefined
        ? saved.imageQuickActions
        : DEFAULT_IMAGE_QUICK_ACTIONS(),
    );
    setQuickActions(resolveQuickActions(saved.quickActions));
    // v0.79.17 (user): a FRESH install ships with NO agents — the default
    // mode is agent-free. The starter presets are no longer auto-seeded;
    // they're available on demand via "+ Add preset" in door 3 (which adds
    // any not-already-present preset). We never touch the user's own agents.
    const initialAgents = saved.agents ?? [];
    setAgents(initialAgents);
    setLegacyPresent(ks.legacyFilePresent);
    if (ks.migrated) {
      setMsg('Key imported from mistral-key.txt (now stored encrypted).');
    }
    if (ks.key === null) {
      setKeyState({kind: 'missing'});
      // Pre-reinstall audit #0: the model state must follow the DISK even
      // without a key, or the debounced save (armed by load()'s own
      // setStates) persists model:'' over a just-imported choice — the
      // user would then silently chat and pay on the default model.
      setModel(saved.model ?? '');
    } else {
      const m = saved.model || DEFAULT_MODEL;
      setKeyState({
        kind: 'ok',
        config: {apiKey: ks.key, model: m, maxTokens: DEFAULT_CHAT_MAX_TOKENS},
      });
      // Unconditional too (M1): `prev || m` kept a pre-import model alive
      // across load(). The disk state IS the truth here — load() only
      // runs at boot, after a key save, and after an Import.
      setModel(m);
    }
    refreshLib().catch(() => {});
    // v0.60 embedded User Guide: idempotent — installs the PDF and/or
    // re-seeds its transcript only when missing (first launch, fresh
    // start, Clear all). The store notify refreshes the library list.
    ensureUserGuide().catch(() => {});
    loaded.current = true;
  }, [refreshLib]);

  useEffect(() => {
    load();
  }, [load]);

  // The config page stays MOUNTED while the floating panel works — the
  // library list must follow the store, not the last visit (device bug
  // 2026-07-12: chat filled the library, READ still showed it empty).
  // DEBOUNCED: a whole-note read mutates the store dozens of times and
  // storeStats serializes it each refresh — unthrottled, it janked the
  // config UI (device feedback 2026-07-12).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = subscribeStore(() => {
      if (t !== null) {
        clearTimeout(t);
      }
      t = setTimeout(() => refreshLib().catch(() => {}), 600);
    });
    return () => {
      off();
      if (t !== null) {
        clearTimeout(t);
      }
    };
  }, [refreshLib]);

  // (The old "model lacks tools → wipe the toggles" effect is gone: it
  // fired on every keystroke of a custom model id and erased the user's
  // choices. The chat now simply ignores the toggles for a tool-less
  // model — see ChatPanel.send.)

  // Debounced settings save — WITH an unmount flush (v0.56, device bug:
  // "create an agent, open the Assistant to try it" closed the config
  // ~250 ms later; the effect cleanup killed the pending 500 ms timer
  // and the agent was NEVER written — settings.json kept "agents": []
  // while the mounted screen showed it. The hole predates agents: ANY
  // setting edited < 500 ms before the config closed was silently lost).
  const pendingSaveRef = useRef<(() => Promise<void>) | null>(null);
  // The last write actually STARTED (audit 2026-07-19 E3): doSave nulls
  // pendingSaveRef at entry, so a flush arriving while the write is in
  // flight used to resolve immediately — and ✕ could closePluginView
  // before the write landed. flushSettings waits for this too.
  const lastWriteRef = useRef<Promise<void>>(Promise.resolve());
  // Generation guard (v0.56.1): RN FREEZES JS timers while the plugin
  // view is backgrounded (the v0.53 heartbeat finding) — a debounce
  // timer frozen at close can fire MUCH later with a stale closure and
  // overwrite fresher settings. Every effect run bumps the generation;
  // a doSave from an older run becomes a no-op.
  const saveGenRef = useRef(0);
  useEffect(() => {
    if (!loaded.current) {
      return;
    }
    const gen = ++saveGenRef.current;
    const doSave = (): Promise<void> => {
      pendingSaveRef.current = null;
      if (gen !== saveGenRef.current) {
        return Promise.resolve(); // a newer state superseded this save
      }
      // PATCH through the settings singleton (v0.58): only the fields
      // this effect owns. Fields with other owners — ChatAgentsScreen's
      // `agents` (v0.57 one-writer rule), LibraryScreen's lastCheckAllAt
      // — are untouched by a patch, and the singleton serializes the
      // full in-memory state, so no writer can drop another's field and
      // the disk is never read back for merging (the read-merge-write
      // that promoted a sync-gutted file to truth on 2026-07-18).
      const w = updateSettings({
        model,
        persona,
        textScale: scale,
        buttonScale: btnScale,
        toolbarSide,
        promptBlocks,
        autoTargets,
        answerStyle,
        quickActions,
        lassoDirective,
        imageQuickActions,
      })
        .then(() => {})
        .catch(() => {});
      lastWriteRef.current = w;
      return w;
    };
    const t = setTimeout(doSave, 500);
    pendingSaveRef.current = () => {
      clearTimeout(t);
      return doSave();
    };
    return () => clearTimeout(t);
  }, [model, persona, scale, btnScale, toolbarSide, promptBlocks, autoTargets, answerStyle, quickActions, lassoDirective, imageQuickActions]);
  // Unmount: fire the pending save NOW instead of dropping it. (On a
  // dep change the ref is immediately re-armed by the next effect run,
  // so this only ever fires with the LATEST state.)
  useEffect(
    () => () => {
      pendingSaveRef.current?.(); // fire-and-forget on unmount
    },
    [],
  );
  // Flush the pending save at EVERY screen exit (v0.56.1, device: the
  // user's agent name/persona/docs vanished AGAIN): the 500 ms debounce
  // timer cannot be trusted across a view close — RN freezes JS timers
  // in the background, so "edit → tap ✕ within 500 ms" silently lost
  // the write. Cheap (a few KB) and always with the latest state.
  const flushSettings = useCallback(
    (): Promise<void> =>
      Promise.all([
        pendingSaveRef.current?.() ?? Promise.resolve(),
        // E3: also wait out a write already in flight (the settings
        // queue serializes them, but the PROMISE was lost to callers).
        lastWriteRef.current,
      ]).then(() => {}),
    [],
  );

  // One-tap-confirm target for destructive clears: 'ALL', a folder path
  // or a doc path.
  // (confirmClear now derives from the shared useArmedConfirm below.)
  // ONE armed-confirm instance for every destructive tap in the config
  // (key delete, clears): keys are namespaced strings. Phase 4 §2.1 —
  // replaces the two hand-rolled copies.
  const {armed: confirmArmed, confirm: armConfirm} = useArmedConfirm(4000);
  const confirmDelKey = confirmArmed === 'DELKEY';
  const confirmClear = confirmArmed; // clears use 'ALL' / a path as key
  const onDeleteKey = useCallback(async () => {
    if (!armConfirm('DELKEY')) {
      return;
    }
    const ok = await deleteApiKey();
    if (ok) {
      setKeyState({kind: 'missing'});
      setMsg('Key deleted from the device.');
    } else {
      setMsg('Could not delete the key.');
    }
  }, [armConfirm]);

  /* ---------- LIBRARY: housekeeping ---------- */

  // One-tap-confirm wrapper shared by every destructive clear — thin
  // adapter over the shared useArmedConfirm instance (async runner).
  const armThen = useCallback(
    (key: string, run: () => Promise<void>): void => {
      armConfirm(key, () => {
        run().catch(() => {});
      });
    },
    [armConfirm],
  );

  const clearAll = useCallback(() => {
    armThen('ALL', async () => {
      // Locks survive even Clear ALL (user decision 2026-08-03).
      const r = await clearAllRespectingLocks();
      await refreshLib();
      setMsg(
        r.skippedLockedDocs > 0 || r.keptLockedPages > 0
          ? `All transcripts cleared — 🔒 kept ${r.skippedLockedDocs} locked doc(s), ${r.keptLockedPages} locked page(s).`
          : 'All transcripts cleared.',
      );
    });
  }, [armThen, refreshLib]);

  // A background pass whenever a config/library page is shown (v0.86.4, user):
  // arriving on ANY page — home, Library, agents… — is a "we can sync now"
  // moment, so the tick drains whatever is pending for the CURRENT host (notes
  // if the plugin sits over a note, PDFs if over a PDF). force bypasses the
  // 20 s floor so landing on the page reacts at once; pokeAuto's 1.5 s debounce
  // coalesces rapid navigation, and drain-continue carries the backlog.
  // includeCurrent (v0.87.1, device repro 2026-07-30): with this full-screen
  // view up the note behind CANNOT receive ink, so the "current page" deferral
  // would never release — the page you just edited sat unsynced while you
  // watched the Library. Same safety as Sync now: the tick flushes the note
  // (saveCurrentNote + 600 ms) before rendering.
  useEffect(() => {
    pokeAuto(`view:${screen}`, {force: true, includeCurrent: true});
  }, [screen]);

  // v0.87.3 (device 2026-07-30): the [screen] effect above misses RE-entering
  // the plugin on the SAME screen — PluginHost keeps this view mounted across
  // close/open, so `screen` stays 'library' and no poke fires when the user
  // comes back to check their sync. AppState 'active' = the plugin view
  // returned to the foreground, whatever the screen state: the one reliable
  // "user is looking at us, the note behind can't receive ink" signal.
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => {
      if (st === 'active') {
        pokeAuto('app-active', {force: true, includeCurrent: true});
      } else {
        // v0.88 (audit): host-initiated closes are the one exit path with no
        // in-app flush — commit any pending debounced edit before RN freezes
        // our timers.
        flushSettings().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [flushSettings]);

  const openAssistant = useCallback(async () => {
    setMsg('opening floating assistant…');
    // Flush any pending settings save FIRST (v0.56): the panel reads
    // settings.json for its start card — "create an agent → open the
    // Assistant" must never race the 500 ms debounce (that race is how
    // agents kept vanishing on device, 2026-07-19). E3: including a
    // write already in flight.
    await Promise.all([
      pendingSaveRef.current?.() ?? Promise.resolve(),
      lastWriteRef.current,
    ]);
    try {
      // Default open width = 80% of the screen (device feedback).
      try {
        const s = await SmartNoteAiOverlay.getScreenSize?.();
        if (s && s.success) {
          applyScreenSize(s.width, s.height);
        }
      } catch {
        // fallback dims
      }
      const r = await SmartNoteAiOverlay.open(
        PANEL.width,
        PANEL.height,
        PANEL.x,
        PANEL.y,
      );
      if (r && r.success) {
        // Clear the transient status so it doesn't linger at the bottom of
        // config pages the next time the panel is reopened.
        setMsg('');
        setTimeout(() => PluginManager.closePluginView(), 250);
      } else {
        setMsg(`Could not open panel: ${r ? `${r.code}, ${r.message}` : 'no result'}`);
      }
    } catch (e) {
      setMsg(`Open failed: ${String((e as Error).message ?? e)}`);
    }
  }, []);

  // Nav-intent router (v0.72): the boot intent + a 500-ms foreground poll
  // for presses that arrive while the view is already mounted (it stays
  // alive between sidebar presses). Each entry forces its target —
  // 'config' back to home, 'library' to the Library, 'chat' opens the
  // floating overlay and closes this view. Placed after openAssistant so
  // it can reference it.
  useEffect(() => {
    const id = setInterval(() => {
      const s = consumeNavIntent();
      if (s === 'library') {
        const t = consumeLibTargetIntent();
        if (t !== null) {
          setLibTarget(t);
        }
        setScreen('library');
      } else if (s === 'home') {
        setScreen('home');
      }
    }, 500);
    return () => clearInterval(id);
  }, [bootIntent, openAssistant]);

  const bp = {paddingHorizontal: 12 * btnScale, paddingVertical: 7 * btnScale};
  const bf = {fontSize: 13 * btnScale};

  const chipRow = <T,>(
    entries: [T, string][],
    value: T,
    onPick: (v: T) => void,
  ): React.JSX.Element => (
    <View style={styles.chips}>
      {entries.map(([val, lbl]) => {
        const on = value === val;
        return (
          <TouchableOpacity
            key={String(val)}
            onPress={() => onPick(val)}
            style={[styles.chip, bp, on && styles.chipOn]}>
            <Text style={[styles.chipText, bf, on && styles.chipTextOn]}>{lbl}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // Top-right of every config header: a black "Assistant" button (closes
  // config, opens the floating window) next to the ✕ (closes the plugin).
  const headerRight = (): React.JSX.Element => (
    <View style={styles.headerRight}>
      {/* v0.88.2 (user): EVERY page links back to the Menu from the top
          bar — hub, doors, Library and its page/transcript levels alike.
          Hidden on the menu itself. */}
      {screen !== 'menu' ? (
        <TouchableOpacity
          onPress={() => {
            flushSettings();
            navTo('menu');
          }}
          style={styles.asstBtn}>
          <Text style={styles.asstBtnText}>≡ Menu</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity onPress={openAssistant} style={styles.asstBtn}>
        <Text style={styles.asstBtnText}>Assistant</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => {
          // Save BEFORE the view closes — a closed view freezes JS
          // timers and the debounced write would never run (v0.56.1).
          flushSettings().finally(() => PluginManager.closePluginView());
        }}
        style={styles.closeBtn}>
        <Text style={styles.closeText}>✕</Text>
      </TouchableOpacity>
    </View>
  );

  const subHeader = (
    title: string,
    onBack?: () => void,
    backLabel?: string,
  ): React.JSX.Element => (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={() => {
          // Leaving a config screen commits its edits right away —
          // never trust the debounce timer to survive what comes next.
          flushSettings();
          (onBack ?? (() => navTo('home')))();
        }}
        style={backLabel ? styles.backLabelBtn : styles.closeBtn}
        hitSlop={{top: 12, bottom: 12, left: 12, right: 8}}>
        <Text style={backLabel ? styles.backLabelText : styles.closeText}>
          {backLabel ? `‹ ${backLabel}` : '←'}
        </Text>
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {headerRight()}
    </View>
  );

  /* ================ 1 · Key & appearance ================ */
  if (screen === 'keyapp') {
    return (
      <KeyAppScreen
        keyState={keyState}
        legacyPresent={legacyPresent}
        setLegacyPresent={setLegacyPresent}
        msg={msg}
        setMsg={setMsg}
        load={load}
        flushSettings={flushSettings}
        onDeleteKey={onDeleteKey}
        confirmDelKey={confirmDelKey}
        clearAll={clearAll}
        confirmClear={confirmClear}
        scale={scale}
        setScale={setScale}
        btnScale={btnScale}
        setBtnScale={setBtnScale}
        toolbarSide={toolbarSide}
        setToolbarSide={setToolbarSide}
        chipRow={chipRow}
        subHeader={subHeader}
      />
    );
  }

  /* ================ 2 · READ: transcript params ================ */
  if (screen === 'read') {
    return (
      <ReadConfigScreen
        keyState={keyState}
        promptBlocks={promptBlocks}
        setPromptBlocks={setPromptBlocks}
        lassoDirective={lassoDirective}
        setLassoDirective={setLassoDirective}
        refreshLib={refreshLib}
        scale={scale}
        btnScale={btnScale}
        subHeader={subHeader}
      />
    );
  }

  /* ================ 3 · LIBRARY ================ */
  if (screen === 'library') {
    return (
      <LibraryScreen
        keyState={keyState}
        promptBlocks={promptBlocks}
        autoTargets={autoTargets}
        setAutoTargets={setAutoTargets}
        lib={lib}
        agents={agents}
        refreshLib={refreshLib}
        msg={msg}
        setMsg={setMsg}
        scale={scale}
        btnScale={btnScale}
        clearAll={clearAll}
        confirmClear={confirmClear}
        subHeader={subHeader}
        goHome={() => navTo('menu')}
        openTarget={libTarget}
        clearOpenTarget={() => setLibTarget(null)}
        flushSettings={flushSettings}
      />
    );
  }

  /* ============ 4 · CHAT & AGENTS (unified, v0.59) ============ */
  // 'agents' kept as an alias route: anything still navigating to the
  // old door lands on the same unified screen.
  if (screen === 'analyse') {
    return (
      <ChatAgentsScreen
        keyState={keyState}
        model={model}
        setModel={setModel}
        persona={persona}
        setPersona={setPersona}
        answerStyle={answerStyle}
        setAnswerStyle={setAnswerStyle}
        imageQuickActions={imageQuickActions}
        setImageQuickActions={setImageQuickActions}
        goLibrary={() => navTo('library')}
        quickActions={quickActions}
        setQuickActions={setQuickActions}
        agents={agents}
        setAgents={setAgents}
        autoTargets={autoTargets}
        lib={lib}
        scale={scale}
        btnScale={btnScale}
        chipRow={chipRow}
        subHeader={subHeader}
      />
    );
  }

  /* ================ Menu (hub) ================ */
  if (screen === 'menu') {
    const openCurrent = (pageLevel: boolean): void => {
      captureCurrent(captureBridge())
        .then(cap => {
          if (cap === null) {
            setMsg('No note or PDF is open right now.');
            return;
          }
          setLibTarget({doc: cap.notePath, page: pageLevel ? cap.page : null});
          navTo('library');
        })
        .catch(() => setMsg('Could not read the current file.'));
    };
    const items: MenuItem[] = buildMenuItems({
      assistant: openAssistant,
      library: () => {
        setLibTarget({doc: '', page: null});
        navTo('library');
      },
      currentDoc: () => openCurrent(false),
      currentPage: () => openCurrent(true),
      config: () => navTo('home'),
      guide: () => {
        setMsg('opening the User Guide…');
        // v0.88.1 (user #1): the PDF opened BEHIND the plugin view — close
        // the view (settings flushed first) so the guide lands on top.
        openUserGuide().then(ok => {
          if (!ok) {
            setMsg('⚠ Could not open the User Guide PDF.');
            return;
          }
          setMsg('');
          flushSettings()
            .catch(() => {})
            .then(() => setTimeout(() => PluginManager.closePluginView(), 150));
        });
      },
    });
    return (
      <MenuScreen
        scale={scale}
        btnScale={btnScale}
        items={items}
        headerRight={headerRight}
      />
    );
  }

  /* ================ Home (config doors) ================ */
  return (
    <HomeScreen
      keyState={keyState}
      msg={msg}
      scale={scale}
      btnScale={btnScale}
      setScreen={navTo}
      openGuide={() => {
        setMsg('opening the User Guide…');
        // v0.88.1 (user #1): close the config so the PDF lands on top.
        openUserGuide().then(ok => {
          if (!ok) {
            setMsg('⚠ Could not open the User Guide PDF.');
            return;
          }
          setMsg('');
          flushSettings()
            .catch(() => {})
            .then(() => setTimeout(() => PluginManager.closePluginView(), 150));
        });
      }}
      headerRight={headerRight}
    />
  );
}

// App-only chrome styles (the header's Assistant / ✕ buttons); every
// style shared with a screen lives in src/ui/theme.ts.
const local = StyleSheet.create({
  closeBtn: {paddingVertical: 10, paddingHorizontal: 18},
  closeText: {fontSize: 22, color: '#000000'},
  backLabelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 8,
  },
  backLabelText: {fontSize: 15, fontWeight: '700', color: '#000000'},
  headerRight: {flexDirection: 'row', alignItems: 'center', gap: 4},
  asstBtn: {
    backgroundColor: '#000000',
    borderRadius: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  asstBtnText: {fontSize: 14, fontWeight: '700', color: '#ffffff'},
});
const styles = {...theme, ...local};

export default App;
