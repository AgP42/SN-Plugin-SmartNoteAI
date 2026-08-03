// Persisted user settings — REBUILT v0.58 after the 2026-07-18 data
// loss (a Supernote cloud-sync conflict emptied the old MyStyle
// settings.json mid-session; a single-field merge-write then rewrote the
// gutted file as truth and the schemaV trap wiped the transcript store).
//
// Architecture (user decision 2026-07-19):
//  - AUTHORITY: <pluginDir>/settings.json (+ .bak) — the plugin's
//    PRIVATE dir (same home as the sharded transcript store), which the
//    Supernote cloud never syncs. Survives reinstalls.
//  - ONE in-memory state, loaded ONCE per session. Readers get copies of
//    it; writers PATCH it and serialize the FULL state. The disk is
//    never read back for merging, so a transient empty/stale read can
//    never be promoted to truth again.
//  - MyStyle is export/import territory ONLY: two explicit buttons
//    (KeyAppScreen) write/read smartnoteai-settings.json on demand —
//    backup, hand-editing and Manta→A5X transfer become deliberate acts
//    instead of a permanent write channel the sync can poison.
//  - One-time migration: first boot without a private file adopts the
//    legacy MyStyle settings.json (never read again afterwards).

import {NativeModules} from 'react-native';
import {FileUtils, PluginManager} from 'sn-plugin-lib';
import {CONFIG_DIR, readTextFileUtf8} from './fs';
import {writeTextAtomic} from './fs';
import {makeWriteQueue} from '../core/util/writeQueue';
import type {QuickActionItem} from '../core/actions/quickActions';
import {sanitizeAutoTargets, type AutoTarget} from '../core/store/autoEngine';
import {
  sanitizeAgents,
  PRESET_AGENTS,
  MAX_AGENTS,
  type Agent,
} from '../core/agents/agents';

const {SmartNoteAiOverlay} = NativeModules as any;

// The pre-v0.58 location (cloud-synced!) — migration source only.
// (LEGACY_SETTINGS_PATH removed in Phase C — no migration remains.)
// Export/Import file (MyStyle, visible, cloud-backed — on purpose: the
// export doubles as a backup and a cross-device transfer vehicle).
export const EXPORT_SETTINGS_PATH = `${CONFIG_DIR}/smartnoteai-settings.json`;

export type Settings = {
  model?: string;
  persona?: string;
  // Chat text size multiplier (1 = the original "Small"). Presets in
  // the UI: S=1, M=1.15, L=1.3, XL=1.5.
  textScale?: number;
  // Button size multiplier (finger-friendliness), applied everywhere.
  buttonScale?: number;
  // Where the Supernote note toolbar sits, so snaps don't cover it.
  toolbarSide?: 'none' | 'left' | 'right' | 'top' | 'bottom';
  // v0.32: per-folder / per-note Auto TARGET = {mode}. Single engine now
  // (Mistral OCR 4 + automatic vision escalation), so there is no engine
  // setting any more. See src/core/store/autoEngine.ts.
  autoTargets?: Record<string, AutoTarget>;
  // v0.20: the OCR persona — decipher help (context + vocabulary).
  // v0.38: superseded by promptBlocks (migrated into its 'glossary'
  // block on first read). Kept in the type for the migration only.
  // v0.38: the vision transcription prompt, editable per BLOCK
  // (src/core/model/visionPrompt.ts). blockId -> override text; an absent
  // id uses the block's default. Nothing hidden — the config shows the
  // assembled prompt verbatim.
  promptBlocks?: Record<string, string>;
  // v0.50: webSearch/codeInterpreter sticky toggles are GONE (the
  // connectors are one-shot per message in the panel now); old keys in
  // settings.json are silently ignored.
  // "Answer style" (v0.49): 3-state chip mapping to the sampling
  // temperature (precise 0.2 / balanced = model default / creative 0.9).
  answerStyle?: 'precise' | 'balanced' | 'creative';
  // v0.52: timestamp of the last completed "Check all notes for changes"
  // (shown in the sync frame; written by LibraryScreen directly).
  lastCheckAllAt?: number;
  // User-configurable quick actions (edit via export/import or config).
  quickActions?: QuickActionItem[];
  // v0.81 (user): the lasso is a transverse MODE, not an agent. Two fields:
  //  - lassoDirective: the "there is an image to read" system directive,
  //    appended to the active brain's prompt while a lasso image is in
  //    context. Materialised with DEFAULT_LASSO_DIRECTIVE on first run;
  //    an EMPTY string sends NOTHING (never forced back). Edited in door 2.
  //  - imageQuickActions: up to 3 quick actions shown ONLY when an image is
  //    in context (edited in door 3, CHAT). Default = "About this selection".
  lassoDirective?: string;
  imageQuickActions?: QuickActionItem[];
  // v0.55 AI Agents: persona + library docs + model, max 4 (see
  // src/core/agents/agents.ts). Their docs are LRU-pinned in the store.
  agents?: Agent[];
  // (v0.80.0: the old presetsSeeded flag is gone — presets are no longer
  // auto-seeded at all; "+ Add preset" / "Add starter agents" add them on
  // demand. An existing stored flag is simply dropped by sanitize.)
  // v0.63.1: last AUTO-mode docs synced (name · epoch ms · pages), max 5,
  // newest first. ONE writer: autoTranscript (recordAutoSync).
  recentAutoSyncs?: {name: string; at: number; pages: number}[];
  // v0.87: MANUAL docs whose sync was explicitly requested ("Sync now") and
  // is not finished yet (chunked >100 p, offline, wrong render host…). The
  // background tick treats them as paid-allowed until their debt — Vision
  // included — is gone, then removes them: "Sync now" is fire-and-forget.
  // ONE writer: autoTranscript.
  manualSyncWanted?: string[];
  // Settings-file schema version. Since v0.58 this versions the SETTINGS
  // file only — the transcript store carries its own contentV in its
  // index.json and its lifecycle no longer hangs on this field (the old
  // coupling is what amplified a settings hiccup into a store wipe).
};

