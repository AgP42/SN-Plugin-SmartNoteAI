/**
 * 3 · LIBRARY — search, the SYNCHRONISATION frame, the whole-Supernote
 * tree browser, EXPORT, plus the per-doc PageGrid and PageView children.
 * Extracted VERBATIM from App.tsx (phase 4, spec §2.2). All library-only
 * state lives here now, so it mounts on entering the Library and unmounts
 * on leaving (tree cache, page counts, browse position reset per visit —
 * the sweep/poll effects no longer run outside the Library).
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  AppState,
  DeviceEventEmitter,
  ToastAndroid,
  NativeModules,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  StyleSheet,
} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';

import {fmtDateTime, srcLongFor} from '../../src/ui/labels';
import {
  getPage,
  pagesOfDoc,
  docPageCount,
  docPending,
  getDocHash,
  type DocSummary,
  type LowWord,
  type TranscriptSource as StoreSource,
  type Store,
  isPageLocked,
  isDocLocked,
  setPageLock,
  setDocLock,
  lockedPageCount,
} from '../../src/core/store/transcriptStore';
import {type SearchHit} from '../../src/core/store/librarySearch';
import SearchControls from '../../SearchControls';
import ActivityBanner from '../../src/ui/ActivityBanner';
import {setActivity} from '../../src/native/activity';
import {mdToPlain} from '../../src/core/text/markdown';
import {wordOffsets, replaceAtOffset, lowAfterFix} from '../../src/core/text/wordFix';
import {
  resolveAutoTarget,
  modeLabel,
  DEFAULT_MODE,
  type AutoTarget,
  type AutoMode,
} from '../../src/core/store/autoEngine';
import {
  getLastSyncAt,
  getLastHostKind,
  isPdfVisionBlocked,
  pokeAuto,
  getLastManualSyncAt,
  markManualSync,
  resolveTrackedNotes,
  autoTranscriptTick,
  recordOwed} from '../../src/native/autoTranscript';
import {sleepHybrid} from '../../src/native/nativeSleep';
import {pipelineFromStoreSplit} from '../../src/native/pipelineStats';
import type {PipelineStages, TrackedTotal} from '../../src/core/store/pipeline';
import {readSettings, updateSettings} from '../../src/native/settings';
import {
  loadStore,
  exportLibraryFull,
  importLibrary,
  clearDocsTranscripts,
  mutateStore,
  flushStore,
  subscribeStore,
  canPersistDoc,
  isDegradedLoad,
  STORAGE_UNAVAILABLE_MSG,
} from '../../src/native/transcriptStoreIo';
import {type Agent, isUnderDocRef} from '../../src/core/agents/agents';
import {computeSyncFrame} from './syncFrameModel';
import SearchHitsList from './SearchHitsList';
import AddToPicker, {
  InlineMenu,
  type AddTarget,
  type PickerAgent,
} from '../../src/ui/AddToPicker';
import {
  addPagesToChat,
  addPagesToAgent,
  addDocRefToAgent,
  removeFromAgent,
  type CtxRef,
} from '../../src/native/contextActions';
import {
  isNotePath,
  pageStamp,
  pagesNeedingRead,
  readNotePages,
  readPdf,
  readPdfPageVision,
  renderDocPageWithMarks,
  getMarkPagesList,
  syncNotePages,
  upsertTranscript,
  finishVisionLive,
  pendingVisionPages,
  pdfPrintedCovered,
} from '../../src/native/reading';
import {
  readStoredPageText,
  invalidateNoteCache,
  readNotePageRevs,
  readFileSize,
} from '../../src/native/noteTranscripts';

// C4 runs once per plugin session, not once per Library visit (module
// scope survives the screen's unmount — v0.47).
const c4DoneOnce = {done: false};
import {captureBridge} from '../../src/native/captureBridge';
import {capturePageImage, setUiDocOpen} from '../../src/native/capture';
import {listDirNative, listStorageVolumesNative} from '../../src/native/fs';
import {
  countExportGaps,
  runExport,
  type ExportFormat,
} from '../../src/native/exporter';
import {
  eurosTotal,
  FULL_PAGE_READ_CENTS,
  READ_COST_CENTS,
} from '../../src/core/model/reader';
import {
  assembleVisionPrompt,
  assemblePdfVisionPrompt,
} from '../../src/core/model/visionPrompt';
import {makeTheme} from '../../src/ui/theme';
import {useArmedConfirm} from '../../src/ui/useArmedConfirm';
import type {KeyState, SubHeaderFn} from '../../App';
import PageGrid from './PageGrid';
import PageView from './PageView';

const {SmartNoteAiOverlay} = NativeModules;

// EXPORT (v0.40): one export request = groups of docs (a group shares the
// baseDir whose tree is mirrored under /EXPORT; null = flat single file).
type ExportReq = {
  groups: Array<{paths: string[]; baseDir: string | null}>;
  fmt: 'md' | 'txt'; // one format per run (user decision: two buttons)
  label: string;
  selection?: number[]; // single-doc partial export (0-indexed pages)
  offSkipped: number; // Off files filtered out (never sent to the AI)
};
type ExportAskState = ExportReq & {
  notePages: number; // missing .note pages
  pdfDocs: number; // PDFs never read
  canRead: boolean; // API key present
};

// Roots of the whole-Supernote browser (v0.30 Block 3): handwriting notes
// and imported documents. Folders are listed lazily on expand.
// e-ink touch comfort: extend the tap area of rows and small chips
// (device feedback 2026-07-18: rows and chips were hard to hit).
const rowSlop = {top: 6, bottom: 6, left: 0, right: 0};
const chipSlop = {top: 8, bottom: 8, left: 4, right: 4};

const TREE_ROOTS: Array<{path: string; name: string}> = [
  {path: '/storage/emulated/0/Note', name: 'Note'},
  {path: '/storage/emulated/0/Document', name: 'Document'},
];

// v0.51 (user requests 2026-07-18) — module scope so it all SURVIVES
// Library visits (the v0.46 split made these component state: every entry
// restarted the count sweep from zero, and only EXPANDED folders were
// covered — Off notes in collapsed folders never showed a count):
// - pageCountCache/countAttempted: session-persistent count knowledge.
// - fullWalk: a once-per-session recursive walk of ALL roots feeding the
//   sweep with every .note/.pdf, collapsed folders included.
// - rootsCache: discovered roots, incl. any SD card — GENERIC, nothing
//   hardcoded: a mounted external volume appears under /storage in the
//   app's runtime view (emulated/self are the internal views), whatever
//   the card, whatever the device.
const pageCountCache: Record<string, number> = {};
const countAttempted = new Set<string>();
const fullWalk = {done: false, running: false, files: [] as string[]};
const rootsCache: {list: Array<{path: string; name: string}> | null} = {
  list: null,
};

const ensureFullWalk = async (
  roots: Array<{path: string; name: string}>,
  isAlive: () => boolean,
): Promise<void> => {
  if (fullWalk.done || fullWalk.running) {
    return;
  }
  fullWalk.running = true;
  try {
    const seen = new Set(fullWalk.files);
    const stack = roots.map(r => r.path);
    while (stack.length > 0) {
      if (!isAlive()) {
        return; // interrupted — resumes (done stays false) next visit
      }
      const d = stack.pop() as string;
      for (const e of await listDirNative(d)) {
        if (e.isDir) {
          stack.push(`${d}/${e.name}`);
        } else if (/\.(note|pdf)$/i.test(e.name)) {
          const p = `${d}/${e.name}`;
          if (!seen.has(p)) {
            seen.add(p);
            fullWalk.files.push(p);
          }
        }
      }
      // Breathe: listDir is cheap but the bridge is shared.
      await new Promise<void>(r => setTimeout(r, 50));
    }
    fullWalk.done = true;
  } finally {
    fullWalk.running = false;
  }
};

export interface LibraryScreenProps {
  keyState: KeyState;
  promptBlocks: Record<string, string>;
  autoTargets: Record<string, AutoTarget>;
  setAutoTargets: React.Dispatch<
    React.SetStateAction<Record<string, AutoTarget>>
  >;
  lib: DocSummary[];
  // v0.75: configured agents, so the Library can add folders/notes/pages
  // to an agent's context or to the live CHAT (spec §4a/§4b).
  agents: Agent[];
  refreshLib: () => Promise<void>;
  msg: string;
  setMsg: (m: string) => void;
  scale: number;
  btnScale: number;
  // Armed-confirm "Clear all" stays in App (single shared instance).
  clearAll: () => void;
  confirmClear: string | null;
  subHeader: SubHeaderFn;
  goHome: () => void;
  // v0.85 (menu deep-link): open this doc (and page) on mount, then clear.
  openTarget?: {doc: string; page: number | null} | null;
  // v0.88 (audit): flush App's debounced settings save before any
  // closePluginView — a mode-chip change made <500 ms before "Go to page"
  // rode a timer RN froze at close and could be lost on a JS restart.
  flushSettings?: () => Promise<unknown>;
  clearOpenTarget?: () => void;
}

function LibraryScreen({
  keyState,
  promptBlocks,
  autoTargets,
  setAutoTargets,
  lib,
  agents,
  refreshLib,
  msg,
  setMsg,
  scale,
  btnScale,
  clearAll,
  confirmClear,
  subHeader,
  goHome,
  openTarget,
  flushSettings,
  clearOpenTarget,
}: LibraryScreenProps): React.JSX.Element {
  // v0.80.0 (audit): the text/button-size settings finally apply to the
  // Library — the screen with the most, smallest controls.
  const styles = useMemo(
    () => ({...makeTheme(scale, btnScale), ...local}),
    [scale, btnScale],
  );
  // Latest lib without an identity dep (perf audit 2026-07-20): effects
  // that only need "which paths have a page count" read the ref and key
  // on libCountSig, so the 600 ms store-churn refresh (same paths, new
  // array) no longer restarts them.
  const libRef = useRef(lib);
  libRef.current = lib;
  const libCountSig = useMemo(
    () =>
      lib
        .filter(d => d.total > 0)
        .map(d => d.path)
        .sort()
        .join('\n'),
    [lib],
  );

  // Which sync is running ('now' = live Sync now, 'auto' = Force sync,
  // null = idle). Separate so the busy label lands on the RIGHT button.
  // (v0.80.0: the 'batch' member died with batch mode.)
  const [syncKind, setSyncKind] = useState<'now' | 'auto' | null>(null);
  const syncBusy = syncKind !== null;
  // Name of the note currently being read by a Sync (for the live status).
  const [syncingNote, setSyncingNote] = useState<string | null>(null);
  // Whole-Supernote lazy tree browser (Block 3): listDir results per folder
  // (cheap, no page counts) + which folders are expanded.
  const [treeCache, setTreeCache] = useState<
    Record<string, Array<{name: string; isDir: boolean}>>
  >({});
  // fix #5: a ref mirror so toggleExpand can skip the native dir listing
  // when a folder's children are already cached (a re-expand is instant).
  const treeCacheRef = useRef(treeCache);
  useEffect(() => {
    treeCacheRef.current = treeCache;
  }, [treeCache]);
  const [treeExpanded, setTreeExpanded] = useState<Set<string>>(new Set());
  const treeExpandedRef = useRef(treeExpanded);
  useEffect(() => {
    treeExpandedRef.current = treeExpanded;
  }, [treeExpanded]);
  // v0.63 (user): filter the tree to files whose EFFECTIVE mode matches;
  // tap the active chip again to clear.
  // fix #6: multi-select sync-mode filter (empty = show all).
  const [modeShow, setModeShow] = useState<Set<'auto' | 'manual' | 'off'>>(
    new Set(),
  );
  // fix #7: filter the tree to one agent's context (id, or null = off).
  const [agentShow, setAgentShow] = useState<string | null>(null);
  // Local page counts for files the STORE doesn't know yet (never synced) —
  // filled in the background via the free getNoteTotalPageNum SDK call
  // (user requirement 2026-07-18: show every file's page count, whatever
  // its mode).
  const [pageCounts, setPageCounts] = useState<Record<string, number>>(
    () => ({...pageCountCache}),
  );
  const [treeRoots, setTreeRoots] = useState<
    Array<{path: string; name: string}>
  >(rootsCache.list ?? TREE_ROOTS);
  const treeSeededRef = useRef<boolean>(false);
  const [browseDoc, setBrowseDoc] = useState<string | null>(null);
  // v0.75: transient confirmation after an "Add to CHAT/Agent" (§4). No
  // colour on e-ink — a one-line banner cleared after a moment.
  const [ctxFlash, setCtxFlash] = useState<string>('');
  const ctxFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showCtxFlash = useCallback((m: string): void => {
    setCtxFlash(m);
    if (ctxFlashTimer.current !== null) {
      clearTimeout(ctxFlashTimer.current);
    }
    ctxFlashTimer.current = setTimeout(() => setCtxFlash(''), 2800);
  }, []);
  // fix #4/#7: a LIVE copy of the agents (the App prop is stale after a
  // Library-side add/remove writes to disk). Seeded from the prop, refreshed
  // from settings after every context mutation so the agent filter and the
  // Remove buttons stay accurate.
  const [agentsView, setAgentsView] = useState<Agent[]>(agents);
  useEffect(() => setAgentsView(agents), [agents]);
  const refreshAgentsView = useCallback((): void => {
    readSettings()
      .then(s => setAgentsView(s.agents ?? []))
      .catch(() => {});
  }, []);
  const pickerAgents = useMemo<PickerAgent[]>(
    () => agentsView.map(a => ({id: a.id, icon: a.icon, name: a.name})),
    [agentsView],
  );
  // Add a folder, a whole doc, or a set of pages to a target (CHAT queued
  // via the handoff seed §3b; agent stored via contextActions §4). For CHAT
  // a folder/whole-doc is expanded to its transcribed pages.
  const onAddContext = useCallback(
    async (
      target: AddTarget,
      opts: {folder?: string; docPath?: string; pages?: number[]},
    ): Promise<void> => {
      const {folder, docPath, pages} = opts;
      if (target.kind === 'agent') {
        let ok = false;
        if (folder !== undefined) {
          ok = await addDocRefToAgent(target.id, folder);
        } else if (docPath !== undefined && pages !== undefined) {
          ok = await addPagesToAgent(
            target.id,
            pages.map(p => ({path: docPath, page: p})),
          );
        } else if (docPath !== undefined) {
          ok = await addDocRefToAgent(target.id, docPath);
        }
        const a = agentsView.find(x => x.id === target.id);
        if (ok) {
          refreshAgentsView();
        }
        showCtxFlash(
          ok
            ? `✓ added to ${a?.icon ?? ''} ${a?.name ?? 'agent'}`
            : '⚠ could not add (agent gone?)',
        );
        return;
      }
      // CHAT: build page refs (folder / whole doc → its transcribed pages).
      let refs: CtxRef[] = [];
      if (docPath !== undefined && pages !== undefined) {
        refs = pages.map(p => ({path: docPath, page: p}));
      } else {
        const store = await loadStore();
        const paths =
          folder !== undefined
            ? Object.keys(store.docs).filter(
                p => p === folder || p.startsWith(`${folder}/`),
              )
            : docPath !== undefined
            ? [docPath]
            : [];
        for (const p of paths) {
          for (const [k, e] of Object.entries(store.docs[p]?.pages ?? {})) {
            if (e.text.trim().length > 0) {
              refs.push({path: p, page: Number(k)});
            }
          }
        }
      }
      addPagesToChat(refs);
      showCtxFlash(
        refs.length > 0
          ? `✓ ${refs.length} page(s) queued for CHAT: open ⌾ to use`
          : 'Nothing to add (no transcript yet)',
      );
    },
    [agentsView, showCtxFlash, refreshAgentsView],
  );
  // fix #7: remove an entry (whole doc/folder ref, or a page-set) from the
  // agent currently being filtered, straight from the Library.
  // v0.80.0 (audit): ONE armed-confirm hook (keyed) replaces the three
  // hand-rolled state+setTimeout copies this screen had accumulated —
  // same 4 s auto-disarm everywhere (badges included).
  const {armed: libArmed, confirm: libConfirm, disarm: libDisarm} =
    useArmedConfirm(4000);
  // #6 (user 2026-07-25): a row shows the icon of every agent it belongs to,
  // at the end of the row; tapping an icon asks to remove it from THAT agent
  // (tap-again to confirm, the same pattern as Clear all / Restore).
  const doRemoveFromAgentId = useCallback(
    async (agentId: string, ref: string, kind: 'doc' | 'pages'): Promise<void> => {
      const ok = await removeFromAgent(agentId, ref, kind);
      if (ok) {
        refreshAgentsView();
      }
      showCtxFlash(ok ? '✓ removed from agent' : '⚠ could not remove');
    },
    [refreshAgentsView, showCtxFlash],
  );
  // v0.63.2: while a document is open here, the background wave-2
  // catch-up defers its renders (same idea as the sweep pause).
  useEffect(() => {
    setUiDocOpen(browseDoc !== null);
    return () => setUiDocOpen(false);
  }, [browseDoc]);
  const [browsePage, setBrowsePage] = useState<number | null>(null);
  const [browsePages, setBrowsePages] = useState<
    Array<{page: number; snippet: string; src: StoreSource | null}>
  >([]);
  const [pageView, setPageView] = useState<{
    text: string;
    label: string;
    low?: LowWord[];
    // v0.63.4 (user test): 'user' entry whose page ink changed AFTER the
    // correction — stale fix, surfaced instead of silent (the contract
    // stays: never auto-overwritten).
    staleFix?: boolean;
  } | null>(null);
  const [pageEditing, setPageEditing] = useState<boolean>(false);
  const [pageDraft, setPageDraft] = useState<string>('');
  const [pageBusy, setPageBusy] = useState<boolean>(false);
  // Tap-to-correct a single low-confidence word (v0.24): {orig, draft}.
  const [wordFix, setWordFix] = useState<{
    orig: string;
    draft: string;
    nth: number;
  } | null>(
    null,
  );
  // Library search (v0.25; advanced multi-criteria v0.25.9) + the
  // handwritten-page image in the page view. `searchActive` = a query is in
  // progress (base ≥2 chars or ≥1 advanced criterion) → show results, not
  // the folder browser.
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchActive, setSearchActive] = useState<boolean>(false);
  const [pageImg, setPageImg] = useState<string | null>(null);
  // v0.60.1: renders are HOST-BOUND (generateNotePng needs the NOTE app,
  // generateDocImage the DOC reader — device-verified 2026-07-19, the
  // checkAPIAvailable rejection is instant). When both attempts fail,
  // say so instead of an eternal "…".
  const [pageImgFail, setPageImgFail] = useState<boolean>(false);
  // The page's NATIVE Supernote real-time-recognition OCR (read fresh from
  // the .note), shown beside the handwritten image for comparison (v0.26.4).
  const [nativeOcr, setNativeOcr] = useState<string | null>(null);
  // EXPORT (v0.40): grid page-selection mode + the "read first?" dialog.
  const [exportSel, setExportSel] = useState<Set<number> | null>(null);
  const [exportAsk, setExportAsk] = useState<ExportAskState | null>(null);
  const [exporting, setExporting] = useState<boolean>(false);
  // v0.79.12 (user): the transcript-library backup moved here from config
  // page 1 — the "saved" feedback already lives on this page.
  const onBackupLibrary = useCallback(async () => {
    libDisarm();
    // v0.95: file-by-file copy (exact fidelity, no giant JSON string).
    const r = await exportLibraryFull();
    setMsg(
      r.ok
        ? `Library backed up: ${r.docs} doc(s)` +
            (r.failed > 0 ? `, ${r.failed} FAILED (retry!)` : '') +
            ' → MyStyle/smartnoteai-library-backup/.'
        : `Library backup failed: ${r.error}.`,
    );
  }, [libDisarm, setMsg]);
  const onRestoreLibrary = useCallback(async () => {
    if (!libConfirm('libImport')) {
      return;
    }
    const r = await importLibrary();
    await refreshLib().catch(() => {});
    setMsg(
      r.ok
        ? `Library restored (${r.docs} doc(s) merged in` +
            (r.unreadableDocs > 0
              ? `; ⚠ ${r.unreadableDocs} doc(s) UNREADABLE in the backup`
              : '') +
            (r.skippedPages > 0
              ? `; ${r.skippedPages} page(s) skipped — placement unverifiable`
              : '') +
            ').'
        : `Library restore failed: ${r.error}.`,
    );
  }, [libConfirm, refreshLib, setMsg]);
  // #4 (user 2026-07-25): clear the local transcript of every note currently
  // set to Off — you turned it Off for privacy, so drop what's stored too.
  // Tap-again confirm (Off files are never re-read, so this is deliberate).
  const onClearOffTranscripts = useCallback(async () => {
    const offPaths = lib
      .filter(d => (resolveAutoTarget(autoTargets, d.path)?.mode ?? null) === 'off')
      .map(d => d.path);
    if (offPaths.length === 0) {
      libDisarm();
      setMsg('No Off note has a local transcript to clear.');
      return;
    }
    if (!libConfirm('clearOff')) {
      return;
    }
    const r = await clearDocsTranscripts(offPaths);
    await refreshLib().catch(() => {});
    const kept =
      r.skippedLockedDocs > 0 || r.keptLockedPages > 0
        ? ` 🔒 Kept: ${r.skippedLockedDocs} locked doc(s), ${r.keptLockedPages} locked page(s).`
        : '';
    setMsg(`Cleared the local transcript of ${r.docs} Off note(s).${kept}`);
  }, [libConfirm, libDisarm, lib, autoTargets, refreshLib, setMsg]);
  const [finishingVision, setFinishingVision] = useState<boolean>(false);
  // Which type's "Vision now" is running (so the label lands on the right bar).
  const [finishVisionKind, setFinishVisionKind] = useState<'note' | 'pdf' | null>(
    null,
  );
  // SYNC STATUS pipeline: the stage partition, computed async from the store
  // (per-page source), refreshed on lib change. v0.86: split by type — notes
  // and PDFs render under DIFFERENT hosts, so each gets its own bar + details.
  const [pipe, setPipe] = useState<{
    notes: PipelineStages;
    pdfs: PipelineStages;
  } | null>(null);
  const [pipeDetailsNotes, setPipeDetailsNotes] = useState<boolean>(false);
  const [pipeDetailsPdf, setPipeDetailsPdf] = useState<boolean>(false);
  // The SYNC STATUS bars duplicate the frame's aggregate pending; hidden by
  // default behind one toggle (status-line rationalisation 2026-08-14).
  const [pipeStatusOpen, setPipeStatusOpen] = useState<boolean>(false);

  // v0.78.7: turn a raw HTTP failure reason into a plain-language line so a
  // stalled sync says WHY instead of looking dead. Returns null when the
  // reason is not one of the two "your account" walls.
  const accountWallMsg = useCallback((reason?: string): string | null => {
    if (reason === undefined) {
      return null;
    }
    if (/\b401\b|unauthorized|key rejected/i.test(reason)) {
      return '⚠️ Mistral rejected the key (401). Free monthly limit reached, or the key is invalid/revoked. Check it on console.mistral.ai, or switch to billing.';
    }
    if (/\b402\b|enable billing|access to this service/i.test(reason)) {
      return '⚠️ The free Mistral API does not allow Batch (402). Use “Transcribe LIVE (free)”, or enable billing.';
    }
    if (/\b429\b|rate limit/i.test(reason)) {
      return 'Rate limit (429). On the FREE tier this is usually the monthly cap (~1300 pages); for a big backlog you need a pay-as-you-go plan on console.mistral.ai. Otherwise it is a per-second limit: give it a minute and retry.';
    }
    return null;
  }, []);

  // "Finish vision" (v0.68): force the vision stage NOW for every page
  // still at OCR — the decoupled drain, on demand, instead of waiting for
  // the 15-min cadence. Renders happen natively; the activity banner
  // shows progress and can Stop it.
  // Re-read every OCR-only page (a page whose live vision once failed —
  // 429/network — and kept its OCR text) through the LIVE engine again:
  // OCR 4 → Vision, storing 'medium'. On demand, instead of waiting for the
  // Auto cadence. Renders are native; the activity banner shows progress.
  const finishVisionNow = useCallback(async (kind: 'note' | 'pdf') => {
    if (finishingVision || keyState.kind !== 'ok') {
      if (keyState.kind !== 'ok') {
        setMsg('Add a Mistral API key first.');
      }
      return;
    }
    if (isDegradedLoad()) {
      // Round 10 #0: a whole drain paid into a session that persists
      // nothing would be money thrown away wholesale.
      setMsg('⚠ Storage is degraded this session — restart the plugin before syncing.');
      return;
    }
    // v0.87.2 (user): renders are host-bound, and we KNOW the host — don't
    // launch a pass that has no chance (a 3742-page doomed run flooded the
    // logs). The breaker in the read layer stays as the mid-pass safety net.
    try {
      const raw = (await captureBridge()
        .getCurrentFilePath()
        .catch(() => null)) as string | {result?: unknown} | null;
      const p = typeof raw === 'string' ? raw : (raw?.result as string);
      const host =
        typeof p === 'string' && /\.pdf$/i.test(p)
          ? 'pdf'
          : typeof p === 'string' && /\.note$/i.test(p)
          ? 'note'
          : null;
      if (host !== kind) {
        setMsg(
          kind === 'pdf'
            ? 'Open a PDF in the reader first: Vision renders there. It also runs by itself once one is open.'
            : 'Open a note first: Vision renders there. It also runs by itself once one is open.',
        );
        return;
      }
    } catch {
      // host unknown → let the pass try; the render breaker bounds the cost
    }
    setFinishingVision(true);
    setFinishVisionKind(kind);
    // Progress rides the single activity banner (with its Stop); msg keeps
    // only the terminal result (status-line rationalisation 2026-08-14).
    setActivity({label: kind === 'pdf' ? 'Vision (PDF pages)' : 'Vision (note pages)'});
    try {
      const r = await finishVisionLive(
        captureBridge(),
        keyState.config.apiKey,
        assembleVisionPrompt(promptBlocks),
        {
          kind,
          // User-initiated tap with the matching host verified open —
          // missing-page repair allowed (fix-audit round 3, 2026-08-16).
          attendedHint: true,
          onProgress: (d, t) =>
            setActivity({label: 'Vision', done: d, total: t}),
        },
      );
      await refreshLib().catch(() => {});
      const wall = accountWallMsg(r.reason);
      setMsg(
        r.read > 0
          ? `Vision done for ${r.read} page(s)` +
            (r.pending > 0
              ? `; ${r.pending} still pending${
                  wall
                    ? `: ${wall}`
                    : r.reason
                    ? `: ${r.reason}`
                    : ' (retries by itself at the next sync).'
                }`
              : '.')
          : wall
          ? wall
          : r.pending > 0
          ? // Surface the REAL Mistral reason instead of a vague "tap again":
            // logcat is drowned by the SDK's verifyParams spam, so the message
            // is the only reliable place to see why every page failed.
            `${r.pending} page(s) could not be read${
              r.reason ? `: ${r.reason}` : ', tap again in a minute'
            }.`
          : 'No OCR-only pages awaiting vision.',
      );
    } catch (e) {
      setMsg(`Vision failed: ${String((e as Error).message ?? e)}`);
    } finally {
      setActivity(null); // banner clears itself
      setFinishingVision(false);
      setFinishVisionKind(null);
    }
  }, [finishingVision, keyState, promptBlocks, refreshLib, setMsg]);

  // Refresh the doc list on entering the Library (was screen-gated in
  // App; App still keeps `lib` fresh via its debounced store subscription
  // while any config screen is up).
  useEffect(() => {
    refreshLib().catch(() => {});
  }, [refreshLib]);

  /* ---------- LIBRARY: auto-transcript tracking (v0.23) ---------- */

  // "Sync now": live-read the MANUAL targets' pending pages at full price.
  // Manual only (design 2026-07-18): Auto catches up at its own background
  // tick — its last-check time is shown in the frame's left column.
  const syncAutoNow = useCallback(async () => {
    if (syncBusy) {
      return;
    }
    setSyncKind('now');
    // No progress msg: the button shows "Syncing…" and the tick drives the
    // activity banner — msg keeps only the result (rationalisation 2026-08-14).
    try {
      // v0.88 (audit): arriving on the Library pokes a background tick, so
      // the button often landed on "a sync is already running" and the
      // user's explicit paid intent was silently dropped. Wait for the
      // running pass (bounded) and run the manual pass right after.
      let r = await autoTranscriptTick(captureBridge(), {
        force: true,
        trigger: 'sync',
        modeFilter: 'manual',
        onProgress: name => setSyncingNote(name),
      });
      for (let i = 0; i < 60 && !r.ran && /already running/i.test(r.reason ?? ''); i++) {
        // The running pass already owns the activity banner; just wait.
        await sleepHybrid(2_000);
        r = await autoTranscriptTick(captureBridge(), {
          force: true,
          trigger: 'sync',
          modeFilter: 'manual',
          onProgress: name => setSyncingNote(name),
        });
      }
      if (r.ran) {
        markManualSync(); // stamped only when the pass actually executed
      }
      await refreshLib().catch(() => {});
      const syncWall = accountWallMsg(r.reason);
      setMsg(
        r.ran
          ? r.pagesRead > 0
            ? `Synced: ${r.pagesRead} page(s) read.` +
              (syncWall ? ` (${r.pagesRead} done before: ${syncWall})` : '')
            : syncWall
            ? syncWall
            : 'Synced: 0 page(s) (nothing new).'
          : `Nothing to sync${r.reason ? ` (${r.reason})` : ''}.`,
      );
    } catch (e) {
      setMsg(`Sync failed: ${String((e as Error).message ?? e)}`);
    } finally {
      setSyncingNote(null);
      setSyncKind(null);
    }
  }, [syncBusy, refreshLib, setMsg]);

  // "Force sync now" (AUTO column, v0.63 — user request): run the tick
  // immediately for the AUTO targets. force passes the 20-s gap; the
  // unchanged-note stamp skip still applies, so it is free on a quiet
  // library and only reads the real backlog.
  const forceSyncAuto = useCallback(async () => {
    if (syncBusy) {
      return;
    }
    setSyncKind('auto');
    // Button shows "Syncing…", tick drives the banner — msg keeps the result.
    try {
      let r = await autoTranscriptTick(captureBridge(), {
        force: true,
        trigger: 'sync',
        modeFilter: 'auto',
        onProgress: name => setSyncingNote(name),
      });
      for (let i = 0; i < 60 && !r.ran && /already running/i.test(r.reason ?? ''); i++) {
        // The running pass already owns the activity banner; just wait.
        await sleepHybrid(2_000);
        r = await autoTranscriptTick(captureBridge(), {
          force: true,
          trigger: 'sync',
          modeFilter: 'auto',
          onProgress: name => setSyncingNote(name),
        });
      }
      await refreshLib().catch(() => {});
      const cap = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
      setMsg(
        r.ran
          ? r.pagesRead > 0
            ? `Auto sync: ${r.pagesRead} page(s) read.`
            : r.reason
            ? cap(r.reason)
            : 'Auto sync: nothing new to read.'
          : r.reason
          ? cap(r.reason)
          : 'Nothing to sync: all Auto pages are read.',
      );
    } catch (e) {
      setMsg(`Auto sync failed: ${String((e as Error).message ?? e)}`);
    } finally {
      setSyncingNote(null);
      setSyncKind(null);
    }
  }, [syncBusy, refreshLib, setMsg]);


  // Tree browser: list a folder's children (dirs + .note/.pdf), cached.
  const listFolder = useCallback(async (path: string) => {
    const entries = await listDirNative(path);
    const kids = entries
      .filter(e => e.isDir || /\.(note|pdf)$/i.test(e.name))
      .map(e => ({name: e.name, isDir: e.isDir}));
    setTreeCache(c => ({...c, [path]: kids}));
    return kids;
  }, []);

  // The tree is a CACHE of native directory listings: listFolder fills a
  // folder once and toggleExpand deliberately reuses it (a re-expand must
  // feel instant). Nothing ever invalidated it — and PluginHost keeps this
  // screen MOUNTED across close/open, so a file renamed on the device while
  // we were hidden kept showing its OLD name, and "Go to page" on that row
  // opened a path that no longer exists (device report 2026-08-10).
  // Re-reading only the folders the user actually has open keeps it cheap.
  const refreshOpenFolders = useCallback(async (): Promise<void> => {
    // The once-per-session full walk is a flat list of every file found; a
    // renamed file is absent from it and its old name lingers, so the count
    // sweep must be allowed to walk again too.
    fullWalk.done = false;
    fullWalk.files.length = 0;
    for (const p of [...treeExpandedRef.current]) {
      await listFolder(p);
    }
  }, [listFolder]);

  // "The plugin view came back to the foreground" — the one reliable signal
  // that the user may have been renaming/moving files behind our back (the
  // same reasoning as App's poke listener, which cannot see this cache).
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => {
      if (st === 'active') {
        refreshOpenFolders().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [refreshOpenFolders]);

  const toggleExpand = useCallback(
    (path: string) => {
      setTreeExpanded(s => {
        const n = new Set(s);
        if (n.has(path)) {
          n.delete(path);
        } else {
          n.add(path);
          // fix #5: only hit the (slow) native lister when uncached — a
          // re-expand reuses the cache and feels instant.
          if (treeCacheRef.current[path] === undefined) {
            listFolder(path);
          }
        }
        return n;
      });
    },
    [listFolder],
  );

  // Discover the roots once per session: the two fixed ones + any SD
  // card (generic — see rootsCache above).
  useEffect(() => {
    if (rootsCache.list !== null) {
      return;
    }
    (async () => {
      const roots = [...TREE_ROOTS];
      const found = new Set<string>();
      // Source 1 — the runtime /storage view (kept as belt & braces).
      for (const e of await listDirNative('/storage')) {
        if (e.isDir && e.name !== 'emulated' && e.name !== 'self') {
          found.add(`/storage/${e.name}`);
        }
      }
      // Source 2 (v0.52 plan B, device-verified: source 1 comes back
      // EMPTY from PluginHost) — the native module asks Android's
      // StorageManager / getExternalFilesDirs. Generic: any card.
      for (const p of await listStorageVolumesNative()) {
        found.add(p);
      }
      let sd = 0;
      for (const p of found) {
        sd++;
        roots.push({path: p, name: sd === 1 ? 'SD_Card' : `SD_Card ${sd}`});
      }
      rootsCache.list = roots;
      setTreeRoots(roots);
      console.log(
        '[SmartNoteAI.lib]',
        `roots: ${roots.map(r => r.name).join(', ')}`,
      );
    })();
  }, []);

  // List the roots when the Library opens (cheap listDir calls).
  useEffect(() => {
    for (const r of treeRoots) {
      listFolder(r.path);
    }
  }, [listFolder, treeRoots]);

  // Open the tree THREE levels deep on first visit (roots + their direct
  // subfolders — user request 2026-07-18); later collapses are respected.
  useEffect(() => {
    if (treeSeededRef.current) {
      return;
    }
    treeSeededRef.current = true;
    (async () => {
      // Level 2 only (user change of mind 2026-07-18: three levels was
      // too much): the ROOTS are expanded, their children visible but
      // collapsed.
      const open = new Set<string>();
      for (const r of treeRoots) {
        open.add(r.path);
      }
      for (const p of open) {
        listFolder(p);
      }
      setTreeExpanded(prev => new Set([...prev, ...open]));
    })();
  }, [listFolder, treeRoots]);

  // Background page-count fill for visible files the store doesn't cover.
  // Free (device SDK), sequential, deduped; results land in small batches
  // so the e-ink screen repaints a few times, not once per file.
  useEffect(() => {
    // PAUSED while a doc/page view is open: this sweep queues device SDK
    // calls, and on the Manta they starved generateNotePng — the page
    // detail's "Handwritten page" never rendered (device report
    // 2026-07-18). Opening a doc cancels the loop (cleanup); it resumes
    // on the tree.
    if (browseDoc !== null) {
      return;
    }
    let alive = true;
    const isAlive = () => alive;
    // Index of the first UNPROCESSED path — the cleanup below releases only
    // want.slice(processed) (audit 2026-07-18: releasing everything made
    // the pass restart from scratch on every `lib` identity change).
    let processed = 0;
    let want: string[] = [];
    // .note files whose query FAILED this pass (bridge saturated by a batch
    // submit…): released at the end so the next pass retries them. PDFs are
    // NOT released — no local page-count API, they'd fail on every pass.
    const failedNotes: string[] = [];
    (async () => {
      // v0.51: the sweep feeds on the once-per-session FULL walk of the
      // roots (collapsed folders included) UNION the visible tree — this is
      // what finally gives every Off note its page count.
      await ensureFullWalk(treeRoots, isAlive);
      if (!alive) {
        return;
      }
      const known = new Map(libRef.current.map(d => [d.path, d.total]));
      const candidates = new Set<string>(fullWalk.files);
      for (const [dir, kids] of Object.entries(treeCache)) {
        for (const k of kids) {
          if (!k.isDir) {
            candidates.add(`${dir}/${k.name}`);
          }
        }
      }
      for (const p of candidates) {
        if (
          (known.get(p) ?? 0) > 0 ||
          pageCountCache[p] !== undefined ||
          countAttempted.has(p)
        ) {
          continue;
        }
        countAttempted.add(p);
        want.push(p);
      }
      if (want.length === 0) {
        return;
      }
      const deps = captureBridge();
      let batch: Record<string, number> = {};
      const flush = () => {
        if (Object.keys(batch).length > 0) {
          const b = batch;
          batch = {};
          Object.assign(pageCountCache, b); // survives Library visits
          if (alive) {
            setPageCounts(prev => ({...prev, ...b}));
          }
        }
      };
      for (const p of want) {
        if (!alive) {
          return;
        }
        // Breathe between calls — the bridge and the note engine are shared
        // with everything the user is doing.
        await new Promise<void>(r => setTimeout(r, 150));
        if (!alive) {
          return;
        }
        try {
          const raw = await deps.getNoteTotalPageNum(p);
          const n =
            typeof raw === 'number'
              ? raw
              : ((raw as {result?: unknown})?.result as number);
          if (typeof n === 'number' && n > 0) {
            batch[p] = n;
          } else if (/\.note$/i.test(p)) {
            failedNotes.push(p); // empty/odd answer — retry next pass
          }
        } catch {
          // PDFs / unreadable files simply have no local count
          if (/\.note$/i.test(p)) {
            failedNotes.push(p);
          }
        }
        processed++;
        // 25-file flush batches (perf audit 2026-07-20, was 8): each
        // flush re-renders the whole screen; on e-ink fewer, bigger
        // repaints beat many small ones.
        if (Object.keys(batch).length >= 25) {
          flush();
        }
      }
      flush();
      for (const p of failedNotes) {
        countAttempted.delete(p);
      }
    })();
    return () => {
      alive = false;
      // Cancelled mid-sweep (a doc was opened, the tree changed): the
      // paths NOT yet attempted are put back in play for the next run —
      // and so are the notes that FAILED before the cancel (re-audit
      // 2026-07-19: the end-of-pass release never ran on a cancelled
      // pass, so a bridge-saturated note kept no page count for the
      // whole session).
      for (const p of want.slice(processed)) {
        countAttempted.delete(p);
      }
      for (const p of failedNotes) {
        countAttempted.delete(p);
      }
    };
    // libCountSig instead of lib (perf audit 2026-07-20): during store
    // churn the 600 ms lib refresh changes the array IDENTITY every time
    // — the sweep was cancelled and restarted over and over. Only the
    // set of paths that HAVE a count matters to the candidate list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseDoc, treeCache, libCountSig, treeRoots]);

  // Every .note/.pdf under a folder (recursive), tree order.
  const docsUnder = useCallback(async (dir: string): Promise<string[]> => {
    const out: string[] = [];
    const walk = async (d: string): Promise<void> => {
      for (const e of await listDirNative(d)) {
        const p = `${d}/${e.name}`;
        if (e.isDir) {
          await walk(p);
        } else if (/\.(note|pdf)$/i.test(e.name)) {
          out.push(p);
        }
      }
    };
    await walk(dir);
    return out;
  }, []);

  // LOCAL background scan when something becomes tracked: snapshot the
  // note's structure into the store (free, no Mistral) so "N to read"
  // appears immediately — the paid reads still wait for a Sync button or
  // Auto (user flow decision 2026-07-18).
  // Abortable (2026-08-03, user: cycling the Sync chip felt frozen): each
  // scan can walk whole .note files (seconds of bridge IO each), and every
  // tap used to start ANOTHER one — they stacked and starved the render.
  // A newer generation kills the in-flight loop between docs.
  const scanGen = useRef(0);
  const kickLocalScan = useCallback(
    (path: string) => {
      const gen = ++scanGen.current;
      (async () => {
        const isFile = /\.(note|pdf)$/i.test(path);
        const targets = isFile ? [path] : await docsUnder(path);
        const store = await loadStore();
        let walked = 0;
        for (const p of targets) {
          if (gen !== scanGen.current) {
            return; // superseded — stop hogging the JS thread
          }
          if (!isNotePath(p)) {
            continue; // a PDF has no local structure to scan
          }
          if (docPageCount(store, p) > 0) {
            continue; // already snapshotted — nothing to do
          }
          await syncNotePages(captureBridge(), p).catch(() => {});
          walked++;
          await new Promise<void>(r => setTimeout(r, 100));
        }
        if (walked > 0 && gen === scanGen.current) {
          refreshLib().catch(() => {});
        }
      })();
    },
    [docsUnder, refreshLib],
  );

  // "Check all notes for changes" (v0.45): forced FREE pass over every
  // Manual-tracked .note — footer revs + structural sync per doc, no Mistral
  // call — so the frame's "to sync" count reflects reality on demand instead
  // of waiting for the background tick's paced refresh.
  const [checkingAll, setCheckingAll] = useState<boolean>(false);
  // v0.52 (user request): the check's progress/result lives IN the sync
  // frame next to its button, not in the global msg line at the bottom.
  const [checkStatus, setCheckStatus] = useState<string>('');
  const [lastCheckAt, setLastCheckAt] = useState<number>(0);
  useEffect(() => {
    readSettings()
      .then(s => setLastCheckAt(s.lastCheckAllAt ?? 0))
      .catch(() => {});
  }, []);
  const checkAllChanges = useCallback(async () => {
    if (checkingAll) {
      return;
    }
    setCheckingAll(true);
    try {
      // "Check changes" is THE deep path: re-read the file tree from disk
      // first, so a file renamed or moved since the last visit is seen
      // under its real name before anything is counted (2026-08-10).
      setCheckStatus('Re-reading the file tree…');
      await refreshOpenFolders();
      const tracked = await resolveTrackedNotes(autoTargets);
      const notes = [...tracked.entries()]
        .filter(([p, t]) => t.mode === 'manual' && isNotePath(p))
        .map(([p]) => p);
      let done = 0;
      for (const p of notes) {
        // "Manual notes": the count differs from the banner's tracked
        // total on purpose — Auto notes self-check at their tick and
        // PDFs are covered by their docHash (user confusion 2026-07-18:
        // "c'est quoi ce 64 ?" under "73 notes tracked").
        setCheckStatus(`Checking Manual notes ${++done}/${notes.length}…`);
        // This button is THE deep path (v0.47): drop the cached walk and
        // force the structural sync, so a stuck note is always re-seen.
        // "Sync now" trusts the caches instead (it froze the plugin for
        // minutes re-walking everything — device report 2026-07-18).
        invalidateNoteCache(p);
        await syncNotePages(captureBridge(), p, true).catch(() => {});
        // v0.53: FREE stale count (footer revs vs stored entries) — an
        // in-place edit keeps its entry, so structure alone said "0 to
        // sync" (device report: edited page 4 of Bids topics invisible).
        try {
          const rawT = await captureBridge().getNoteTotalPageNum(p);
          const t =
            typeof rawT === 'number'
              ? rawT
              : ((rawT as {result?: unknown})?.result as number);
          if (typeof t === 'number' && t > 0) {
            const wantedN = Array.from({length: t}, (_, i) => i);
            // No precomputedRead: let recordOwed run pagesNeedingRead AND apply
            // the per-page failure-backoff filter (round-4 audit — a raw count
            // here included pageFails-parked pages that Sync-now never reads).
            await recordOwed(captureBridge(), p, wantedN);
          }
        } catch {
          // keep the previous count
        }
        await new Promise<void>(r => setTimeout(r, 100));
      }
      // v0.64 (user, label truth): Manual PDFs too — a PDF "changed"
      // when its byte length differs from the stored docHash, the same
      // signal every paid path compares. Free stat, no read.
      const pdfs = [...tracked.entries()]
        .filter(([p2, t2]) => t2.mode === 'manual' && !isNotePath(p2))
        .map(([p2]) => p2);
      // A changed Manual PDF (byte size ≠ stored docHash) is otherwise invisible
      // to the structural count (pdfCovered keys off docHash≠'', not the size),
      // so it showed "up to date" with Sync-now greyed and could never re-read
      // (round-5 audit). Flag it via owed.read = its page count; this SELF-CLEARS
      // when the PDF is re-read (readPdf's docHash stamp invalidates owed, even
      // if every page is lock-skipped — owed-lifecycle audit 2026-08-14).
      // NOTE: this gate keys on the PRINTED bytes only, on purpose. An
      // annotation-only change (.mark grows, PDF bytes unchanged) is NOT flagged
      // here — overloading owed.read=nPages for it created a permanent phantom
      // "N to sync" the Vision-only covered re-read could never clear. That
      // narrow gap (a lone annotated Manual PDF, Sync-now greyed) is pre-existing
      // and needs a dedicated "pending recheck" signal, not owed.read.
      for (const p2 of pdfs) {
        try {
          const size = await readFileSize(p2);
          const st = await loadStore();
          const doc = st.docs[p2];
          const h = getDocHash(st, p2);
          // Compare PRINTED bytes via pdfPrintedCovered, which strips the
          // pre-Phase-B legacy "bytes|m<size>" suffix exactly like every paid
          // PDF path. A raw `h !== String(size)` false-positived a covered
          // legacy-suffix PDF ("1000|m50" !== "1000") into an owed.read phantom
          // Sync-now could never clear (owed-lifecycle audit 2026-08-14).
          if (h.length > 0 && size !== null && size > 0 && !pdfPrintedCovered(doc, size)) {
            // Whole-doc paid re-read: EVERY page re-reads, so pass the full page
            // list as the read set — recordOwed then derives vision=0 (every page
            // is in the read set, nothing owes Vision separately). A bare count
            // here would leave vision uncomputed (round-7: it must be a LIST).
            const nPages = Math.max(1, docPageCount(st, p2));
            await recordOwed(
              captureBridge(),
              p2,
              [],
              Array.from({length: nPages}, (_, i) => i),
            );
          }
        } catch {
          // no size stat — leave the PDF as-is
        }
      }
      await refreshLib().catch(() => {});
      if (notes.length + pdfs.length > 0) {
        const now = Date.now();
        setLastCheckAt(now);
        // Direct field patch through the settings singleton (v0.58) —
        // serialized with every other writer, full state on disk.
        await updateSettings({lastCheckAllAt: now}).catch(() => {});
      }
      setCheckStatus('');
    } finally {
      setCheckingAll(false);
    }
  }, [checkingAll, autoTargets, refreshLib, refreshOpenFolders]);

  // Cycle a folder/note's sync MODE through ONE ordered list, so every state
  // is reachable with a single tap. (Old bug: a special-case "drop the
  // override when you reach the last mode" intercepted exactly where OFF
  // should appear, so an inherited folder could never be set Off.) With a
  // tracked ancestor the cycle is inherit → Off → Manual → Auto → inherit; at
  // the root it is Off → Manual → Auto → Off. CONFIG IS INERT: a chip only
  // saves the preference — no read is launched, so it never costs anything.
  // The structural scan fires once the cycling SETTLES (debounced), for the
  // final mode only — not once per tap while the user walks the cycle. The
  // Library is a foreground activity here, so the timer runs.
  const modeScanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoTargetsRef = useRef(autoTargets);
  useEffect(() => {
    autoTargetsRef.current = autoTargets;
  }, [autoTargets]);
  useEffect(
    () => () => {
      if (modeScanTimer.current !== null) {
        clearTimeout(modeScanTimer.current);
      }
    },
    [],
  );
  const cycleModeFor = useCallback(
    (path: string) => {
      scanGen.current++; // the mode is changing again — abort any running scan
      setAutoTargets(m => {
        const withoutOwn = {...m};
        delete withoutOwn[path];
        const hasAncestor = resolveAutoTarget(withoutOwn, path) !== null;
        const cycle: Array<AutoMode | 'inherit'> = hasAncestor
          ? ['inherit', 'off', 'manual', 'auto']
          : ['off', 'manual', 'auto'];
        const cur: AutoMode | 'inherit' =
          m[path] === undefined ? (hasAncestor ? 'inherit' : DEFAULT_MODE) : m[path].mode;
        const next = cycle[(cycle.indexOf(cur) + 1) % cycle.length];
        if (next === 'inherit') {
          return withoutOwn; // drop the override → follow the parent again
        }
        return {...m, [path]: {mode: next}};
      });
      if (modeScanTimer.current !== null) {
        clearTimeout(modeScanTimer.current);
      }
      modeScanTimer.current = setTimeout(() => {
        modeScanTimer.current = null;
        // Newly tracked → free structural scan so the counts show now.
        const mode = resolveAutoTarget(autoTargetsRef.current, path)?.mode;
        if (mode === 'manual' || mode === 'auto') {
          kickLocalScan(path);
        }
      }, 800);
    },
    [kickLocalScan, setAutoTargets],
  );

  // One chip per folder/note: Mode (Off / Manual / Auto). A path with no own
  // entry but covered by a tracked ancestor folder shows a dimmed inherited
  // "↳ Auto" (not editable here). Default (nothing tracked) shows Manual.
  // ---- v0.94 locks: per page, and per document -------------------------
  const [lockTick, setLockTick] = useState(0);
  const [lockedDocs, setLockedDocs] = useState<Set<string>>(new Set());
  const [lockState, setLockState] = useState({
    doc: false,
    page: false,
    pages: 0,
  });
  // Any store mutation refreshes the lock views (spec S7), COALESCED: a
  // 100-page drain mutates per page, and one full re-render per page stole
  // the JS thread from the paying loop (audit 9 #9). A trailing 400 ms
  // timer is fine here — frozen while backgrounded means the UI is not
  // visible, and it fires on thaw.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const un = subscribeStore(() => {
      if (t !== null) {
        return;
      }
      t = setTimeout(() => {
        t = null;
        setLockTick(x => x + 1);
      }, 400);
    });
    return () => {
      un();
      if (t !== null) {
        clearTimeout(t);
      }
    };
  }, []);
  useEffect(() => {
    let alive = true;
    (async () => {
      const all = await loadStore();
      if (alive) {
        setLockedDocs(
          new Set(
            Object.keys(all.docs).filter(pth => isDocLocked(all, pth)),
          ),
        );
      }
      if (browseDoc === null) {
        return;
      }
      const st = await loadStore();
      if (!alive) {
        return;
      }
      setLockState({
        doc: isDocLocked(st, browseDoc),
        page:
          browsePage !== null ? isPageLocked(st, browseDoc, browsePage) : false,
        pages: lockedPageCount(st, browseDoc),
      });
    })();
    return () => {
      alive = false;
    };
  }, [browseDoc, browsePage, lockTick]);
  const togglePageLock = useCallback(
    async (path: string, page: number) => {
      const st = await loadStore();
      const on = !isPageLocked(st, path, page);
      await mutateStore(st2 => setPageLock(st2 as Store, path, page, on));
      await flushStore();
      setLockTick(t => t + 1);
      setMsg(on ? '🔒 Page locked (no automatic re-read).' : '🔓 Page unlocked.');
    },
    [setMsg],
  );
  const toggleDocLock = useCallback(
    async (path: string) => {
      const st = await loadStore();
      const on = !isDocLocked(st, path);
      await mutateStore(st2 => setDocLock(st2 as Store, path, on));
      await flushStore();
      setLockTick(t => t + 1);
      refreshLib().catch(() => {});
      setMsg(
        on
          ? '🔒 Document locked — no page is re-read automatically.'
          : '🔓 Document unlocked.',
      );
    },
    [refreshLib, setMsg],
  );

  const renderAutoChips = useCallback(
    (path: string): React.JSX.Element => {
      const own = autoTargets[path];
      const eff = resolveAutoTarget(autoTargets, path);
      if (own === undefined && eff !== null) {
        // Inherited from a tracked ancestor folder. Tappable: the first tap
        // sets an explicit own mode (an override), starting from the
        // inherited value so it cycles predictably.
        return (
          <TouchableOpacity
            onPress={() => cycleModeFor(path)}
            hitSlop={chipSlop}
            style={[styles.aChip, styles.aChipInh]}>
            <Text style={styles.aChipInhText}>↳ Sync: {modeLabel(eff.mode)}</Text>
          </TouchableOpacity>
        );
      }
      const cur: AutoMode = own?.mode ?? DEFAULT_MODE;
      return (
        <TouchableOpacity
          onPress={() => cycleModeFor(path)}
          hitSlop={chipSlop}
          style={[styles.aChip, own && styles.aChipOn]}>
          <Text style={[styles.aChipText, own && styles.aChipOnText]}>
            Sync: {modeLabel(cur)}
          </Text>
        </TouchableOpacity>
      );
    },
    [autoTargets, cycleModeFor],
  );

  /* ---------- EXPORT (v0.40): store → /EXPORT .md files ---------- */

  // The export itself: store → .md files. ZERO Mistral calls in here.
  // v0.52 (user request): a visible ✓ on the export button that just
  // succeeded — the msg line alone went unnoticed. Key = label|fmt;
  // cleared after a few seconds.
  const [exportDone, setExportDone] = useState<string | null>(null);
  const exportDoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markExportDone = useCallback((key: string) => {
    setExportDone(key);
    if (exportDoneTimer.current !== null) {
      clearTimeout(exportDoneTimer.current);
    }
    exportDoneTimer.current = setTimeout(() => setExportDone(null), 6000);
  }, []);

  const doExport = useCallback(async (req: ExportReq) => {
    setExporting(true);
    try {
      let written = 0;
      let failed = 0;
      for (const g of req.groups) {
        const r = await runExport(captureBridge(), g.paths, {
          fmt: req.fmt,
          baseDir: g.baseDir,
          selection: req.selection,
          now: Date.now(),
          onProgress: (l, d, t) =>
            setActivity({label: `Exporting ${l}`, done: d, total: t}),
        });
        written += r.written.length;
        failed += r.failed.length;
      }
      setMsg(
        `⇪ ${written} document(s) exported to /EXPORT (.${req.fmt})` +
          (failed > 0 ? ` · ${failed} failed` : '') +
          (req.offSkipped > 0 ? ` · ${req.offSkipped} Off file(s) skipped` : ''),
      );
      if (written > 0 && failed === 0) {
        markExportDone(`${req.label}|${req.fmt}`);
      }
    } catch (e) {
      setMsg(`⚠ Export failed: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setActivity(null);
      setExporting(false);
    }
  }, [setMsg, markExportDone]);

  // Entry point for every Export button: filter Off files, count what is
  // missing, then export directly (complete) or ask (read first / partial).
  const startExport = useCallback(
    async (
      groups: Array<{paths: string[]; baseDir: string | null}>,
      fmt: ExportFormat,
      label: string,
      selection?: number[],
    ) => {
      if (exporting) {
        return;
      }
      setMsg('⇪ checking transcripts…');
      let offSkipped = 0;
      const resolved: Array<{paths: string[]; baseDir: string | null}> = [];
      for (const g of groups) {
        const paths = g.paths.filter(p => {
          const t = resolveAutoTarget(autoTargets, p);
          if (t !== null && t.mode === 'off') {
            offSkipped++;
            return false;
          }
          return true;
        });
        if (paths.length > 0) {
          resolved.push({paths, baseDir: g.baseDir});
        }
      }
      if (resolved.length === 0) {
        setMsg(
          'Nothing to export' +
            (offSkipped > 0 ? ` (${offSkipped} Off file(s) skipped)` : '') +
            '.',
        );
        return;
      }
      const req: ExportReq = {groups: resolved, fmt, label, selection, offSkipped};
      try {
        const all = resolved.flatMap(g => g.paths);
        const gaps = await countExportGaps(captureBridge(), all, selection);
        if (gaps.notePages === 0 && gaps.pdfDocs === 0) {
          await doExport(req);
          return;
        }
        setExportAsk({
          ...req,
          ...gaps,
          canRead: keyState.kind === 'ok',
        });
        setMsg('');
      } catch (e) {
        // Without this, a rejection left "⇪ checking transcripts…" for good.
        setMsg(`⚠ Export check failed: ${(e as Error)?.message ?? String(e)}`);
      }
    },
    [exporting, autoTargets, keyState, doExport, setMsg],
  );

  // "Read then export": fill the gaps at the regular price (same read
  // paths, same batch-pending guards as everywhere), then export.
  const readThenExport = useCallback(async () => {
    if (exportAsk === null || keyState.kind !== 'ok') {
      return;
    }
    const apiKey = keyState.config.apiKey;
    const req = exportAsk;
    setExportAsk(null);
    setExporting(true);
    try {
      const allPaths = req.groups.flatMap(g => g.paths);
      for (const [i, path] of allPaths.entries()) {
        setActivity({label: 'Reading for export', done: i + 1, total: allPaths.length});
        if (isNotePath(path)) {
          let range = req.selection;
          if (range === undefined) {
            let total = 0;
            try {
              const raw = await captureBridge().getNoteTotalPageNum(path);
              const n =
                typeof raw === 'number'
                  ? raw
                  : ((raw as {result?: unknown})?.result as number);
              total = typeof n === 'number' && n > 0 ? n : 0;
            } catch {
              // fall back to the store's view below
            }
            if (total === 0) {
              total = docPageCount(await loadStore(), path);
            }
            range = Array.from({length: total}, (_, k) => k);
          }
          const needed = await pagesNeedingRead(
            captureBridge(),
            path,
            range,
          ).catch(() => [] as number[]);
          if (needed.length > 0) {
            await readNotePages(
              captureBridge(),
              apiKey,
              assembleVisionPrompt(promptBlocks),
              path,
              needed,
            ).catch(() => {});
          }
        } else {
          if (docPageCount(await loadStore(), path) === 0) {
            await readPdf(
              captureBridge(),
              apiKey,
              assemblePdfVisionPrompt(promptBlocks),
              path,
              {attended: true}, // Library tap — user-initiated
            ).catch(() => {});
          }
        }
      }
      refreshLib().catch(() => {});
      setActivity(null); // doExport sets its own banner from here
      await doExport(req);
    } finally {
      setActivity(null);
      setExporting(false);
    }
  }, [exportAsk, keyState, promptBlocks, doExport, refreshLib]);

  // Folder / whole-library entry points (resolve the tree, then the
  // common startExport flow).
  const exportFolder = useCallback(
    async (dir: string, name: string, fmt: ExportFormat) => {
      const docs = await docsUnder(dir);
      await startExport([{paths: docs, baseDir: dir}], fmt, `${name}/`);
    },
    [docsUnder, startExport],
  );

  const exportAll = useCallback(
    async (fmt: ExportFormat) => {
      const groups: Array<{paths: string[]; baseDir: string | null}> = [];
      for (const r of treeRoots) {
        const docs = await docsUnder(r.path);
        if (docs.length > 0) {
          groups.push({paths: docs, baseDir: r.path});
        }
      }
      await startExport(groups, fmt, 'library');
    },
    [docsUnder, startExport, treeRoots],
  );

  /* ---------- LIBRARY: browse / edit / re-read one page ---------- */

  // Rebuild the page-tile list for a doc from the store (snippets + source).
  // Cheap: reads the store only, no note re-walk. Called by openDoc and when
  // returning from a page after an edit/re-read so the tile shows fresh text.
  const refreshBrowsePages = useCallback(async (path: string) => {
    const s = await loadStore();
    // Every KNOWN page (structural snapshot), read or not — unread pages
    // show a "not read yet" tile so the note's real shape is visible.
    const total = docPageCount(s, path);
    const withText = new Set(pagesOfDoc(s, path));
    const all = Array.from(
      new Set([...Array.from({length: total}, (_, i) => i), ...withText]),
    ).sort((a, b) => a - b);
    setBrowsePages(
      all.map(p => {
        const e = getPage(s, path, p);
        const hasText = e !== null && e.text.trim().length > 0;
        return {
          page: p,
          // Markdown stripped to plain text for the compact tile (v0.38.2).
          snippet: hasText ? mdToPlain(e.text).slice(0, 220) : '',
          // v0.88 (audit): a page READ and found blank keeps its source —
          // the tile says "(blank page)" instead of the misleading "not
          // read yet" (which invited paying to re-read it), and the counts
          // above finally agree with the sync frame.
          src: e !== null ? e.source : null,
        };
      }),
    );
  }, []);

  // #4 (user): clear ONE open document's transcript from its page grid.
  const onClearDocTranscript = useCallback(
    async (path: string) => {
      const r = await clearDocsTranscripts([path]);
      await refreshBrowsePages(path).catch(() => {});
      await refreshLib().catch(() => {});
      setMsg(
        r.skippedLockedDocs > 0
          ? '🔒 This document is locked — Clear refused. Unlock it first.'
          : r.docs > 0
          ? r.keptLockedPages > 0
            ? `Transcript cleared — ${r.keptLockedPages} locked page(s) kept.`
            : 'Transcript cleared for this document.'
          : r.keptLockedPages > 0
          ? '🔒 Every stored page is locked — nothing cleared.'
          : 'Nothing to clear: no transcript stored.',
      );
    },
    [refreshBrowsePages, refreshLib, setMsg],
  );

  const openDoc = useCallback(
    async (path: string) => {
      // Page list INSTANTLY from the store (v0.63.3 — user report:
      // "Transcript" sat 15-20 s on nothing): the structural realignment
      // walk (page moves/deletes/inserts, device bug 2026-07-12) now
      // runs in the BACKGROUND and refreshes the grid when done.
      // Money-safe: the paid paths re-run syncPageIds themselves at
      // read time (v0.42), so a stale DISPLAY can never misroute a
      // Re-read.
      await refreshBrowsePages(path);
      setBrowseDoc(path);
      setBrowsePage(null);
      setPageView(null);
      // Page selection is PER-DOCUMENT: without this reset, a selection
      // armed on doc A survived into doc B's grid and "⇪ N p." exported —
      // and "Read then export" PAID for — pages of B the user never chose
      // (audit 2026-07-18).
      setExportSel(null);
      const req = ++browseReq.current;
      syncNotePages(captureBridge(), path)
        .then(() => {
          if (browseReq.current === req) {
            return refreshBrowsePages(path);
          }
        })
        .catch(() => {});
    },
    [refreshBrowsePages],
  );

  // The library tree is MEMOIZED: it renders hundreds of rows and used to
  // rebuild on every unrelated state change (each progress message repainted
  // the whole list — visibly slow on e-ink, device feedback 2026-07-18).
  // O(1) status lookups (perf audit 2026-07-20): the old per-row
  // lib.find() made every tree rebuild O(rows × docs).
  const libByPath = useMemo(() => new Map(lib.map(d => [d.path, d])), [lib]);

  // Tracked (Auto + Manual, not Off) note/PDF totals for the SYNC STATUS
  // pipeline (v0.69). Same enumeration as the SYNCHRONISATION aggregate:
  // lib ∪ treeCache, mode via resolveAutoTarget, total from the store
  // summary or the page-count sweep. Feeds the async classifier.
  const trackedTotals = useMemo(() => {
    const m = new Map<string, TrackedTotal>();
    const add = (path: string, total: number, pdfCovered: boolean) => {
      const mode = resolveAutoTarget(autoTargets, path)?.mode;
      if (mode !== 'auto' && mode !== 'manual') {
        return; // untracked or Off — outside the pipeline
      }
      if (!m.has(path)) {
        m.set(path, {total, isPdf: /\.pdf$/i.test(path), pdfCovered});
      }
    };
    for (const d of lib) {
      add(d.path, d.total, d.pdfCovered);
    }
    for (const [dir, kids] of Object.entries(treeCache)) {
      for (const k of kids) {
        if (!k.isDir) {
          const p = `${dir}/${k.name}`;
          add(p, pageCounts[p] ?? 0, false);
        }
      }
    }
    return m;
  }, [lib, treeCache, pageCounts, autoTargets]);

  // Async: classify the tracked pages into the 5 pipeline stages whenever
  // the library, jobs or targets change. Cheap (in-memory store pass).
  // Sequence-guarded (v0.70.3): jobs (2.5 s poll) and lib (600 ms store
  // sub) fire this independently, so two classify passes can overlap and
  // resolve OUT OF ORDER — an older result landing last showed stages 3
  // and 4 briefly out of sync (a page looked added to vision before it
  // left OCR-done). Only the latest request's result is applied, so the
  // five stages always move together, from one consistent snapshot.
  const pipeReq = useRef(0);
  const [pendingPdf, setPendingPdf] = useState<string | null>(null);
  useEffect(() => {
    const req = ++pipeReq.current;
    pipelineFromStoreSplit(trackedTotals)
      .then(r => {
        if (req === pipeReq.current) {
          setPipe(r);
          // v0.88.8: NO automatic document opening, EVER (three incidents:
          // the auto-rebind kept yanking PDFs over the user's work through
          // every guard). We only COMPUTE the first Vision-pending PDF; a
          // visible button lets the user resume it with an explicit tap.
          if (r.pdfs.ocrDone > 0) {
            loadStore()
              .then(st => {
                setPendingPdf(
                  Object.keys(st.docs).find(
                    path =>
                      /\.pdf$/i.test(path) &&
                      pendingVisionPages(st, path).length > 0,
                  ) ?? null,
                );
              })
              .catch(() => {});
          } else {
            setPendingPdf(null);
          }
        }
      })
      .catch(() => {});
  }, [trackedTotals]);

  const treeRows = useMemo((): React.JSX.Element[] | null => {
    const rows: React.JSX.Element[] = [];
    const statusOf = (p: string) => libByPath.get(p);
    // fix #7: the agent whose context we're filtering to (null = off), and
    // the union of its context paths (folder refs + whole notes + page-set
    // note paths) for membership tests.
    const filterAgent =
      agentShow !== null
        ? agentsView.find(a => a.id === agentShow) ?? null
        : null;
    const agentPaths =
      filterAgent === null
        ? []
        : [...filterAgent.docs, ...Object.keys(filterAgent.docPages ?? {})];
    const agentMatchesFile = (fp: string): boolean =>
      filterAgent === null ||
      agentPaths.some(p => p === fp || isUnderDocRef(p, fp));
    const agentMatchesDir = (dir: string): boolean =>
      filterAgent === null ||
      agentPaths.some(
        p => p === dir || p.startsWith(`${dir}/`) || dir.startsWith(`${p}/`),
      );
    // fix #6: multi-select mode filter (empty set = show all).
    const modeMatchesMode = (m: 'auto' | 'manual' | 'off' | null): boolean =>
      modeShow.size === 0 || (m !== null && modeShow.has(m));
    // #6: the agents this exact path directly belongs to (whole-doc or, for a
    // file, a page-set). Inherited-via-parent-folder membership is not shown
    // as a removable badge (you'd remove the folder, not this file).
    const renderAgentBadges = (fp: string, isDir: boolean): React.JSX.Element[] =>
      agentsView
        .map(ag => {
          const kind: 'doc' | 'pages' | null = ag.docs.includes(fp)
            ? 'doc'
            : !isDir &&
              Object.prototype.hasOwnProperty.call(ag.docPages ?? {}, fp)
            ? 'pages'
            : null;
          if (kind === null) {
            return null;
          }
          const key = `ag:${ag.id}|${fp}`;
          const armed = libArmed === key;
          return (
            <TouchableOpacity
              key={`ab:${key}`}
              onPress={() =>
                libConfirm(key, () => {
                  doRemoveFromAgentId(ag.id, fp, kind);
                })
              }
              hitSlop={chipSlop}
              style={[styles.agentBadge, armed && styles.agentBadgeArm]}>
              <Text
                style={[styles.agentBadgeText, armed && {color: '#ffffff'}]}
                numberOfLines={1}>
                {armed ? `${ag.icon} remove ✕` : ag.icon}
              </Text>
            </TouchableOpacity>
          );
        })
        .filter((x): x is React.JSX.Element => x !== null);
    // v0.63.1 (user): under a Show filter, a folder appears ONLY when
    // its own effective mode matches, or a descendant override does —
    // never the whole skeleton of the other modes.
    const folderMatchesFilter = (dir: string): boolean => {
      if (!agentMatchesDir(dir)) {
        return false;
      }
      if (modeShow.size === 0) {
        return true;
      }
      if (modeMatchesMode(resolveAutoTarget(autoTargets, dir)?.mode ?? null)) {
        return true;
      }
      return Object.entries(autoTargets).some(
        ([k, t]) => modeShow.has(t.mode) && k.startsWith(`${dir}/`),
      );
    };
    const walk = (path: string, name: string, depth: number) => {
      if (!folderMatchesFilter(path)) {
        return;
      }
      const isOpen = treeExpanded.has(path);
      const pad = {paddingLeft: depth * 14};
      rows.push(
        <View key={`f:${path}`} style={[styles.libFolderRow, pad]}>
          <TouchableOpacity
            onPress={() => toggleExpand(path)}
            hitSlop={rowSlop}
            style={styles.libFolderMain}>
            <Text style={styles.treeCaretText}>{isOpen ? '▾' : '▸'}</Text>
            <Text style={styles.libFolder} numberOfLines={1}>
              {name}/
            </Text>
          </TouchableOpacity>
          {/* #7 (user): row-end order = agent badge(s) · + Add · Export · Sync */}
          <View style={styles.rowActions}>
            {renderAgentBadges(path, true)}
            <AddToPicker
              scale={scale}
              btnScale={btnScale}
              label="+ Add ▾"
              agents={pickerAgents}
              onPick={t => onAddContext(t, {folder: path})}
            />
            <InlineMenu
              scale={scale}
              btnScale={btnScale}
              label={
                (exportDone === `${name}/|md` || exportDone === `${name}/|txt`
                  ? '✓ '
                  : '') + 'Export ▾'
              }
              disabled={exporting}
              options={[
                {
                  key: 'md',
                  label: 'Export .md',
                  onPress: () => exportFolder(path, name, 'md'),
                },
                {
                  key: 'txt',
                  label: 'Export .txt',
                  onPress: () => exportFolder(path, name, 'txt'),
                },
              ]}
            />
            {renderAutoChips(path)}
          </View>
        </View>,
      );
      if (!isOpen) {
        return;
      }
      const kids = treeCache[path] ?? [];
      const dirs = kids
        .filter(k => k.isDir)
        .sort((a, b) => a.name.localeCompare(b.name));
      const files = kids
        .filter(k => !k.isDir)
        .sort((a, b) => a.name.localeCompare(b.name));
      if (kids.length === 0) {
        rows.push(
          <Text
            key={`e:${path}`}
            style={[
              styles.modelNote,
              {fontSize: 12 * scale, lineHeight: 17 * scale},
              {paddingLeft: (depth + 1) * 14},
            ]}>
            (empty)
          </Text>,
        );
      }
      for (const d of dirs) {
        walk(`${path}/${d.name}`, d.name, depth + 1);
      }
      for (const f of files) {
        const fp = `${path}/${f.name}`;
        const st = statusOf(fp);
        const eff = resolveAutoTarget(autoTargets, fp);
        if (!modeMatchesMode(eff?.mode ?? null)) {
          continue; // fix #6 Show filter: only files matching the chips
        }
        if (!agentMatchesFile(fp)) {
          continue; // fix #7: only files in the selected agent's context
        }
        // Status rules (user decision 2026-07-18): the PAGE COUNT shows for
        // EVERY file it is known for, whatever the mode; "N to read" only
        // for files effectively on Manual or Auto — an Off file's backlog
        // is meaningless and used to show as "48 to read" (bug).
        const tracked = eff !== null && eff.mode !== 'off';
        const total = st && st.total > 0 ? st.total : pageCounts[fp] ?? 0;
        const count = total > 0 ? `${total} p` : '';
        // total - READ (blanks count as done, like the banner). A tracked
        // Same selection as the frame and the SYNC bar (docPending): `pend` =
        // pages owing a PAID read, `ocrN` = pages owing only Vision. A doc the
        // store has never seen is entirely pending (structural queue = total).
        const {read: pend, vision: ocrN} = docPending(
          st?.owed,
          st
            ? {queued: st.queued, ocrPending: st.ocrPending}
            : {queued: total, ocrPending: 0},
          total,
        );
        // The inline "⟳ reading…" state left the tree on purpose (perf
        // audit 2026-07-20): it depended on syncingNote, so EVERY page
        // read during a sync rebuilt the whole tree. Live progress shows
        // in the SYNCHRONISATION frame and on the Stop button instead.
        // Two ticks (user decision 2026-08-12): first ✓ = OCR read, second ✓ =
        // Vision done. `✓` alone = OCR done, Vision still owed; `✓✓` = fully
        // done. Unread pages show the paid-read count as before.
        const stText = tracked
          ? st
            ? pend > 0
              ? `${count} · ${pend} to read`
              : ocrN > 0
              ? `${count} · ✓ vision…`
              : `${count} · ✓✓`
            : count.length > 0
            ? `${count} · ${total} to read`
            : 'not read'
          : count;
        const stStyle =
          tracked && pend > 0
            ? styles.stPend
            : tracked && st && ocrN > 0
            ? styles.stOcr
            : tracked && st && pend === 0
            ? styles.stOk
            : styles.stOff;
        rows.push(
          <View
            key={`n:${fp}`}
            style={[styles.libRow, {paddingLeft: (depth + 1) * 14}]}>
            <TouchableOpacity
              onPress={() => openDoc(fp)}
              hitSlop={rowSlop}
              style={styles.libMain}>
              <Text style={styles.libName} numberOfLines={1}>
                {f.name}
              </Text>
              <Text style={[styles.libStatus, stStyle]} numberOfLines={1}>
                {stText}
              </Text>
            </TouchableOpacity>
            {/* #7 (user): row-end order = agent badge(s) · + Add · Sync */}
            <View style={styles.rowActions}>
              {renderAgentBadges(fp, false)}
              <AddToPicker
                scale={scale}
                btnScale={btnScale}
                label="+ Add ▾"
                agents={pickerAgents}
                onPick={t => onAddContext(t, {docPath: fp})}
              />
              {renderAutoChips(fp)}
              <TouchableOpacity
                onPress={() => toggleDocLock(fp)}
                hitSlop={chipSlop}
                style={[styles.aChip, lockedDocs.has(fp) && styles.aChipOn]}>
                <Text
                  style={[
                    styles.aChipText,
                    lockedDocs.has(fp) && styles.aChipOnText,
                  ]}>
                  {lockedDocs.has(fp) ? '🔒' : '🔓'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>,
        );
      }
    };
    for (const root of treeRoots) {
      walk(root.path, root.name, 0);
    }
    return rows;
  }, [
    treeRoots,
    treeCache,
    treeExpanded,
    modeShow,
    libByPath,
    autoTargets,
    pageCounts,
    exporting,
    exportDone,
    scale,
    btnScale,
    lockedDocs,
    toggleDocLock,
    renderAutoChips,
    toggleExpand,
    openDoc,
    exportFolder,
    pickerAgents,
    onAddContext,
    agentShow,
    agentsView,
    libArmed,
    libConfirm,
    doRemoveFromAgentId,
    styles,
  ]);

  // SYNCHRONISATION frame numbers, memoized (perf audit 2026-07-20): the
  // aggregation walks lib ∪ treeCache with resolveAutoTarget per file
  // (~40k startsWith with a big library). As an inline IIFE it re-ran on
  // EVERY render — each setMsg, each sync progress tick. Volatile bits
  // (recent syncs, last-sync stamp, button states) stay in the JSX.
  // Lot 2 (2026-08-03): the aggregation is a pure function in
  // syncFrameModel.ts — testable money math, out of the screen.
  const syncFrame = useMemo(
    () =>
      computeSyncFrame(lib, treeCache, autoTargets, pageCounts),
    [lib, treeCache, autoTargets, pageCounts],
  );

  // Library search now lives in the shared <SearchControls> component
  // (base + advanced multi-criteria); it emits results via onResults.

  // Sequence token: page image / native OCR land asynchronously — a fast
  // ‹/› navigation must not let a PREVIOUS page's results overwrite the
  // current page's view (audit 2026-07-17).
  const pageReq = useRef(0);
  // Sequence token for the openDoc background realignment walk (v0.63.5,
  // audit F5): open A → back → open B, and A's late walk must not paint
  // its grid (and its selection basis) under B.
  const browseReq = useRef(0);
  const openPage = useCallback(
    // docOverride lets openHit pass the doc directly (browseDoc state is
    // not yet updated in the same tick after openDoc).
    async (page: number, docOverride?: string) => {
      const doc = docOverride ?? browseDoc;
      if (doc === null) {
        return;
      }
      const req = ++pageReq.current;
      const s = await loadStore();
      const e = getPage(s, doc, page);
      if (pageReq.current !== req) {
        return; // a newer openPage superseded this one
      }
      setUiDocOpen(true); // renew the browse marker (v0.63.5)
      setBrowsePage(page);
      setPageEditing(false);
      setWordFix(null);
      setPageView(
        e === null
          ? {text: '', label: 'no transcript yet'}
          : {
              text: e.text,
              label: `${srcLongFor(e)} · ${fmtDateTime(e.at)}`,
              low: e.low,
            },
      );
      // Render the handwritten page + read the native Supernote OCR to show
      // beside it (v0.25/0.26). .note only; best-effort.
      setPageImg(null);
      setPageImgFail(false);
      setNativeOcr(null);
      if (e !== null && e.source === 'user' && isNotePath(doc)) {
        // Stale-fix probe (v0.63.4): compare the correction's rev with
        // the live footer — cheap when the snapshot is warm; pageReq
        // guards a late answer.
        readNotePageRevs(doc)
          .then(revs => {
            const live = revs.get(page);
            if (
              pageReq.current === req &&
              e.rev !== undefined &&
              live !== undefined &&
              live !== e.rev
            ) {
              setPageView(pv => (pv !== null ? {...pv, staleFix: true} : pv));
            }
          })
          .catch(() => {});
      }
      if (isNotePath(doc)) {
        // One retry after a beat: a render can fail transiently when the
        // device note engine is busy (background scans, batch renders).
        const tryRender = (attempt: number) => {
          capturePageImage(captureBridge(), doc, page)
            .then(img => {
              if (pageReq.current !== req) {
                return;
              }
              if (img && img.length > 0) {
                setPageImg(img);
              } else if (attempt === 0) {
                setTimeout(() => tryRender(1), 900);
              } else {
                setPageImg(null);
                setPageImgFail(true);
              }
            })
            .catch(() => {
              if (pageReq.current === req) {
                if (attempt === 0) {
                  setTimeout(() => tryRender(1), 900);
                } else {
                  setPageImg(null);
                  setPageImgFail(true);
                }
              }
            });
        };
        tryRender(0);
        readStoredPageText(doc, page)
          .then(t => {
            if (pageReq.current === req) {
              setNativeOcr(t && t.trim().length > 0 ? t : null);
            }
          })
          .catch(() => pageReq.current === req && setNativeOcr(null));
      } else {
        // PDF (v0.60): the "Original page" box gets the same preview a
        // .note gets — rendered via the DOC image pipeline the batch
        // paths already use. One shot, on page open only (renders are
        // heavy; see the generateNotePng starvation note above).
        // WITH the user's ink composited (user request 2026-08-16): the
        // preview shows what the page actually looks like on the device,
        // annotations included — the same renderDocPageWithMarks the paid
        // vision passes use. A page with no ink renders plain, and a mark
        // render failure silently falls back to the printed page.
        getMarkPagesList(captureBridge(), doc)
          .catch(() => null)
          .then(marks =>
            renderDocPageWithMarks(
              captureBridge(),
              doc,
              page,
              Array.isArray(marks) && marks.includes(page),
            ),
          )
          .then(img => {
            if (pageReq.current === req) {
              setPageImg(img && img.length > 0 ? img : null);
              setPageImgFail(!img || img.length === 0);
            }
          })
          .catch(() => {
            if (pageReq.current === req) {
              setPageImg(null);
              setPageImgFail(true);
            }
          });
      }
    },
    [browseDoc],
  );

  // v0.85 (menu deep-link): the hub asks the Library to open a specific doc
  // (and page) — "current note/page transcript" — or, with an EMPTY doc, just
  // to show the browse list ("Library" / "Synchronisation").
  //
  // v0.85.7 fix: this screen stays mounted across menu navigations, so a
  // once-only boolean guard meant only the FIRST target ever applied and every
  // later pick showed the previous one. Guard by the target's OBJECT identity
  // instead: each menu tap passes a fresh object, so a new target always runs,
  // re-render churn (unstable openDoc/openPage) is still skipped, and the ref
  // resets when the target is cleared so re-picking the same item works.
  const handledTarget = useRef<{doc: string; page: number | null} | null>(null);
  useEffect(() => {
    if (openTarget == null) {
      handledTarget.current = null;
      return;
    }
    if (handledTarget.current === openTarget) {
      return;
    }
    handledTarget.current = openTarget;
    // v0.88 (audit): the screen is kept mounted across close/reopen — agent
    // changes made from the floating panel while we were backgrounded were
    // invisible in badges/filters until a Library-side mutation. Re-entry
    // (every openTarget) refreshes the display copy from disk.
    refreshAgentsView();
    const t = openTarget;
    (async () => {
      if (t.doc === '') {
        // "Library" / "Synchronisation": back to the browse list, no doc.
        setBrowseDoc(null);
        setBrowsePage(null);
      } else {
        await openDoc(t.doc);
        if (t.page !== null) {
          await openPage(t.page, t.doc);
        }
      }
      clearOpenTarget?.();
    })().catch(() => clearOpenTarget?.());
  }, [openTarget, openDoc, openPage, clearOpenTarget, refreshAgentsView]);

  // Open a search hit: its doc, then its page (openDoc realigns pageids).
  const openHit = useCallback(
    async (hit: SearchHit) => {
      await openDoc(hit.path);
      await openPage(hit.page, hit.path);
    },
    [openDoc, openPage],
  );

  const savePageEdit = useCallback(async () => {
    if (browseDoc === null || browsePage === null) {
      return;
    }
    // PAGEID + rev stamps (pageStamp): a 'user' entry saved without them
    // used to be silently overwritten by Auto (audit 2026-07-17).
    const st = await pageStamp(captureBridge(), browseDoc, browsePage);
    await upsertTranscript(
      browseDoc,
      browsePage,
      pageDraft.trim(),
      'user',
      st,
      undefined,
      undefined,
      true, // the user's own hands: the barrier lets it through, lock kept
    );
    setPageEditing(false);
    await openPage(browsePage);
    refreshLib().catch(() => {});
  }, [browseDoc, browsePage, pageDraft, openPage, refreshLib]);

  // Tap-to-correct one low-confidence word: replace its FIRST whole-word
  // occurrence in the transcript, store the page as a manual 'user'
  // entry, and drop that word from the low list so it stops being boxed.
  const applyWordFix = useCallback(async () => {
    if (
      browseDoc === null ||
      browsePage === null ||
      wordFix === null ||
      pageView === null
    ) {
      return;
    }
    const {orig, draft, nth} = wordFix;
    // The rules live in src/core/text/wordFix.ts (device report 2026-08-12 +
    // full-scope audit pinned as tests): map the tapped ordinal to its EXACT
    // character offset over the tappable occurrences (skipping table/code, like
    // the screen does), then replace THERE — a by-count replace on the raw
    // markdown hit a table cell the user never touched. Keep the word flagged
    // while any tappable occurrence is left.
    const off = wordOffsets(pageView.text, orig)[nth];
    const nextText =
      off !== undefined
        ? replaceAtOffset(pageView.text, off, orig, draft)
        : pageView.text;
    const nextLow = lowAfterFix(pageView.low ?? [], orig, nextText);
    // Optimistic UI FIRST: show the correction instantly. The persistence
    // below does a slow ensureNoteFresh (save + retries); doing it before
    // the visible update made Replace feel dead, so people tapped it several
    // times (device report 2026-07-15).
    setWordFix(null);
    setPageView({...pageView, text: nextText, low: nextLow});
    const st = await pageStamp(captureBridge(), browseDoc, browsePage);
    await upsertTranscript(
      browseDoc,
      browsePage,
      nextText,
      'user',
      st,
      nextLow,
      undefined,
      true, // word fix = the user's own hands (see savePageEdit)
    );
    refreshLib().catch(() => {});
  }, [browseDoc, browsePage, wordFix, pageView, refreshLib]);

  // Re-read THIS page with the Smart engine (OCR 4 + vision escalation).
  // rotateDeg (v0.52 "Redo rotated"): straighten the render first — for
  // pages written sideways on a portrait canvas (device page 9 case).
  const rereadPage = useCallback(
    async (rotateDeg?: number) => {
      if (browseDoc === null || browsePage === null || pageBusy) {
        return;
      }
      if (keyState.kind !== 'ok') {
        return;
      }
      const apiKey = keyState.config.apiKey;
      // v0.94: a lock is the user's own freeze. An explicit redo does not
      // silently ignore it — it says so and does nothing.
      if (isPageLocked(await loadStore(), browseDoc, browsePage)) {
        setMsg('🔒 This page is locked — unlock it to re-read.');
        return;
      }
      if (!canPersistDoc(browseDoc)) {
        // Audit 9 #3: paying for a read whose result cannot be persisted
        // this session (unreadable shard) would be money thrown away.
        setMsg(STORAGE_UNAVAILABLE_MSG);
        return;
      }
      setPageBusy(true);
      try {
        let r: {ok: boolean; reason?: string} = {ok: true};
        if (isNotePath(browseDoc)) {
          r = await readNotePages(
            captureBridge(),
            apiKey,
            assembleVisionPrompt(promptBlocks),
            browseDoc,
            [browsePage],
            {force: true, rotateDeg},
          );
        } else if (/\.pdf$/i.test(browseDoc)) {
          // Redo on a PDF page re-reads THAT page with Vision — never the whole
          // document. readPdf(force) reloaded the ENTIRE PDF into a base64
          // string (~40 MB on a big file), which OOM-crashed the 192 MB plugin
          // heap right after a manual +Vision (device report 2026-07-29).
          r = await readPdfPageVision(
            captureBridge(),
            apiKey,
            assemblePdfVisionPrompt(promptBlocks),
            browseDoc,
            browsePage,
          );
        }
        // Surface a refusal (the Off gate lives in reading.ts, and since
        // v0.94 it covers the PDF single-page path too) or a failure,
        // instead of silently showing the unchanged entry. A SUCCESS may
        // also carry a reason — "nothing to add", "page is blank" — and it
        // is shown plainly: it is an answer, not a warning (2026-08-03).
        setMsg(r.reason !== undefined ? (r.ok ? r.reason : `⚠ ${r.reason}`) : '');
        await openPage(browsePage);
        refreshLib().catch(() => {});
      } finally {
        setPageBusy(false);
      }
    },
    [browseDoc, browsePage, keyState, pageBusy, promptBlocks, openPage, refreshLib, setMsg],
  );

  // Option A (v0.84): PDFs get OCR+Vision on every page automatically, so the
  // manual "force Vision on this page / all pages" handlers are gone. A single
  // page is re-read via rereadPage ("Redo AI transcript"); the whole document
  // via a normal Sync; interrupted pages via "Vision now".

  // On entering the Library, structural-sync tracked notes not yet in the
  // store so the pending counts reflect what a Sync will actually read.
  useEffect(() => {
    // C4: structural-sync tracked notes not yet in the store, so the
    // pending count reflects what a Sync will actually read (not just the
    // already-read docs). Background, bounded, reads store/settings fresh
    // (no `lib` dependency → no refresh loop). v0.47: PACED (150 ms
    // between notes — it competed with everything else on the bridge),
    // CANCELLED on leaving the Library, and run ONCE per plugin session
    // (post-split it re-ran on every Library entry and piled up with the
    // sweep + tick — part of the "whole plugin slow" device report).
    let c4Alive = true;
    if (!c4DoneOnce.done) {
      c4DoneOnce.done = true;
      (async () => {
        try {
          const s = await readSettings();
          const tracked = await resolveTrackedNotes(s.autoTargets ?? {});
          const store = await loadStore();
          let n = 0;
          for (const p of tracked.keys()) {
            if (!c4Alive) {
              c4DoneOnce.done = false; // interrupted → retry next entry
              return;
            }
            if (store.docs[p] !== undefined || n++ > 300) {
              continue;
            }
            await syncNotePages(captureBridge(), p).catch(() => {});
            await new Promise<void>(r => setTimeout(r, 150));
          }
          refreshLib().catch(() => {});
        } catch {
          // best-effort
        }
      })();
    }
    return () => {
      c4Alive = false;
    };
  }, [keyState, refreshLib]);

  // While the Library stays open, keep Auto moving AND reflected on screen. The
  // module self-throttles (20s min gap) and reads up to 100 pages/tick, so this
  // re-ticks every 25s and refreshes the pending counts until the backlog
  // drains — this is what makes Auto notes fill in while you watch instead of
  // only when you open each one. Only 'auto' targets are touched here (Manual
  // waits for a Sync button).
  // The 45-s "library-watch" tick is GONE (v0.63.4 — logs 2026-07-19
  // evening: a full 68-note skip-pass every 45 s, forever, while the
  // config sat open — the metronome behind "le plugin rame à mort").
  // While the config is open the user is NOT writing in a note, so the
  // real triggers suffice: pen-up, page turns, config-open, the 15-min
  // interval (which RUNS here — the config is the foreground activity).

  // "Go to this page" (Library page view): open the note/PDF at this page
  // and close the config so it's visible. Store pages are 0-indexed; the
  // native intent wants a 1-based page.
  const goToNotePage = useCallback((path: string, page: number) => {
    const ov = (
      SmartNoteAiOverlay as {
        openNoteAt?: (p: string, page: number) => Promise<unknown>;
      }
    ).openNoteAt;
    // Release audit 2026-08-12: the outcome was discarded and the config
    // closed anyway, so on a device whose note-app component differs the
    // button silently did nothing and left the user staring at their page.
    // The native side RESOLVES {success:false} — it does not reject.
    let opened: Promise<unknown> | null = null;
    try {
      const r = ov?.(path, page + 1);
      opened =
        r && typeof (r as Promise<unknown>).then === 'function'
          ? (r as Promise<unknown>)
          : null;
    } catch {
      // best-effort
    }
    opened
      ?.then(res => {
        if ((res as {success?: boolean})?.success === false) {
          ToastAndroid.show(
            'Could not open that document on this device.',
            ToastAndroid.LONG,
          );
        }
      })
      .catch(() => {});
    setUiDocOpen(false); // leaving the config — release the browse marker
    const close = (): void => {
      setTimeout(() => PluginManager.closePluginView(), 150);
    };
    // Flush the debounced settings save first (v0.88 audit) — this is the
    // one closePluginView call site that skipped it.
    if (flushSettings !== undefined) {
      flushSettings().catch(() => {}).then(close);
    } else {
      close();
    }
  }, [flushSettings]);

  const bp = {paddingHorizontal: 12 * btnScale, paddingVertical: 7 * btnScale};
  const bf = {fontSize: 13 * btnScale};
  // K13 (device feedback): the chosen text size applies to the config
  // pages themselves, not just the panel.
  const mf = {fontSize: 13 * scale, lineHeight: 20 * scale};
  const nf = {fontSize: 12 * scale, lineHeight: 17 * scale};
  const sf = {fontSize: 16 * scale};
  const lf = {fontSize: 13 * scale};
  const keyOk = keyState.kind === 'ok';

  // v0.80.0 (audit simplification): ONE column renderer for the AUTO and
  // MANUAL halves of the SYNCHRONISATION frame — they were ~60 lines of
  // near-identical JSX.
  const syncCol = (p: {
    title: string;
    action: React.JSX.Element | null;
    lastAt: number;
    filesLine: string;
    count: {pending: number; pendLabel: string} | null;
    footer?: React.JSX.Element | null;
  }): React.JSX.Element => (
    <View style={styles.syncCol}>
      <View style={styles.syncColHead}>
        <Text style={styles.syncColTitle}>{p.title}</Text>
        <View style={styles.flex1} />
        {p.action}
      </View>
      {p.lastAt > 0 ? (
        <Text style={[styles.modelNote, nf]}>
          {`last sync ${fmtDateTime(p.lastAt)}`}
        </Text>
      ) : null}
      <Text style={[styles.modelNote, nf]}>{p.filesLine}</Text>
      {p.count !== null ? (
        <Text
          style={[
            styles.modelNote,
            nf,
            p.count.pending > 0 ? styles.stPend : styles.stOk,
          ]}>
          {p.count.pending > 0 ? p.count.pendLabel : 'all up-to-date'}
        </Text>
      ) : null}
      {p.footer ?? null}
    </View>
  );

    // Page view (deepest level of the library browser) — Library screen.
  if (browseDoc !== null && browsePage !== null) {
    return (
      <PageView
        browseDoc={browseDoc}
        browsePage={browsePage}
        browsePages={browsePages}
        pageView={pageView}
        pageEditing={pageEditing}
        setPageEditing={setPageEditing}
        pageDraft={pageDraft}
        setPageDraft={setPageDraft}
        pageBusy={pageBusy}
        wordFix={wordFix}
        setWordFix={setWordFix}
        pageImg={pageImg}
        pageImgFail={pageImgFail}
        nativeOcr={nativeOcr}
        keyOk={keyOk}
        scale={scale}
        btnScale={btnScale}
        openPage={openPage}
        savePageEdit={savePageEdit}
        applyWordFix={applyWordFix}
        rereadPage={rereadPage}
        pageLocked={lockState.page}
        docLocked={lockState.doc}
        onTogglePageLock={() =>
          browseDoc !== null && browsePage !== null
            ? togglePageLock(browseDoc, browsePage)
            : undefined
        }
        goToNotePage={goToNotePage}
        refreshBrowsePages={refreshBrowsePages}
        setBrowsePage={setBrowsePage}
        subHeader={subHeader}
        agents={pickerAgents}
        onAddContext={onAddContext}
        ctxFlash={ctxFlash}
      />
    );
  }

    // EXPORT "read first?" dialog — rendered on the grid AND main screens.
    const exportAskCard =
      exportAsk === null ? null : (
        <View style={[styles.qaCard, styles.gapTop]}>
          <Text style={[styles.label, lf]}>⇪ Export {exportAsk.label}</Text>
          <Text style={[styles.manual, mf]}>
            {exportAsk.notePages > 0
              ? `${exportAsk.notePages} page(s) not read yet (~${eurosTotal(
                  exportAsk.notePages,
                  FULL_PAGE_READ_CENTS,
                )}€). `
              : ''}
            {/* Release audit 2026-08-12: "one cheap OCR call each" was
                false and expensive — reading an unread PDF OCRs EVERY page
                of it and then runs a Vision call per page. Say so. */}
            {exportAsk.pdfDocs > 0
              ? `${exportAsk.pdfDocs} PDF(s) not read yet — each one is read in FULL (every page, OCR + Vision), and their length is not known in advance. `
              : ''}
            Read them first, or export what the library has (gaps are marked)?
          </Text>
          <View style={[styles.chips, styles.gapTop]}>
            {exportAsk.canRead ? (
              <TouchableOpacity
                onPress={readThenExport}
                style={[styles.chip, bp, styles.chipOn]}>
                <Text style={[styles.chipText, bf, styles.chipTextOn]}>
                  Read then export
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => {
                const r = exportAsk;
                setExportAsk(null);
                doExport(r);
              }}
              style={[styles.chip, bp]}>
              <Text style={[styles.chipText, bf]}>Export incomplete</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setExportAsk(null)}
              style={[styles.chip, bp]}>
              <Text style={[styles.chipText, bf]}>Cancel</Text>
            </TouchableOpacity>
          </View>
          {!exportAsk.canRead ? (
            <Text style={[styles.modelNote, nf]}>
              Reading needs an API key (screen 1).
            </Text>
          ) : null}
        </View>
      );

    // Pages list of one document.
  if (browseDoc !== null) {
    return (
      <PageGrid
          exportDone={exportDone}
        browseDoc={browseDoc}
        browsePages={browsePages}
        exportSel={exportSel}
        setExportSel={setExportSel}
        exporting={exporting}
        msg={msg}
        exportAskCard={exportAskCard}
        startExport={startExport}
        openPage={openPage}
        setBrowseDoc={setBrowseDoc}
        subHeader={subHeader}
        scale={scale}
        btnScale={btnScale}
        agents={pickerAgents}
        onAddContext={onAddContext}
        onClearDocTranscript={onClearDocTranscript}
        docLocked={lockState.doc}
        lockedPages={lockState.pages}
        onToggleDocLock={() =>
          browseDoc !== null ? toggleDocLock(browseDoc) : undefined
        }
        ctxFlash={ctxFlash}
      />
    );
  }

    // ================ Library (search + browse + manage) ================
    return (
      <View style={styles.root}>
        {subHeader(
          // v0.83.2 (user): header identical to the LIBRARY door (H15).
          '📚 LIBRARY: browse, sync & fix your transcripts',
          () => {
            setSearchActive(false);
            setSearchHits([]);
            // v0.88.2 (user): the Library is reached from the MENU — back
            // goes there and SAYS so (the label still read "Config").
            goHome();
          },
          'Menu',
        )}
        {ctxFlash.length > 0 ? (
          <Text style={[styles.ctxFlash, nf]}>{ctxFlash}</Text>
        ) : null}
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={[styles.section, sf]}>Search</Text>
          <SearchControls
            scale={scale}
            onResults={(h, a) => {
              setSearchHits(h);
              setSearchActive(a);
            }}
          />
          {searchActive ? (
            <SearchHitsList
              hits={searchHits}
              autoTargets={autoTargets}
              agents={pickerAgents}
              scale={scale}
              btnScale={btnScale}
              onOpenHit={openHit}
              onGoToPage={goToNotePage}
              onAddContext={onAddContext}
            />
          ) : (
            <>
              {/* v0.79.13 (user): the whole-library actions live ABOVE the
                  SYNCHRONISATION block, next to Clear all — Export, Back up,
                  Restore, then the (renamed, warned) Clear all Transcript. */}
              <View style={[styles.libSectionRow, {flexWrap: 'wrap'}]}>
                <Text style={[styles.section, sf]}>All notes &amp; PDFs</Text>
                <View style={styles.flex1} />
                <TouchableOpacity
                  onPress={() => exportAll('md')}
                  disabled={exporting}
                  style={styles.clearMini}>
                  <Text style={styles.clearMiniText}>
                    {exportDone === 'library|md' ? '✓ ' : ''}Export all .md
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => exportAll('txt')}
                  disabled={exporting}
                  style={styles.clearMini}>
                  <Text style={styles.clearMiniText}>
                    {exportDone === 'library|txt' ? '✓ ' : ''}Export all .txt
                  </Text>
                </TouchableOpacity>
                {/* full transcript-library backup (a single restorable file). */}
                <TouchableOpacity
                  onPress={onBackupLibrary}
                  style={styles.clearMini}>
                  <Text style={styles.clearMiniText}>⤓ Back up library</Text>
                </TouchableOpacity>
                {/* v0.80.1 (user): EVERY armed confirm goes inverted video —
                    one visual language for "tap again to do it". */}
                <TouchableOpacity
                  onPress={onRestoreLibrary}
                  style={[
                    styles.clearMini,
                    libArmed === 'libImport' && {backgroundColor: '#000000'},
                  ]}>
                  <Text
                    style={[
                      styles.clearMiniText,
                      libArmed === 'libImport' && {color: '#ffffff'},
                    ]}>
                    {libArmed === 'libImport'
                      ? 'Restore backup? (tap again)'
                      : '⤒ Restore backup'}
                  </Text>
                </TouchableOpacity>
                {lib.length > 0 ? (
                  <TouchableOpacity
                    onPress={onClearOffTranscripts}
                    style={[
                      styles.clearMini,
                      libArmed === 'clearOff' && {backgroundColor: '#000000'},
                    ]}>
                    <Text
                      style={[
                        styles.clearMiniText,
                        libArmed === 'clearOff' && {color: '#ffffff'},
                      ]}>
                      {libArmed === 'clearOff'
                        ? 'Clear Off-note transcripts? (tap again)'
                        : 'Clear transcripts of Off notes'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {lib.length > 0 ? (
                  <TouchableOpacity
                    onPress={clearAll}
                    style={[
                      styles.clearMini,
                      // v0.80.0 (audit H2): the armed state of the most
                      // destructive action must be UNMISSABLE — inverted
                      // style + explicit wording, not a trailing "?".
                      confirmClear === 'ALL' && {backgroundColor: '#000000'},
                    ]}>
                    <Text
                      style={[
                        styles.clearMiniText,
                        confirmClear === 'ALL' && {color: '#ffffff'},
                      ]}>
                      {confirmClear === 'ALL'
                        ? '⚠ Tap again: wipe ALL transcripts'
                        : '⚠ Clear all transcripts'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {/* v0.80.0 (audit H5): action feedback lives right under the
                  buttons that caused it (backup/restore/export/clear), not
                  buried inside the sync frame below. */}
              {msg.length > 0 ? (
                <Text style={[styles.msg, styles.gapTop]}>{msg}</Text>
              ) : null}
              {exportAskCard}

              <ActivityBanner scale={scale} />

              {(() => {
                // v0.45 frame (user design 2026-07-18): PAGES are the primary
                // unit (you pay per page), the note count is context. LEFT
                // column = what runs itself (Auto; the Off block was removed
                // in v0.60 — user decision: Off is a privacy switch, not a
                // sync state). RIGHT column = Manual, where the user acts,
                // top to bottom in flow order: check (free) → sync (paid,
                // live or batch) → collect (free). Pages already in a pending
                // batch job are shown AT MISTRAL, not "to sync" — the old
                // frame kept counting them as unread after a submit (the
                // "496 to read that never moves" confusion).
                const {agg, toSync, canSync, foldersCnt} = syncFrame;
                const man = agg.manual;
                const last = getLastSyncAt();
                const lastManual = getLastManualSyncAt();
                // "3 folders · 45 notes (1200 pages) · 4 pdf (92 pages)"
                // (user 2026-08-14): page counts live WITH each file type,
                // not as a lone "N tracked" total the user could not map back.
                const filesLabel = (
                  a: (typeof agg)['auto'],
                  mode: 'auto' | 'manual' | 'off',
                ): string => {
                  const f = foldersCnt[mode];
                  return [
                    f > 0 ? `${f} folder${f > 1 ? 's' : ''}` : null,
                    `${a.noteFiles} notes (${a.notePages} pages)`,
                    a.pdfFiles > 0 ? `${a.pdfFiles} pdf (${a.pdfPages} pages)` : null,
                  ]
                    .filter(x => x !== null)
                    .join(' · ');
                };
                const centsFull = FULL_PAGE_READ_CENTS;
                // Regression audit 2026-08-12: Lot 2 enabled "Sync now" when
                // only Vision is owed (visionPending), but the label/euro still
                // read from toSync alone → an active button over "0 pages · ~0
                // €" that then billed a Vision pass. Reflect BOTH: queued pages
                // cost the full read, vision-pending pages the cheaper Vision
                // leg (OCR already paid, READ_COST_CENTS).
                const visionPending = agg.manual.visionPending;
                const syncPages = toSync + visionPending;
                // Harmonised with Auto's "pages to read" (user 2026-08-14: the
                // two columns used different verbs, "to read" vs "to sync").
                const syncPendLabel =
                  toSync > 0 && visionPending > 0
                    ? `${toSync} to read + ${visionPending} to finish`
                    : visionPending > 0
                    ? `${visionPending} page(s) to finish (vision)`
                    : `${toSync} pages to read`;
                const syncEuro = (
                  Math.round(
                    toSync * centsFull + visionPending * READ_COST_CENTS,
                  ) / 100
                ).toFixed(2);
                return (
                  <View style={styles.autoBanner}>
                    <View style={styles.syncTitleRow}>
                      <Text style={styles.autoLbl}>SYNCHRONISATION</Text>
                    </View>

                    {/* ---- AUTO | MANUAL side by side (user 2026-07-25) ---- */}
                    <View style={styles.syncCols}>
                      {syncCol({
                        title: 'AUTO',
                        action:
                          agg.auto.notes > 0 ? (
                            <TouchableOpacity
                              onPress={forceSyncAuto}
                              disabled={syncBusy}
                              style={styles.clearMini}>
                              <Text style={styles.clearMiniText}>
                                {syncKind === 'auto' ? 'Syncing…' : 'Force sync'}
                              </Text>
                            </TouchableOpacity>
                          ) : null,
                        lastAt: last,
                        filesLine:
                          agg.auto.notes === 0
                            ? 'nothing on Auto'
                            : filesLabel(agg.auto, 'auto'),
                        count:
                          agg.auto.notes > 0
                            ? {
                                pending: agg.auto.toRead,
                                pendLabel: `${agg.auto.toRead} pages to read`,
                              }
                            : null,
                      })}

                      <View style={styles.syncColDiv} />

                      {syncCol({
                        title: 'MANUAL',
                        action: (
                          <TouchableOpacity
                            onPress={checkAllChanges}
                            disabled={checkingAll}
                            style={styles.clearMini}>
                            <Text style={styles.clearMiniText}>
                              {checkingAll
                                ? checkStatus || 'Checking…'
                                : 'Check changes'}
                            </Text>
                          </TouchableOpacity>
                        ),
                        lastAt: lastManual,
                        filesLine:
                          man.notes === 0
                            ? 'nothing on Manual'
                            : filesLabel(man, 'manual'),
                        count:
                          man.notes > 0
                            ? {
                                pending: syncPages,
                                pendLabel: syncPendLabel,
                              }
                            : null,
                        footer:
                          man.notes > 0 ? (
                            <TouchableOpacity
                              onPress={syncAutoNow}
                              disabled={syncBusy || !canSync}
                              style={[
                                styles.syncBtn,
                                styles.syncBtnDark,
                                styles.syncColBtn,
                                (syncBusy || !canSync) && styles.smallBtnOff,
                              ]}>
                              <Text style={styles.syncBtnDarkText}>
                                {/* Release audit 2026-08-12: an unread PDF
                                    counts as ONE page here (the host reports
                                    1 page for a PDF), so the euro figure was
                                    far under the real bill. Show "+" and the
                                    count of documents whose length we cannot
                                    know until we read them. */}
                                {syncKind === 'now'
                                  ? `Syncing… ${syncingNote ?? ''}`
                                  : `Sync now · ~${syncEuro} €${
                                      syncFrame.agg.manual.pdfUnknown > 0
                                        ? ` + ${syncFrame.agg.manual.pdfUnknown} PDF of unknown length`
                                        : ''
                                    }`}
                              </Text>
                            </TouchableOpacity>
                          ) : null,
                      })}
                    </View>

                    {/* The standing Sync-now order count line was removed
                        (rationalisation 2026-08-14): the 4 queues (OCR + Vision,
                        per note / PDF) already ARE the pending truth — a second
                        counter was redundant and leaked stale orders. The orders
                        mechanism stays internal and now self-empties when a doc
                        owes nothing. */}

                    {/* ---- SYNC STATUS — split by type (notes / PDF), v0.86 ----
                        Notes and PDFs render under DIFFERENT hosts, so their
                        progress is two separate bars, each with its own details
                        toggle and a type-scoped "Vision now". */}
                    {pipe !== null &&
                    (pipe.notes.tracked > 0 || pipe.pdfs.tracked > 0) ? (
                      <>
                        <View style={styles.syncHr} />
                        {/* One toggle for the whole SYNC STATUS block: the
                            frame above already shows aggregate pending, so the
                            per-type bars + stage details are opt-in (status-line
                            rationalisation 2026-08-14). */}
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => setPipeStatusOpen(v => !v)}
                          style={styles.ssTop}>
                          <Text style={styles.syncColTitle}>SYNC STATUS</Text>
                          <Text
                            style={[styles.modelNote, nf, styles.flex1, styles.lastAt]}>
                            {`${pipe.notes.finished + pipe.pdfs.finished}p read / ${
                              pipe.notes.tracked + pipe.pdfs.tracked
                            }p tracked`}
                          </Text>
                          <Text style={styles.clearMiniText}>
                            {pipeStatusOpen ? 'hide ▾' : 'details ▸'}
                          </Text>
                        </TouchableOpacity>
                        {pipeStatusOpen ? (
                        <>
                        {/* v0.88: make the render host VISIBLE — "why is my
                            other type not draining" was undiagnosable. */}
                        <Text style={[styles.modelNote, nf]}>
                          {getLastHostKind() === 'pdf'
                            ? 'Rendering via: PDF reader (notes wait for a note)'
                            : getLastHostKind() === 'note'
                            ? 'Rendering via: note app (PDF Vision waits for a PDF)'
                            : 'Rendering via: none yet (open a note or a PDF)'}
                        </Text>
                        {pendingPdf !== null && isPdfVisionBlocked() ? (
                          <TouchableOpacity
                            onPress={() => {
                              const ov = (
                                SmartNoteAiOverlay as {
                                  openNoteAt?: (
                                    p: string,
                                    page: number,
                                  ) => Promise<unknown>;
                                }
                              ).openNoteAt;
                              Promise.resolve(ov?.(pendingPdf, 1)).catch(
                                () => {},
                              );
                              setTimeout(
                                () => pokeAuto('pdf-resume', {force: true}),
                                1200,
                              );
                            }}
                            style={[styles.clearMini, styles.gapTop]}>
                            <Text style={styles.clearMiniText}>
                              {`▶ Resume PDF Vision · opens ${
                                pendingPdf.split('/').pop() ?? pendingPdf
                              }`}
                            </Text>
                          </TouchableOpacity>
                        ) : null}
                        {[
                          {
                            key: 'notes' as const,
                            title: 'NOTES',
                            s: pipe.notes,
                            open: pipeDetailsNotes,
                            toggle: () => setPipeDetailsNotes(v => !v),
                            vkind: 'note' as const,
                          },
                          {
                            key: 'pdfs' as const,
                            title: 'PDF',
                            s: pipe.pdfs,
                            open: pipeDetailsPdf,
                            toggle: () => setPipeDetailsPdf(v => !v),
                            vkind: 'pdf' as const,
                          },
                        ].map(bar => {
                          if (bar.s.tracked === 0) {
                            return null; // nothing tracked of this type
                          }
                          const onGoing = bar.s.tracked - bar.s.finished;
                          // N5 (2026-08-12): never round UP to 100% while pages
                          // are still on-going — Math.round(99.5)=100 showed a
                          // full bar next to "100% · 1p on-going".
                          const pct =
                            bar.s.tracked > 0
                              ? onGoing > 0
                                ? Math.min(
                                    99,
                                    Math.round(
                                      (bar.s.finished / bar.s.tracked) * 100,
                                    ),
                                  )
                                : 100
                              : 0;
                          return (
                            <View key={bar.key} style={styles.syncTypeBlock}>
                              <TouchableOpacity
                                activeOpacity={0.7}
                                onPress={bar.toggle}
                                style={styles.ssTop}>
                                <Text style={styles.syncColTitle}>{bar.title}</Text>
                                <Text
                                  style={[styles.modelNote, nf, styles.flex1, styles.lastAt]}>
                                  {`${bar.s.finished}p read / ${bar.s.tracked}p tracked · ${pct}% · ${onGoing}p on-going`}
                                </Text>
                                <Text style={styles.clearMiniText}>
                                  {bar.open ? 'hide ▾' : 'details ▸'}
                                </Text>
                              </TouchableOpacity>
                              <View style={styles.progTrack}>
                                <View style={[styles.progFill, {width: `${pct}%`}]} />
                              </View>
                              {bar.open ? (
                                <View style={styles.ssDetails}>
                                  {[
                                    {n: '1', nm: 'Queue', h: 'new / edited, not read yet', c: bar.s.queue, d: false},
                                    {n: '2', nm: 'OCR done, Vision to do', h: 'on Supernote', c: bar.s.ocrDone, d: false},
                                    {n: '✓', nm: 'Finished', h: '', c: bar.s.finished, d: true},
                                  ].map(row => (
                                    <View key={row.n} style={[styles.stRow, row.d && styles.stRowFin]}>
                                      <Text style={styles.stMk}>{row.n}</Text>
                                      <View style={styles.flex1}>
                                        <View style={local.stInline}>
                                          <Text style={[styles.modelNote, nf, row.d && styles.stOk]}>
                                            {row.nm}
                                          </Text>
                                          {row.n === '2' && bar.s.ocrDone > 0 ? (
                                            <TouchableOpacity
                                              onPress={() => finishVisionNow(bar.vkind)}
                                              disabled={finishingVision || syncBusy}
                                              style={[
                                                styles.clearMini,
                                                (finishingVision || syncBusy) && styles.smallBtnOff,
                                              ]}>
                                              <Text style={styles.clearMiniText}>
                                                {finishingVision && finishVisionKind === bar.vkind
                                                  ? 'Running vision…'
                                                  : '▶ Force Vision'}
                                              </Text>
                                            </TouchableOpacity>
                                          ) : null}
                                        </View>
                                        {row.h.length > 0 ? (
                                          <Text style={[styles.modelNote, nf, styles.stHint]}>
                                            {row.h}
                                          </Text>
                                        ) : null}
                                      </View>
                                      <Text style={[styles.stNum, row.d && styles.stOk]}>
                                        {`${row.c} p`}
                                      </Text>
                                    </View>
                                  ))}
                                </View>
                              ) : null}
                            </View>
                          );
                        })}
                        <Text
                          style={[styles.modelNote, nf, styles.stHint, styles.gapTop]}>
                          Note sync needs the note open in the background; PDF
                          Vision (schemas &amp; handwritten annotations) needs a
                          PDF open in the background.
                        </Text>
                        </>
                        ) : null}
                      </>
                    ) : null}

                  </View>
                );
              })()}
              <View style={[styles.libSectionRow, {flexWrap: 'wrap'}]}>
                <Text style={[styles.modelNote, nf]}>Show:</Text>
                {(['auto', 'manual', 'off'] as const).map(m => {
                  const on = modeShow.has(m);
                  return (
                    <TouchableOpacity
                      key={`sh:${m}`}
                      onPress={() =>
                        setModeShow(cur => {
                          const n = new Set(cur);
                          if (n.has(m)) {
                            n.delete(m);
                          } else {
                            n.add(m);
                          }
                          return n;
                        })
                      }
                      style={[styles.clearMini, on && {backgroundColor: '#000000'}]}>
                      <Text
                        style={[styles.clearMiniText, on && {color: '#ffffff'}]}>
                        {m === 'auto' ? 'Auto' : m === 'manual' ? 'Manual' : 'Off'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {agentsView.length > 0 ? (
                  <Text style={[styles.modelNote, nf]}> · In agent:</Text>
                ) : null}
                {agentsView.map(a => {
                  const on = agentShow === a.id;
                  return (
                    <TouchableOpacity
                      key={`ag:${a.id}`}
                      onPress={() => setAgentShow(cur => (cur === a.id ? null : a.id))}
                      style={[styles.clearMini, on && {backgroundColor: '#000000'}]}>
                      <Text
                        style={[styles.clearMiniText, on && {color: '#ffffff'}]}
                        numberOfLines={1}>
                        {a.icon} {a.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {treeRows}
              <Text style={[styles.modelNote, nf, styles.gapTop]}>
                One chip per row sets the mode: Off (never sent to the AI),
                Manual (read on demand: a Sync button or a chat question), or
                Auto (read in the background while the plugin is open). A folder
                covers every note and PDF under it; a note or PDF can be set on
                its own. There is a single engine: Mistral OCR, escalating to
                Vision automatically on hard pages. Setting a chip costs
                nothing; you only pay when pages are actually read.
              </Text>
            </>
          )}
          <View style={styles.bottomPad} />
        </ScrollView>
      </View>
    );
}

const local = StyleSheet.create({
  ctxFlash: {
    color: '#000000',
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: '#eeeeee',
  },
  libFolderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
  },
  // Whole folder line (caret + name) is one tap target that expands it.
  libFolderMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  treeCaretText: {fontSize: 18, fontWeight: '800', color: '#000000'},
  libFolder: {flex: 1, fontSize: 15, fontWeight: '700', color: '#000000'},
  libRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#dddddd',
  },
  // The name+status area fills the whole row (up to the chips) and is tall
  // enough to tap with a finger; opens the note/PDF.
  libMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  libName: {flex: 1, fontSize: 15, color: '#000000'},
  // v0.30 Library redesign (rounded design system).
  autoBanner: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 12,
    padding: 11,
    marginBottom: 4,
  },
  autoLbl: {fontSize: 12, fontWeight: '800', letterSpacing: 0.5, color: '#000000'},
  syncTitleRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  // v0.79.13: AUTO & MANUAL as two side-by-side columns (user 2026-07-25).
  syncCols: {flexDirection: 'row', gap: 12, marginTop: 8},
  syncCol: {flex: 1, gap: 3},
  syncColDiv: {width: 1, backgroundColor: '#bbbbbb', marginVertical: 2},
  syncColHead: {flexDirection: 'row', alignItems: 'center', gap: 6},
  syncColBtn: {flex: 0, alignSelf: 'stretch', marginTop: 6},
  // v0.45 two-column frame: left = Auto & Off (state only), right = Manual
  // (the action zone). Column titles echo the chips' mode names.
  syncColTitle: {fontSize: 13, fontWeight: '700', color: '#000000'},
  // (v0.80.0 audit: syncRow/syncStatRow/autoBtnsRow/syncBtnText/syncHrTop —
  // leftovers of the pre-column layouts — were dropped as dead styles.)
  syncHr: {borderTopWidth: 1, borderTopColor: '#bbbbbb', marginTop: 12, paddingTop: 4},
  // v0.86: one SYNC STATUS bar per document type (notes / PDF).
  syncTypeBlock: {marginTop: 10},
  lastAt: {marginLeft: 8},
  ssTop: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2},
  progTrack: {height: 10, backgroundColor: '#d8d8d8', borderRadius: 20, overflow: 'hidden', marginTop: 8},
  progFill: {height: '100%', backgroundColor: '#000000', borderRadius: 20},
  ssDetails: {marginTop: 10, gap: 1},
  stRow: {flexDirection: 'row', alignItems: 'baseline', gap: 9, paddingVertical: 3},
  stInline: {flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap'},
  stRowFin: {borderTopWidth: 1, borderTopColor: '#dddddd', marginTop: 3, paddingTop: 7},
  stMk: {fontSize: 12, color: '#666666', width: 16},
  stNum: {fontSize: 14, fontWeight: '700', color: '#000000'},
  stHint: {color: '#666666'},
  syncBtn: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#000000',
    borderRadius: 8,
    paddingVertical: 9,
  },
  syncBtnDark: {backgroundColor: '#000000'},
  syncBtnDarkText: {fontSize: 13, fontWeight: '700', color: '#ffffff'},
  // #7/#8 (user 2026-07-25): the row-end action cluster — badges · +Add ·
  // Export · Sync — vertically centred, all buttons the same height.
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 6,
  },
  agentBadge: {
    borderWidth: 1.5,
    borderColor: '#000000',
    borderRadius: 7,
    paddingHorizontal: 8,
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentBadgeArm: {backgroundColor: '#000000'},
  agentBadgeText: {fontSize: 13, fontWeight: '700', color: '#000000'},
  aChip: {
    borderWidth: 1.5,
    borderColor: '#000000',
    borderRadius: 7,
    paddingHorizontal: 8,
    minHeight: 30,
    justifyContent: 'center',
  },
  aChipOn: {backgroundColor: '#000000'},
  aChipText: {fontSize: 11, fontWeight: '700', color: '#000000'},
  aChipOnText: {color: '#ffffff'},
  aChipInh: {borderStyle: 'dotted'},
  aChipInhText: {fontSize: 11, fontWeight: '600', color: '#666666'},
  libStatus: {fontSize: 11, fontWeight: '700', minWidth: 52, textAlign: 'right'},
  stOk: {color: '#000000'},
  // v0.80.0 (audit L4): pending is BOLDER than done — weight is the e-ink
  // signal (the two used to be pixel-identical).
  stPend: {color: '#000000', fontWeight: '800'},
  // OCR read, Vision still owed (one tick): a middle state — darker than done,
  // lighter than a paid-read backlog.
  stOcr: {color: '#555555', fontWeight: '600'},
  stOff: {color: '#aaaaaa'},
});
export default LibraryScreen;