// Validate an arbitrary parsed object into a Settings (unknown/invalid
// fields dropped). Shared by the session load, the legacy migration and
// the Import button — every byte that becomes state goes through here.
export const sanitizeSettings = (obj: unknown): Settings => {
  const s: Settings = {};
  if (!obj || typeof obj !== 'object') {
    return s;
  }
  const o = obj as Record<string, unknown>;
  if (typeof o.model === 'string') {
    s.model = o.model;
  }
  if (typeof o.persona === 'string') {
    s.persona = o.persona;
  }
  if (typeof o.textScale === 'number' && o.textScale > 0) {
    s.textScale = o.textScale;
  }
  if (typeof o.buttonScale === 'number' && o.buttonScale > 0) {
    s.buttonScale = o.buttonScale;
  }
  if (
    o.toolbarSide === 'none' ||
    o.toolbarSide === 'left' ||
    o.toolbarSide === 'right' ||
    o.toolbarSide === 'top' ||
    o.toolbarSide === 'bottom'
  ) {
    s.toolbarSide = o.toolbarSide;
  }
  // v0.38: prompt blocks (blockId -> string override).
  if (o.promptBlocks && typeof o.promptBlocks === 'object') {
    const pb: Record<string, string> = {};
    for (const [k, v] of Object.entries(o.promptBlocks)) {
      if (typeof v === 'string') {
        pb[k] = v;
      }
    }
    if (Object.keys(pb).length > 0) {
      s.promptBlocks = pb;
    }
  }
  // v0.32: per-target {mode} map (mode-only; single engine now). No
  // legacy migration — old shapes are dropped (fresh start).
  const targets = sanitizeAutoTargets(o.autoTargets);
  if (Object.keys(targets).length > 0) {
    s.autoTargets = targets;
  }
  if (
    o.answerStyle === 'precise' ||
    o.answerStyle === 'balanced' ||
    o.answerStyle === 'creative'
  ) {
    s.answerStyle = o.answerStyle;
  }
  if (typeof o.lastCheckAllAt === 'number' && o.lastCheckAllAt > 0) {
    s.lastCheckAllAt = o.lastCheckAllAt;
  }
  // v0.81 lasso: the "there is an image" directive. An EMPTY string is a
  // valid, meaningful value (send no directive) — so we keep it verbatim,
  // never substitute a default here (the UI materialises the default).
  if (typeof o.lassoDirective === 'string' && o.lassoDirective.length <= 2000) {
    s.lassoDirective = o.lassoDirective;
  }
  // (Phase C: the readerPersona migration is gone — owner decision G.)
  const asQuickActions = (v: unknown, cap: number): QuickActionItem[] =>
    Array.isArray(v)
      ? v
          .filter(
            (a: unknown): a is QuickActionItem =>
              a != null &&
              typeof (a as QuickActionItem).label === 'string' &&
              typeof (a as QuickActionItem).prompt === 'string' &&
              typeof (a as QuickActionItem).enabled === 'boolean',
          )
          .slice(0, cap)
      : [];
  const iqa = asQuickActions(o.imageQuickActions, 3);
  if (
    Array.isArray(o.imageQuickActions) &&
    (iqa.length > 0 || o.imageQuickActions.length === 0)
  ) {
    s.imageQuickActions = iqa; // [] survives: deliberate emptying (v0.88)
  }
  // (Phase C: the lassoPrompt→imageQuickActions migration is gone — owner
  // decision G, no published installation carries the old field.)
  const agents = sanitizeAgents(o.agents);
  if (agents.length > 0) {
    s.agents = agents;
  }
  // v0.88 (audit): a valid-but-EMPTY array is a deliberate "I removed them
  // all" and must survive the round-trip — dropping it resurrected the
  // default actions at every boot. Only `undefined` means "use defaults".
  if (Array.isArray(o.quickActions)) {
    const qa = asQuickActions(o.quickActions, 12);
    // A list that HAD entries and lost them all to validation is corrupt
    // input, not a deliberate emptying: leave the field absent so the
    // defaults apply (round 2 #9 — this local validator shadowed the fix
    // made in sanitizeQuickActions).
    if (qa.length > 0 || o.quickActions.length === 0) {
      s.quickActions = qa;
    }
  }
  if (Array.isArray(o.recentAutoSyncs)) {
    const ra = o.recentAutoSyncs
      .filter(
        (r: unknown): r is {name: string; at: number; pages: number} =>
          r !== null &&
          typeof (r as {name?: unknown}).name === 'string' &&
          typeof (r as {at?: unknown}).at === 'number' &&
          typeof (r as {pages?: unknown}).pages === 'number',
      )
      .slice(0, 5);
    if (ra.length > 0) {
      s.recentAutoSyncs = ra;
    }
  }
  if (Array.isArray(o.manualSyncWanted)) {
    const mw = o.manualSyncWanted
      .filter((p: unknown): p is string => typeof p === 'string' && p.length > 0)
      .slice(0, 500);
    if (mw.length > 0) {
      s.manualSyncWanted = mw;
    }
  }
  return s;
};

// null = unreadable/unparseable; {} = readable but no known field.
const parseSettingsText = (text: string | null): Settings | null => {
  if (text === null || text.trim().length === 0) {
    return null;
  }
  try {
    return sanitizeSettings(JSON.parse(text));
  } catch {
    return null;
  }
};

const hasData = (s: Settings | null): s is Settings =>
  s !== null && Object.keys(s).length > 0;

// Private authority dir — the plugin dir (same base as the transcript
// store). Hardened (self-audit M2): the lookup is RETRIED 3×, and when
// it still fails the session goes READ-ONLY (writes refused, loudly)
// instead of writing to a fallback dir. Two hazards ruled out at once:
// a session pinned to /sdcard silently losing its edits, AND the worse
// cross-dir split (load empty from the fallback, then write that empty
// state over the REAL file once the path resolves again). The fallback
// dir is CACHED so reads within the session at least stay consistent.
let dirIsFallback = false;
let dirP: Promise<string> | null = null;
const settingsDir = (): Promise<string> => {
  if (dirP === null) {
    dirP = (async () => {
      for (let i = 0; i < 3; i++) {
        const d = await (
          PluginManager as {getPluginDirPath: () => Promise<unknown>}
        )
          .getPluginDirPath()
          .catch(() => null);
        if (typeof d === 'string' && d.length > 0) {
          return d;
        }
      }
      dirIsFallback = true;
      console.warn(
        '[SmartNoteAI.settings]',
        'getPluginDirPath failed 3× — settings are READ-ONLY this session ' +
          '(writes refused; nothing is written to /sdcard)',
      );
      return '/sdcard';
    })();
  }
  return dirP;
};

const writeState = async (s: Settings): Promise<boolean> => {
  try {
    const dir = await settingsDir();
    if (dirIsFallback) {
      console.warn(
        '[SmartNoteAI.settings]',
        'write refused: plugin dir unresolved this session (M2 guard)',
      );
      return false;
    }
    if (stateReadOnly) {
      console.warn(
        '[SmartNoteAI.settings]',
        'write refused: settings were unreadable at load (S1 guard) — ' +
          'restart the plugin to retry',
      );
      return false;
    }
    try {
      await (FileUtils as any).makeDir?.(dir);
    } catch {
      // best-effort; the write below reports the real failure
    }
    const json = JSON.stringify(s);
    if (!(await writeTextAtomic(`${dir}/settings.json`, json))) {
      return false;
    }
    // Mirror AFTER the main write landed — .bak always holds a state that
    // was successfully written once (the boot fallback below trusts it).
    await writeTextAtomic(`${dir}/settings.json.bak`, json).catch(() => {});
    return true;
  } catch {
    return false;
  }
};

// The ONE in-memory state, loaded once per session.
// Read-failure evidence (re-audit 2026-07-19 S1): when the load found
// NOTHING but the disk shows the files EXIST (or a file was read but is
// corrupt), the session must not run on defaults — its first write
// would commit them over settings.json AND .bak, destroying agents/
// persona/promptBlocks on one transient IO hiccup. Same "read failure ≠
// absence" rule the store (B1) and conversations got; writes refused.
let stateReadOnly = false;
let stateP: Promise<Settings> | null = null;
const loadState = (): Promise<Settings> => {
  if (stateP === null) {
    stateP = (async () => {
      const dir = await settingsDir();
      const mainText = await readTextFileUtf8(`${dir}/settings.json`);
      const main = parseSettingsText(mainText);
      if (hasData(main)) {
        return main;
      }
      const bakText = await readTextFileUtf8(`${dir}/settings.json.bak`);
      const bak = parseSettingsText(bakText);
      if (hasData(bak)) {
        console.warn(
          '[SmartNoteAI.settings]',
          `settings.json empty/unreadable — recovered ${
            Object.keys(bak).length
          } field(s) from settings.json.bak`,
        );
        return bak;
      }
      // Evidence probe before adopting the empty state (S1). A file that
      // was READ but doesn't parse is corrupt-with-content; two null
      // reads with the files visible in the listing is a transient
      // failure. Both → read-only. A readable file that legitimately
      // holds zero known fields is NOT evidence (nothing to lose).
      const corrupt =
        (mainText !== null && main === null) ||
        (bakText !== null && bak === null);
      let unreadable = false;
      if (!corrupt && mainText === null && bakText === null) {
        try {
          const ls = await SmartNoteAiOverlay?.listDir?.(dir);
          unreadable =
            ls?.success === true &&
            (ls.entries ?? []).some(
              (e: {name: string; isDir: boolean}) =>
                !e.isDir &&
                (e.name === 'settings.json' ||
                  e.name === 'settings.json.bak'),
            );
        } catch {
          // listing threw: no evidence either way — a fresh install must
          // still be able to write its first settings.
        }
      }
      if (corrupt || unreadable) {
        stateReadOnly = true;
        console.warn(
          '[SmartNoteAI.settings]',
          'settings exist on disk but could not be read — READ-ONLY ' +
            'session (writes refused; nothing is overwritten)',
        );
        return {};
      }
      // Phase C (owner decision G, never published): the MyStyle legacy
      // migration is gone. First boot = defaults; the Import button is the
      // one supported way to bring settings in.
      return {};
    })();
  }
  return stateP;
};

// All writes are serialized through one queue: concurrent updaters
// (config debounce + an agent edit + a library stamp) each patch the
// freshest state and write the FULL document — last writer wins on the
// file, but no writer can drop another's field.
const queued = makeWriteQueue();

// Change notifier (re-audit 2026-07-19 P2): the floating panel and the
// config screens share ONE JS runtime, so an in-memory subscription is
// enough for the panel's start card to see an agent created while the
// panel stays mounted (the original "the chat offers no agents" device
// symptom had no re-shown trigger). Fired after every state change —
// even when the disk write failed: the in-memory authority DID advance.
const settingsListeners = new Set<() => void>();
export const subscribeSettings = (fn: () => void): (() => void) => {
  settingsListeners.add(fn);
  return () => {
    settingsListeners.delete(fn);
  };
};
const notifySettings = (): void => {
  for (const fn of settingsListeners) {
    try {
      fn();
    } catch {
      // a listener must not break the write path
    }
  }
};

export const readSettings = async (): Promise<Settings> => {
  const s = await loadState();
  // DEEP copy (self-audit m3): a shallow one shares the nested objects
  // (agents, autoTargets, promptBlocks, quickActions) with the singleton
  // state — one in-place mutation by any caller would silently corrupt
  // the authority. Settings are a few KB; the round-trip is negligible.
  return JSON.parse(JSON.stringify(s)) as Settings;
};

// v0.76: (re)add the built-in starter agents that are MISSING (matched by
// name), so a user can push the defaults into their config to try them —
// without touching or duplicating their own agents. Capped at MAX_AGENTS.
// Returns how many were added.
export const restoreDefaultAgents = async (): Promise<number> => {
  // v0.88 (audit): computed inside the write queue — see updateSettingsWith.
  let added = 0;
  await updateSettingsWith(s => {
    const cur = s.agents ?? [];
    const have = new Set(cur.map(a => a.name.trim().toLowerCase()));
    const add = PRESET_AGENTS.filter(p => !have.has(p.name.toLowerCase()));
    if (add.length === 0) {
      return {};
    }
    const next: Agent[] = [...cur, ...add].slice(0, MAX_AGENTS);
    added = next.length - cur.length;
    return {agents: next};
  });
  return added;
};

// Patch one or more fields and persist the FULL state. The in-memory
// state advances even if the disk write fails (the next update retries
// the whole state); callers that must know use the returned boolean.
export const updateSettings = (patch: Partial<Settings>): Promise<boolean> =>
  queued(async () => {
    const next = {...(await loadState()), ...patch};
    stateP = Promise.resolve(next);
    const ok = await writeState(next);
    notifySettings();
    return ok;
  });

// v0.88 (audit — the `agents` three-writer incident class): compute the
// patch INSIDE the write queue, against the freshest state. A read-modify-
// write done outside the queue (read, await something, updateSettings)
// can overwrite a concurrent writer's field with a stale copy; an updater
// function cannot. Return {} to change nothing.
export const updateSettingsWith = (
  updater: (s: Settings) => Partial<Settings>,
): Promise<boolean> =>
  queued(async () => {
    const cur = await loadState();
    const patch = updater(cur);
    if (Object.keys(patch).length === 0) {
      return true;
    }
    const next = {...cur, ...patch};
    stateP = Promise.resolve(next);
    const ok = await writeState(next);
    notifySettings();
    return ok;
  });

// Export the full state (pretty JSON, hand-editable) to MyStyle.
// Returns the written path, or null on failure. The API key is not part
// of Settings and thus never exported.
export const exportSettings = async (): Promise<string | null> => {
  const s = await loadState();
  try {
    try {
      await (FileUtils as any).makeDir?.(CONFIG_DIR);
    } catch {
      // best-effort
    }
    const okW = await writeTextAtomic(
      EXPORT_SETTINGS_PATH,
      JSON.stringify(s, null, 2),
    );
    return okW ? EXPORT_SETTINGS_PATH : null;
  } catch {
    return null;
  }
};

// Import = full REPLACE from the MyStyle file (a restore, not a merge:
// absent fields fall back to defaults). Explicit user action only.
export const importSettings = (): Promise<{
  ok: boolean;
  fields: string[];
  error?: string;
}> =>
  queued(async () => {
    const text = await readTextFileUtf8(EXPORT_SETTINGS_PATH);
    if (text === null || text.trim().length === 0) {
      return {
        ok: false,
        fields: [],
        error: `no readable file at ${EXPORT_SETTINGS_PATH}`,
      };
    }
    let obj: unknown;
    try {
      obj = JSON.parse(text);
    } catch {
      return {ok: false, fields: [], error: 'the file is not valid JSON'};
    }
    const next = sanitizeSettings(obj);
    const fields = Object.keys(next);
    if (fields.length === 0) {
      return {
        ok: false,
        fields: [],
        error: 'no known settings field in the file',
      };
    }
    stateP = Promise.resolve(next);
    // An explicit Import lifts the S1 read-only guard: it is the ONE
    // deliberate full-replace the guard exists to funnel users toward
    // when the on-disk settings are unreadable.
    stateReadOnly = false;
    const ok = await writeState(next);
    notifySettings();
    return ok
      ? {ok: true, fields}
      : {ok: false, fields, error: 'could not write the settings file'};
  });
