/**
 * ChatPanel — the SmartNote AI assistant, rendered inside the floating
 * overlay (Bubble.tsx). Chat only: settings live in the full-screen
 * config page (App.tsx); the ⚙ button here just re-opens it. Thin glue
 * over the tested CORE (src/core/*) + capture/settings (src/native/*).
 *
 * Context is sent lazily: the page image + transcription go out only
 * when they're not already in the conversation ("page will be sent"),
 * i.e. the first message, or after a Refresh / page / scope change. The
 * indicator shows which state you're in.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {makeStyles} from './panelStyles';
import {OffGateDialog, AgentGapsDialog, EstimateDialog} from './PanelDialogs';
import {BrainDropdown, type BrainEntry} from './BrainDropdown';
import {TurnBubble} from './TurnBubble';
import {
  ContextSheet,
  LassoPopup,
  AddedPagesPopup,
  AddedTranscriptSheet,
  HistorySheet,
} from './PanelSheets';
import {
  DeviceEventEmitter,
  Image,
  NativeModules,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';

import {DEFAULT_MODEL} from './src/core/config/keyFile';
import {sendChat} from './src/core/model/mistral';
import type {ChatTurn, ModelConfig} from './src/core/model/types';
import {styleTemperature, DEFAULT_CHAT_MAX_TOKENS} from './src/core/model/types';
import {modelSupportsTools} from './src/native/modelCaps';
import {
  composeAddedText,
  stripContextBlocks,
  NO_LIVE_TOOLS_LINE,
  WEB_TOOL_LINE,
  type AddedBlock,
} from './src/core/convo/compose';
import {
  resolveQuickActions,
  type QuickActionItem,
} from './src/core/actions/quickActions';
import {
  pagesForContext,
  type ContextMode,
} from './src/core/convo/composeContext';
import {readSettings, subscribeSettings} from './src/native/settings';
import {setNavIntent} from './src/native/navIntent';
import {setLibTargetIntent} from './src/native/libTargetIntent';
import {effectiveMode} from './src/core/store/autoEngine';
import {getApiKey} from './src/native/secureKey';
import {
  sendConversation,
  type ConnectorTool,
} from './src/core/model/conversations';
import {fetchAdapter} from './src/native/fetchAdapter';
import {captureCurrent} from './src/native/capture';
import {captureBridge} from './src/native/captureBridge';
import SearchOverlay, {ctxKeyOf} from './SearchOverlay';
import type {SearchHit} from './src/core/store/librarySearch';
import MarkdownView from './MarkdownView';
import {consumeLassoSeed, subscribeLassoSeed} from './src/native/lassoSeed';
import {
  consumeChatCtxSeed,
  subscribeChatCtxSeed,
} from './src/native/chatCtxSeed';
import {
  getCurrentCapture,
  setCurrentCapture,
  subscribeCapture,
} from './src/native/currentCapture';
import type {PageCapture} from './src/native/capture';
import {
  isNotePath,
  pageStamp,
  pageTextsFromStore,
  readNotePages,
  readPdf,
  readPdfPageVision,
  syncNotePages,
  upsertTranscript,
  isOffForRead,
} from './src/native/reading';
import {
  loadStore,
  subscribeStore,
  canPersistDoc,
  STORAGE_UNAVAILABLE_MSG,
} from './src/native/transcriptStoreIo';
import {isPageLocked} from './src/core/store/transcriptStore';
import {
  docsSummary,
  getPage,
  provenanceFor,
  type TranscriptSource,
} from './src/core/store/transcriptStore';
import {
  composeAgentDocsSection,
  resolveAgentDocs,
  resolveAgentDocPages,
  DEFAULT_LASSO_DIRECTIVE,
  DEFAULT_IMAGE_QUICK_ACTIONS,
  type Agent,
  type AgentDocBlock,
} from './src/core/agents/agents';
import {FULL_PAGE_READ_CENTS} from './src/core/model/reader';
import {OCR_COST_CENTS} from './src/core/model/ocr';
import {SRC_LABEL, fmtDay, fmtDateTime, baseName, srcLabelFor, srcLongFor} from './src/ui/labels';
import {useArmedConfirm} from './src/ui/useArmedConfirm';
import {gatherContext, parseScope} from './src/native/gatherContext';
import {invalidateNoteCache} from './src/native/noteTranscripts';
import {modelLacksTools} from './src/core/model/catalog';
import {
  assembleVisionPrompt,
  assemblePdfVisionPrompt,
} from './src/core/model/visionPrompt';
import {
  listConversations,
  loadConversation,
  saveConversation,
  deleteConversation,
  titleFor,
  type ConvMeta,
} from './src/native/conversationStore';
import {pokeAuto, setForegroundBusy} from './src/native/autoTranscript';

const {SmartNoteAiOverlay} = NativeModules;

// Overlay focus toggle (v0.70, gesture-bug fix): the panel window opens
// NON-FOCUSABLE so it can never hold the system input focus (which broke
// the note app's 2-finger lasso). A TextInput needs a focusable window
// for the keyboard, so we flip it focusable on touch-DOWN (before RN
// tries to focus, else the tap can't focus a non-focusable window) and
// back on blur. Best-effort: a missing method (old binary) is a no-op.
const setPanelFocusable = (focusable: boolean): void => {
  try {
    (
      SmartNoteAiOverlay as {setPanelFocusable?: (f: boolean) => void}
    )?.setPanelFocusable?.(focusable);
  } catch {
    // best-effort
  }
};
// v0.81: compact model id for the brain dropdown ("mistral-medium-latest"
// → "medium"). Same rule as door 3's shortModel.
const shortModelId = (id: string): string =>
  (id.trim() || DEFAULT_MODEL).replace(/^mistral-|-latest$/g, '');

// v0.20.1: max_tokens is no longer a user setting — sane internal
// defaults (chat answers here; the reading engine has its own).

type KeyState =
  | {kind: 'loading'}
  | {kind: 'missing'}
  | {kind: 'ok'; config: ModelConfig};

// A fresh conversation id for prompt caching (no sensitive data in it).
const makeConvId = (): string =>
  `smna-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// Hiding the appended context block(s) from the user's own bubble moved
// to compose.ts (stripContextBlocks, v0.54) — it now also covers the
// "--- Added:" search blocks.

// What the conversation store is allowed to persist: ephemeral turns (an
// Off-file read) get their transcript block redacted — the promise is
// "read once, DON'T save". The in-memory conversation keeps the full text.
const redactForSave = (list: ChatTurn[]): ChatTurn[] =>
  list.map(t => {
    // Base64 images (lasso crops) are transient — never persist them to
    // the conversation history (bloat + they can't be re-shown usefully).
    const base = t.images !== undefined ? {...t, images: undefined} : t;
    return base.ephemeral === true
      ? {
          ...base,
          text:
            stripContextBlocks(base.text) +
            '\n\n(Off file: the page transcript was not saved.)',
        }
      : base;
  });

// isOfflineReason moved to gatherContext.ts (phase 4).

// eslint-disable-next-line @typescript-eslint/no-var-requires
const IC = {
  settings: require('./assets/ic-settings.png'),
  default: require('./assets/ic-default.png'),
  snaptop: require('./assets/ic-snaptop.png'),
  snapbottom: require('./assets/ic-snapbottom.png'),
  snapleft: require('./assets/ic-snapleft.png'),
  snapright: require('./assets/ic-snapright.png'),
  fullscreen: require('./assets/ic-fullscreen.png'),
  collapse: require('./assets/ic-collapse.png'),
  close: require('./assets/ic-close.png'),
  // Mistral monochrome icon (official 2026 pack) — the "ask the AI"
  // send button (white on the inverted button). Referential use: the
  // button literally sends to Mistral.
  mistralW: require('./assets/ic-mistral-white.png'),
};

function IconBtn({
  src,
  onPress,
  disabled,
}: {
  src: number;
  onPress: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled === true}
      style={[iconStyles.iconBtn, disabled === true && iconStyles.iconBtnOff]}
      // v0.80.0 (audit M6): horizontal slop too — the header icons are
      // ~20-28 px targets packed tight; finger taps in a narrow black bar
      // need every pixel they can get.
      hitSlop={{top: 8, bottom: 8, left: 6, right: 6}}>
      <Image source={src} style={iconStyles.icon} resizeMode="contain" />
    </TouchableOpacity>
  );
}

export type SnapKind = 'default' | 'top' | 'bottom' | 'left' | 'right' | 'full';

type Props = {
  onClose: () => void;
  onCollapse: () => void;
  onSnap: (kind: SnapKind) => void;
  // v0.85: switch the overlay back to the hub menu (replaces the old Lib /
  // Settings header buttons). Absent = no menu button (legacy callers).
  onMenu?: () => void;
  // When collapsed, the panel renders nothing heavy (just an empty view)
  // so the small floating bubble is light to drag — but the component
  // stays mounted, so the conversation state survives collapse/restore.
  collapsed: boolean;
  headerHandlers?: object;
};

export default function ChatPanel({
  onClose,
  onCollapse,
  onSnap,
  onMenu,
  collapsed,
  headerHandlers,
}: Props): React.JSX.Element {
  // Belt-and-braces (v0.70.4): the collapsed bubble is a pure button — it
  // must NEVER be focusable (a focusable overlay holds the system input
  // focus and breaks the note app's 2-finger lasso). The TextInputs flip
  // the window focusable while typing; if the panel collapses before the
  // input blurs, that flag could linger — so force it back off whenever
  // we go to the bubble. The window also opens non-focusable by default.
  React.useEffect(() => {
    if (collapsed) {
      setPanelFocusable(false);
    }
  }, [collapsed]);

  // v0.54: the Chat/Search tabs are gone — ONE input field, two exits.
  // 🔍 arms the search mode (live results overlay over the conversation
  // area); send exits it and sends the text as a chat message.
  const [searchOn, setSearchOn] = useState<boolean>(false);
  // "Add to CHAT" (v0.54, semantics v0.54.1 — user decision): pages
  // picked from the search overlay. Unsent entries ride as labelled
  // blocks with the NEXT message (free — store text); once sent they are
  // MARKED sent and stay listed for the whole conversation (the blocks
  // live in the history, re-sent every turn at the cached −90% rate —
  // never re-composed). Persisted with the conversation.
  const [pendingCtx, setPendingCtx] = useState<
    {path: string; page: number; sent?: boolean}[]
  >([]);
  // ctxKey of the META hit being paid-read by "Read & add" ('' = none).
  const [readingKey, setReadingKey] = useState<string | null>(null);
  // v0.54 panel simplification: the permanent chrome shrank to 3 rows —
  // what used to be rows lives in sheets/popovers now.
  const [ctxOpen, setCtxOpen] = useState<boolean>(false); // context sheet
  // fix #8: the user can drop the CURRENT captured page from the context
  // (e.g. lasso a new page then ask about something unrelated). Reset on a
  // new capture so a fresh page is included by default.
  const [ctxPageOff, setCtxPageOff] = useState<boolean>(false);
  const [brainOpen, setBrainOpen] = useState<boolean>(false); // brain dropdown
  const [snapOpen, setSnapOpen] = useState<boolean>(false); // ▢▾ snaps
  // v0.55 AI Agents: the configured agents, the one this conversation
  // talks to (null = standard Chat; chosen on the START CARD only), and
  // per-agent doc stats for the card ("42 p · 3 not synced").
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);
  // v0.81 lasso mode: the "there is an image" directive (from settings) +
  // the image quick actions (shown only when an image is in context). Read
  // fresh in send(); these mounted copies just mirror config edits.
  const [lassoDirective, setLassoDirective] = useState<string>(
    DEFAULT_LASSO_DIRECTIVE,
  );
  const [imageQuickActions, setImageQuickActions] = useState<QuickActionItem[]>(
    DEFAULT_IMAGE_QUICK_ACTIONS,
  );
  const [agentStats, setAgentStats] = useState<
    Map<string, {docs: number; read: number; unread: number; unreadPdf: number}>
  >(new Map());
  // Gaps dialog at agent selection: unread pages can be read NOW (paid),
  // or the agent starts with what the store has.
  const [agentGapAsk, setAgentGapAsk] = useState<{
    agent: Agent;
    unread: number;
    euros: string;
  } | null>(null);
  const [keyState, setKeyState] = useState<KeyState>({kind: 'loading'});
  const [model, setModel] = useState<string>('');
  // `persona` state is GONE (v0.64): send() reads it fresh from settings
  // since P1 — nothing displayed it any more.
  const [scale, setScale] = useState<number>(1.15);
  const [btnScale, setBtnScale] = useState<number>(1.25);
  // Styles rebuilt only when the user changes the text/button size.
  const styles = useMemo(() => makeStyles(scale, btnScale), [scale, btnScale]);
  // Safety: never leave the Auto drain paused if the panel unmounts mid-send.
  // Release on unmount ONLY the hold this panel is currently holding
  // (review 2026-08-01 #7: an unconditional release decremented a refcount
  // owned by another caller and un-paused the drain mid-request).
  // Resolve a freshly added lasso image's Off status (see the seed's
  // pessimistic default above) so a non-Off image becomes persistable.
  const resolveImageOff = useCallback(async (id: string, src?: string) => {
    if (src === undefined || src.length === 0) {
      // Release audit 2026-08-12 (N1, privacy fail-open): a crop whose source
      // path could not be captured (a transient getCurrentFilePath failure) has
      // UNKNOWN provenance — it may be from an Off note. Stay pessimistic
      // (off:true) so it is never persisted, and the send graft drops it: we
      // must not send onward what we cannot verify. (Was off:false = sent +
      // persisted with no consent.)
      setCtxImages(cur => cur.map(c => (c.id === id ? {...c, off: true} : c)));
      return;
    }
    try {
      // isOffForRead, not raw effectiveMode, so a renamed Off note is caught (K1).
      const off = await isOffForRead(src);
      setCtxImages(cur => cur.map(c => (c.id === id ? {...c, off} : c)));
    } catch {
      // settings unreadable: stay pessimistic (not persisted)
    }
  }, []);

  const fgHeld = useRef(false);
  const holdForeground = useCallback((on: boolean) => {
    if (on === fgHeld.current) {
      return;
    }
    fgHeld.current = on;
    setForegroundBusy(on);
  }, []);
  useEffect(
    () => () => {
      if (fgHeld.current) {
        fgHeld.current = false;
        setForegroundBusy(false);
      }
    },
    [],
  );
  // v0.20 read-flow settings: which engine reads .note pages, and the
  // user's OCR persona (decipher help) fed to it.
  // Files the user consented to read ephemerally in THIS conversation.
  const offConsentedRef = useRef<Set<string>>(new Set());
  // v0.21 connector toggles (config): when one is ON the chat rides the
  // Conversations API and the model may search / run code on its own.
  // ONE-SHOT connector arming (v0.50, user decision): armed = THIS
  // message goes through the Conversations API with the connector(s);
  // reset to OFF after the send attempt (success or failure). The steady
  // state is plain chat completions — which keeps prompt caching (the
  // sticky toggles routed EVERY turn through Conversations, which has no
  // prompt_cache_key: the whole cached-prefix discount was lost).
  const [armWeb, setArmWeb] = useState<boolean>(false);
  // Live tools capability of the chosen model (modelCaps): undefined =
  // unknown/offline → static modelLacksTools fallback.
  const [liveTools, setLiveTools] = useState<boolean | undefined>(undefined);
  const [quickActions, setQuickActions] = useState<QuickActionItem[]>(() =>
    resolveQuickActions(),
  );
  const [cap, setCap] = useState<PageCapture | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  // Lasso → chat (v0.81): cropped selection PNGs (base64) are PERSISTENT
  // context — each a removable chip in the "Chat context:" row, several
  // allowed. They graft onto the outgoing user turn every send (so the
  // model always sees them) until the user removes their ✕; stored with the
  // conversation (a Resume restores them). Turns themselves stay text-only.
  // `src`: the file the image was lassoed from (Off gate); `off`: proved Off
  // at send time, so the save path can keep it off disk (full review #2).
  const [ctxImages, setCtxImages] = useState<
    {id: string; image: string; src?: string; off?: boolean}[]
  >([]);
  const imgIdRef = useRef(0);
  const [input, setInput] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [ctxMode, setCtxMode] = useState<ContextMode>('page');
  const [rangeStart, setRangeStart] = useState<string>('1');
  const [rangeEnd, setRangeEnd] = useState<string>('1');
  // label distinguishes the phases of an image_text request ("rendering"
  // then "reading") — without it the counter visibly runs 0..N twice.
  const [progress, setProgress] = useState<{
    label: string;
    done: number;
    total: number;
  } | null>(null);
  // Whether the current page context is already in the conversation.
  const [contextSent, setContextSent] = useState<boolean>(false);
  // The actual model version the API served (resolves 'latest' aliases).
  const [resolvedModel, setResolvedModel] = useState<string>('');
  const [refreshing, setRefreshing] = useState<boolean>(false);
  // Scroll anchoring: after a send, keep the user's last message at the
  // top of the viewport (clamped to the end) so the answer reads from
  // the top. Cleared when the user scrolls manually.
  const scrollRef = useRef<ScrollView>(null);
  const turnY = useRef<Record<number, number>>({});
  const anchorIdx = useRef<number | null>(null);
  const vpH = useRef(0);
  // Last page index we reacted to (to avoid re-capturing the same page).
  const lastSeenPage = useRef<number | null>(null);
  // Latest capture, readable from inside async closures (send runs across
  // awaits; the `cap` it closed over can go stale meanwhile).
  const capRef = useRef<PageCapture | null>(null);
  capRef.current = cap;
  // busy, readable from stable callbacks (onResume keeps its [] deps).
  const busyRef = useRef(false);
  busyRef.current = busy;
  // Stop support: the ⏹ button aborts the in-flight HTTP request and makes
  // the gather loops bail at the next page boundary.
  const abortRef = useRef<AbortController | null>(null);
  const stopRequested = useRef(false);
  // Stable per-conversation id → Mistral prompt caching (New chat rotates
  // it). The shared prefix (system + page image + earlier turns) then
  // bills at 10% on follow-up questions.
  const convId = useRef(makeConvId());
  const [lastUsage, setLastUsage] = useState<{
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
  } | null>(null);
  // v0.20 read-flow UI: big-read confirmation dialog (pauses a send;
  // pendingRef resumes it), the Transcript sheet, the provenance chip,
  // and the offline banner. The cloud-consent dialog was REMOVED
  // (user decision 2026-07-19 — its accidental reset starved Auto).
  // OFF privacy gate: a file/folder set to Off is excluded from the AI;
  // reading it for a chat answer needs one-shot consent and is discarded.
  const [offAsk, setOffAsk] = useState<{doc: string; path: string} | null>(
    null,
  );
  const [estimateAsk, setEstimateAsk] = useState<{
    count: number;
    euros: string;
    upTo?: number;
    eurosUpTo?: string;
  } | null>(null);
  const pendingRef = useRef<{
    text: string;
    skipEstimate?: boolean;
  } | null>(null);
  const [offline, setOffline] = useState<string>('');
  const [voletOpen, setVoletOpen] = useState<boolean>(false);
  // v0.88.4 (user spec, artifact-validated): ONE popup per context chip.
  const [lassoView, setLassoView] = useState<string | null>(null);
  const [addedOpen, setAddedOpen] = useState<boolean>(false);
  const [addedVolet, setAddedVolet] = useState<{
    title: string;
    text: string;
  } | null>(null);
  // v0.52 (user design): an Off file's sheet says WHY there is no
  // transcript and disables the paid button instead of showing buttons
  // that silently do nothing (the reading-layer gate refuses them).
  const [voletOff, setVoletOff] = useState<boolean>(false);
  const [voletEntry, setVoletEntry] = useState<{
    text: string;
    label: string;
    source?: TranscriptSource;
  } | null>(null);
  const [rereading, setRereading] = useState<boolean>(false);
  // v0.80.0 (audit M2): lets the transcript sheet STOP a paid re-read.
  const rereadAbortRef = useRef<AbortController | null>(null);
  // "Edit" (v0.21): in-place manual correction → source 'user'.
  const [voletEditing, setVoletEditing] = useState<boolean>(false);
  const [voletDraft, setVoletDraft] = useState<string>('');
  // One-tap-confirm guards (shared hook, phase 4 §2.1): overwriting a
  // manual ('user') entry, and deleting a conversation from the history.
  const {armed: confirmOverwrite, confirm: confirmOv, disarm: disarmOv} =
    useArmedConfirm(4000);
  // Historique (v0.21): list sheet + resume bookkeeping.
  const [histOpen, setHistOpen] = useState<boolean>(false);
  const [histList, setHistList] = useState<ConvMeta[]>([]);
  const {armed: confirmDelId, confirm: confirmDel, disarm: disarmDel} =
    useArmedConfirm(3000);
  // Origin note of a RESUMED conversation when it differs from the page
  // on screen ("↩ born on X", decided U4). '' = no reminder.
  const [bornOn, setBornOn] = useState<string>('');
  const convCreatedAt = useRef<number>(Date.now());
  // v0.88.4: the provenance label no longer renders (the button says "See
  // transcript") — the state keeps feeding the transcript sheet header only.
  const [, setChip] = useState<{label: string; sub?: string}>({
    label: 'none',
  });
  // (The lazy page thumbnail is GONE in v0.54 — it previewed the page
  // already visible behind the floating window, and its generateNotePng
  // renders were what starved the device in the v0.42.1 episode.)
  // Bumped on every store mutation → chip + open sheet re-derive.
  const [provTick, setProvTick] = useState<number>(0);
  // Bumped on every settings write (re-audit 2026-07-19 P2): the panel
  // and the config share one JS runtime, so an agent created/edited in
  // the config while the panel stays mounted re-triggers the start-card
  // read below — the original "the chat offers no agents" device
  // symptom had no such trigger and could recur.
  const [settingsTick, setSettingsTick] = useState<number>(0);
  // Burst throttle for BOTH tick subscriptions (perf audit 2026-07-20):
  // an Auto tick stores up to 100 pages and writes settings per synced
  // note — un-throttled, every one re-rendered the whole panel (the
  // historic "nothing is fluid during a background job"). Leading edge
  // fires immediately; bursts then mark a dirty flag that the NATIVE
  // heartbeat flushes (~2.5 s). No setTimeout here on purpose: the
  // panel's JS timers are frozen while only the overlay is alive, a
  // timer-based debounce would starve the trailing update exactly when
  // background jobs run.
  const TICK_GAP_MS = 1500;
  const lastStoreTickAt = useRef<number>(0);
  const storeDirty = useRef<boolean>(false);
  const lastSettingsTickAt = useRef<number>(0);
  const settingsDirty = useRef<boolean>(false);
  useEffect(
    () =>
      subscribeSettings(() => {
        if (Date.now() - lastSettingsTickAt.current > TICK_GAP_MS) {
          lastSettingsTickAt.current = Date.now();
          setSettingsTick(t => t + 1);
        } else {
          settingsDirty.current = true;
        }
      }),
    [],
  );
  // v0.81: mirror the lasso config (directive + image quick actions). An
  // EMPTY directive is meaningful (send nothing) — only `undefined` falls
  // back to the shipped default.
  const applyLassoSettings = useCallback(
    (saved: {
      lassoDirective?: string;
      imageQuickActions?: QuickActionItem[];
    }): void => {
      setLassoDirective(
        typeof saved.lassoDirective === 'string'
          ? saved.lassoDirective
          : DEFAULT_LASSO_DIRECTIVE,
      );
      setImageQuickActions(
        // Review 2026-08-01 #9: an explicitly emptied list must stay empty
        // here too. Only an ABSENT field means "use the defaults".
        saved.imageQuickActions !== undefined
          ? saved.imageQuickActions
          : DEFAULT_IMAGE_QUICK_ACTIONS(),
      );
    },
    [],
  );
  // Display state follows settings edits made while the panel stays
  // mounted (re-audit P1): status line, ⚡ chips. Billing never relies on
  // this — send() re-reads settings itself.
  useEffect(() => {
    if (settingsTick === 0) {
      return;
    }
    let alive = true;
    (async () => {
      const saved = await readSettings();
      if (!alive) {
        return;
      }
      const m = saved.model || DEFAULT_MODEL;
      setModel(prev => (prev === m ? prev : m));
      setQuickActions(resolveQuickActions(saved.quickActions));
      applyLassoSettings(saved);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [settingsTick]);
  useEffect(
    () =>
      subscribeStore(() => {
        if (Date.now() - lastStoreTickAt.current > TICK_GAP_MS) {
          lastStoreTickAt.current = Date.now();
          setProvTick(t => t + 1);
        } else {
          storeDirty.current = true;
        }
      }),
    [],
  );

  // Start-card data: agents re-read from settings + per-agent doc stats
  // ("42 p read · 3 not synced"). The agents are re-read EVERY time the
  // card is (re)shown — the panel can outlive a config visit (the
  // overlay window is static), and the mount-time copy missed agents
  // created after it (device report 2026-07-19: "the chat offers no
  // agents"). Free: one settings read + the in-memory store.
  useEffect(() => {
    if (turns.length > 0) {
      return;
    }
    let alive = true;
    (async () => {
      const saved = await readSettings();
      const fresh = saved.agents ?? [];
      const store = await loadStore();
      const lib = docsSummary(store);
      if (!alive) {
        return;
      }
      setAgents(prev =>
        JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh,
      );
      applyLassoSettings(saved);
      const m = new Map<
        string,
        {docs: number; read: number; unread: number; unreadPdf: number}
      >();
      const targets = saved.autoTargets ?? {};
      for (const a of fresh) {
        // Off docs excluded here too (audit 2026-07-19 #5): the gaps
        // dialog estimated pages the read loop would then skip — wrong
        // euros and a progress bar that could never complete.
        const paths = resolveAgentDocs(
          a.docs,
          lib.map(d => d.path),
        ).filter(p => effectiveMode(targets, p) !== 'off');
        let read = 0;
        let unread = 0;
        // PDF pages are billed OCR-only on the gap read (skipVision — agent
        // reads never pay Vision, 2026-08-16), so the euros quote needs the
        // split.
        let unreadPdf = 0;
        for (const p of paths) {
          const d = lib.find(x => x.path === p);
          if (d) {
            read += d.read;
            if (d.pdfCovered) {
              continue; // whole PDF already covered
            }
            const u = Math.max(0, d.total - d.read);
            unread += u;
            if (/\.pdf$/i.test(p)) {
              unreadPdf += u;
            }
          }
        }
        // N3 (2026-08-12): pages PINNED to the agent (a.docPages) ride with and
        // are billed on every question, so they belong in "knows X doc(s) · Y
        // page(s)". Count pages NOT already covered by a whole doc above; a
        // pinned page with stored text is "read". Off docs stay excluded.
        const wholeDocs = new Set(paths);
        let pinnedDocs = 0;
        for (const [p, pgs] of Object.entries(a.docPages ?? {})) {
          if (wholeDocs.has(p) || effectiveMode(targets, p) === 'off') {
            continue;
          }
          // Store-presence guard (re-audit 2026-08-12): the send composes only
          // pages of docs still in the store; a pin to a purged doc is dropped
          // there, so it must not inflate the stats here either.
          if (store.docs[p] === undefined) {
            continue;
          }
          pinnedDocs++;
          // pdfCovered guard (regression audit 2026-08-12): a covered PDF's
          // pages have no per-page entry, so getPage===null must NOT count them
          // as unread (they are OCR-covered).
          const covered = lib.find(x => x.path === p)?.pdfCovered === true;
          for (const pg of pgs) {
            const e = getPage(store, p, pg);
            if (covered || (e !== null && e.text.trim().length > 0)) {
              read++;
            } else {
              unread++;
              if (/\.pdf$/i.test(p)) {
                unreadPdf++;
              }
            }
          }
        }
        m.set(a.id, {docs: paths.length + pinnedDocs, read, unread, unreadPdf});
      }
      setAgentStats(m);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [turns.length, provTick, settingsTick]);

  // C2 (audit 2026-07-18): the vision prompt is assembled from FRESH
  // settings at every use — a mount-time copy went stale when the user
  // edited the prompt blocks while the panel stayed mounted.
  const freshVisionSystem = async (): Promise<string> =>
    assembleVisionPrompt((await readSettings()).promptBlocks);
  // PDF escalations get the neutral document variant (an escalated PDF
  // page is often hard PRINT, not handwriting — 2026-07-18).
  const freshPdfVisionSystem = async (): Promise<string> =>
    assemblePdfVisionPrompt((await readSettings()).promptBlocks);

  const load = useCallback(async () => {
    const [ks, saved] = await Promise.all([getApiKey(), readSettings()]);
    setAgents(saved.agents ?? []);
    applyLassoSettings(saved);
    if (saved.textScale) {
      setScale(saved.textScale);
    }
    if (saved.buttonScale) {
      setBtnScale(saved.buttonScale);
    }
    setQuickActions(resolveQuickActions(saved.quickActions));
    if (ks.key === null) {
      setKeyState({kind: 'missing'});
      return;
    }
    const m = saved.model || DEFAULT_MODEL;
    setKeyState({
      kind: 'ok',
      config: {apiKey: ks.key, model: m, maxTokens: DEFAULT_CHAT_MAX_TOKENS},
    });
    setModel(m);
  }, []);

  const refreshCapture = useCallback(() => {
    getCurrentCapture()
      .then(setCap)
      .catch(() => setCap(null));
  }, []);

  useEffect(() => {
    load();
    getCurrentCapture()
      .then(setCap)
      .catch(() => setCap(null));
    const off = subscribeCapture(refreshCapture);
    return off;
  }, [load, refreshCapture]);

  // "Transcript always": the ONE scheduler (started in index.js) owns the
  // periodic tick — opening the panel just pokes it for a catch-up pass.
  useEffect(() => {
    pokeAuto('panel-open');
  }, []);

  // New page → default the range to it and track its structure. We do NOT
  // seed the device's on-screen OCR any more (v0.32, single engine): nothing
  // is read/shown until you ask (Manual) or it is transcribed in the
  // background (Auto), and an Off page shows nothing at all.
  useEffect(() => {
    if (cap) {
      // Range inputs are shown 1-indexed (human page numbers).
      setRangeStart(String(cap.page + 1));
      setRangeEnd(String(cap.page + 1));
      // Structural tracking only (page list): new/deleted pages are followed
      // without any read. No text baseline.
      if (isNotePath(cap.notePath)) {
        syncNotePages(captureBridge(), cap.notePath).catch(() => {});
      }
    }
  }, [cap]);

  // Provenance chip: what the analysis would read for the CURRENT
  // context selection — single page → source + date, multi-page →
  // aggregate ("MED 38 · — 5", decided U1).
  useEffect(() => {
    let alive = true;
    (async () => {
      if (cap === null) {
        if (alive) {
          setChip({label: 'none'});
        }
        return;
      }
      const store = await loadStore();
      const pages = pagesForContext(ctxMode, cap.page, cap.totalPages, {
        start: (parseInt(rangeStart, 10) || 1) - 1,
        end: (parseInt(rangeEnd, 10) || 1) - 1,
      });
      if (!alive) {
        return;
      }
      if (pages.length === 1) {
        const e = getPage(store, cap.notePath, pages[0]);
        if (e !== null && e.text.trim().length > 0) {
          setChip({label: srcLabelFor(e), sub: fmtDay(e.at)});
        } else {
          setChip({label: 'none'});
        }
      } else {
        const prov = provenanceFor(store, cap.notePath, pages);
        const parts = (
          Object.entries(prov.covered) as [TranscriptSource, number][]
        ).map(([s, n]) => `${SRC_LABEL[s]} ${n}`);
        if (prov.missing > 0) {
          parts.push(`unread ${prov.missing}`);
        }
        setChip({label: parts.join(' · ') || 'none'});
      }
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [cap, ctxMode, rangeStart, rangeEnd, provTick]);

  // Transcript sheet content (derived when open; follows store changes
  // so a Re-read refreshes it in place).
  useEffect(() => {
    if (!voletOpen || cap === null) {
      return;
    }
    let alive = true;
    (async () => {
      await syncNotePages(captureBridge(), cap.notePath).catch(() => {});
      const store = await loadStore();
      if (!alive) {
        return;
      }
      // Scope-aware (device feedback): on Range / Whole note the sheet
      // shows EVERY page of the scope, each under its own header.
      const pages = pagesForContext(ctxMode, cap.page, cap.totalPages, {
        start: (parseInt(rangeStart, 10) || 1) - 1,
        end: (parseInt(rangeEnd, 10) || 1) - 1,
      });
      if (pages.length > 1) {
        const sections = pages.map(p => {
          const e = getPage(store, cap.notePath, p);
          const head =
            e !== null && e.text.trim().length > 0
              ? `[ p.${p + 1} · ${srcLongFor(e)} · ${fmtDay(e.at)} ]`
              : `[ p.${p + 1} · not read yet ]`;
          return `${head}\n${e?.text ?? ''}`.trim();
        });
        const read = pages.filter(p => {
          const e = getPage(store, cap.notePath, p);
          return e !== null && e.text.trim().length > 0;
        }).length;
        setVoletEntry({
          text: sections.join('\n\n'),
          label: `${ctxMode === 'note' ? 'whole note' : 'range'} · ${read}/${pages.length} pages read`,
        });
        return;
      }
      const e = getPage(store, cap.notePath, pages[0] ?? cap.page);
      if (e !== null && e.text.trim().length > 0) {
        setVoletEntry({
          text: e.text,
          // fmtDateTime (v0.53, user request: the hour matters too).
          label: `${srcLongFor(e)} · ${fmtDateTime(e.at)}`,
          source: e.source,
        });
      } else {
        setVoletEntry({text: '', label: 'no transcript yet'});
      }
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [voletOpen, cap, ctxMode, rangeStart, rangeEnd, provTick]);

  useEffect(() => {
    if (!voletOpen || cap === null) {
      return;
    }
    let alive = true;
    // isOffForRead (K1): a renamed Off note reads as Off here too, so the
    // panel does not look includable while the send gate would block it.
    isOffForRead(cap.notePath)
      .then(off => {
        if (alive) {
          setVoletOff(off);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [voletOpen, cap]);

  // Any change to what we'd send (page / scope) means the context must
  // be (re)sent on the next message. scopeRef mirrors the CURRENT scope so
  // an in-flight send can tell whether the user changed it meanwhile (a
  // response landing after a scope change must NOT mark the new scope's
  // context as sent — bug found in the 2026-07-17 audit).
  const scopeRef = useRef<string>('');
  useEffect(() => {
    scopeRef.current = `${ctxMode}|${rangeStart}|${rangeEnd}`;
    setContextSent(false);
  }, [cap, ctxMode, rangeStart, rangeEnd]);
  // fix #8: a NEW captured page is included again by default.
  useEffect(() => {
    setCtxPageOff(false);
  }, [cap]);

  const send = useCallback(
    async (
      text: string,
      flags?: {skipEstimate?: boolean},
    ) => {
      // busyRef, not the closure `busy`: two taps landing in the same frame
      // both saw busy=false in their render's closure and ran two sends that
      // corrupted each other's history (audit 2026-07-18).
      if (keyState.kind !== 'ok' || text.trim().length === 0 || busyRef.current) {
        return;
      }
      busyRef.current = true;
      setBusy(true);
      holdForeground(true); // pause the Auto drain, foreground gets priority
      // Any send exits the armed search — the conversation (and the
      // incoming answer) must be visible, not the results overlay.
      setSearchOn(false);
      stopRequested.current = false;
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const capture = cap ?? (await getCurrentCapture());
        if (capture !== null && cap === null) {
          setCap(capture);
        }
        // Stored turns are text-only (v0.81): lasso images live in ctxImages
        // and graft onto the WIRE payload only, so prior carries no images.
        const prior = turns;
        // v0.81 (user): a lasso image suppresses the auto page-context by
        // DEFAULT (ctxImages ⇒ ctxPageOff auto-set true), but the user can
        // put the page back via the existing control — so the switch is
        // ctxPageOff, not "has image". Agent docs always ride regardless.
        const includeContext =
          !contextSent && capture !== null && !ctxPageOff;
        // Note name (basename, no extension) labelling the transcripts, so
        // a conversation that spans a note switch stays unambiguous.
        const noteName = capture
          ? (capture.notePath.split('/').pop() || '').replace(
              /\.(note|pdf|epub|mark)$/i,
              '',
            )
          : '';
        const apiKey = keyState.config.apiKey;

        // Cloud consent GATE REMOVED (user decision 2026-07-19): the
        // one-time "sent to Mistral (EU)" dialog protected a single-user
        // plugin against its own key — and its accidental reset starved
        // Auto silently for an afternoon. The OFF gate below stays: that
        // one protects CONTENT, not the obvious.

        // OFF privacy gate: reading an Off file for one answer needs explicit
        // consent (once per file, per conversation); the read is ephemeral.
        // Read the modes FRESH from settings (the panel stays mounted across
        // config changes, so the loaded copy can be stale — P2).
        // Every source this send would touch: the page context AND each
        // lassoed image (full review #2 — images used to bypass the gate).
        const offPath = includeContext ? capture!.notePath : '';
        // Is the PAGE CONTEXT itself Off? (drives the ephemeral turn + the
        // reading layer's offOk); images are handled alongside, below.
        let isOff = false;
        const imgPaths = ctxImages
          .map(c => c.src ?? '')
          .filter(p2 => p2.length > 0);
        const candidates = [offPath, ...imgPaths].filter(p2 => p2.length > 0);
        let blocked: string | null = null;
        if (candidates.length > 0) {
          // isOffForRead (not a raw effectiveMode) so a renamed Off note whose
          // key was stranded is still treated as Off here (K1, 2026-08-12).
          const offList: string[] = [];
          for (const p2 of candidates) {
            if (await isOffForRead(p2)) {
              offList.push(p2);
            }
          }
          const offSet = new Set(offList);
          if (offSet.size > 0) {
            // Mark the images so the save path can strip them: an Off file
            // is never persisted, consent or not.
            setCtxImages(cur =>
              cur.map(c =>
                c.src !== undefined && offSet.has(c.src) ? {...c, off: true} : c,
              ),
            );
          }
          blocked =
            [...offSet].find(p2 => !offConsentedRef.current.has(p2)) ?? null;
          isOff = offPath.length > 0 && offSet.has(offPath);
        }
        if (blocked !== null) {
          pendingRef.current = {text};
          setOffAsk({
            doc: blocked === offPath ? noteName : blocked.split('/').pop() ?? blocked,
            path: blocked,
          });
          return;
        }

        // v0.20 READ flow: the analysis is text-only. Make the store cover
        // the selected pages, then compose the labelled transcripts.
        let userText = text;
        // Pages actually covered by the page context of THIS send (for
        // deduplicating the search-added blocks below).
        let ctxPages: number[] = [];
        // The scope this send is built for (see scopeRef above).
        const sentScope = `${ctxMode}|${rangeStart}|${rangeEnd}`;
        if (includeContext) {
          // Phase 4 §2.3: the whole context flow (big-read estimate, paid
          // reads, Off ephemeral wipe) lives in gatherContext.ts — the
          // dialogs stay here.
          const g = await gatherContext(
            captureBridge(),
            capture!,
            parseScope(ctxMode, rangeStart, rangeEnd),
            text,
            noteName,
            apiKey,
            {
              isOff,
              skipEstimate: flags?.skipEstimate === true,
              freshVisionSystem,
              freshPdfVisionSystem,
              shouldStop: () => stopRequested.current,
              signal: controller.signal,
              onProgress: (label, done, total) =>
                setProgress({label, done, total}),
            },
          );
          setProgress(null);
          if (g.kind === 'estimate') {
            pendingRef.current = {text};
            setEstimateAsk({
              count: g.count,
              euros: g.euros,
              upTo: g.upTo,
              eurosUpTo: g.eurosUpTo,
            });
            return;
          }
          if (g.kind === 'stopped') {
            return;
          }
          setOffline(g.offline);
          userText = g.userText;
          ctxPages = g.pages;
        }

        // Settings read FRESH for this send (the panel stays mounted
        // across config changes): answer style below, Off modes here.
        const sendSettings = await readSettings();
        // Keep the DISPLAY in sync with what this send actually uses
        // (audit 2026-07-19 C3): the status line and the "∅ deleted
        // agent" indicator read the mounted `agents` state, which never
        // refreshed once a conversation started — the user could watch
        // one persona/model while being billed on another.
        const freshAgents = sendSettings.agents ?? [];
        setAgents(prev =>
          JSON.stringify(prev) === JSON.stringify(freshAgents)
            ? prev
            : freshAgents,
        );
        // The DEFAULT agent (standard CHAT) gets the same freshness as
        // the real ones (re-audit 2026-07-19 P1): model/persona were
        // mount-time state, so a config edit made while the panel stayed
        // mounted billed the OLD model and sent the OLD persona — the
        // v0.59 principle "CHAT is just the default agent" applied to
        // everything except its own settings. State synced too, so the
        // status line shows what this send actually uses.
        const freshModel = sendSettings.model || DEFAULT_MODEL;
        const freshPersona = sendSettings.persona ?? '';
        setModel(prev => (prev === freshModel ? prev : freshModel));
        setQuickActions(resolveQuickActions(sendSettings.quickActions));

        // v0.55: the agent this conversation talks to (chosen on the
        // start card; null or deleted = standard Chat). Looked up in the
        // FRESH settings (audit 2026-07-19 #9: the mount-time copy
        // missed edits made in the config while the panel stayed
        // mounted). Its library docs ride in the SYSTEM prompt,
        // deterministically ordered — the byte-identical prefix is what
        // makes Mistral's prompt cache bill every follow-up at 10%. Off
        // docs are excluded (the gate wins, checked fresh at every send).
        const agent =
          agentId !== null
            ? (sendSettings.agents ?? []).find(a => a.id === agentId) ?? null
            : null;
        let agentDocsSection = '';
        if (agent !== null) {
          const targets = sendSettings.autoTargets ?? {};
          const store = await loadStore();
          const storePaths = Object.keys(store.docs);
          const agentPaths = resolveAgentDocs(agent.docs, storePaths).filter(
            p => effectiveMode(targets, p) !== 'off',
          );
          const blocks: AgentDocBlock[] = [];
          for (const p of agentPaths) {
            const name = baseName(p);
            for (const [pg, e] of Object.entries(store.docs[p]?.pages ?? {})) {
              blocks.push({
                path: p,
                name,
                page: parseInt(pg, 10),
                text: e.text,
              });
            }
          }
          // v0.75: page-scoped agent context (specific pages of a note,
          // added from the Library). Notes already pulled whole above are
          // excluded by resolveAgentDocPages; Off docs drop out here too.
          for (const {path, pages} of resolveAgentDocPages(agent, storePaths)) {
            if (effectiveMode(targets, path) === 'off') {
              continue;
            }
            const name = baseName(path);
            const pagesRec = store.docs[path]?.pages ?? {};
            for (const pg of pages) {
              const e = pagesRec[String(pg)];
              if (e !== undefined && e.text.trim().length > 0) {
                blocks.push({path, name, page: pg, text: e.text});
              }
            }
          }
          agentDocsSection = composeAgentDocsSection(blocks);
        }

        // "Add to CHAT" (v0.54.1 semantics): compose blocks for the
        // UNSENT added pages only — once sent they stay listed (marked
        // sent) for the whole conversation, their text lives in the
        // history. Docs switched to Off since the add are DROPPED (the
        // gate wins); a page the page-context above already carries is
        // just marked sent (its text is in the conversation either way).
        // v0.81: added pages ride alongside a lasso image now (no Reader
        // isolation) — the image is one more context item.
        const ctxUnsent = pendingCtx.filter(r => r.sent !== true);
        const ctxOffKeys = new Set<string>();
        const ctxSentKeys = new Set<string>();
        if (ctxUnsent.length > 0) {
          const targets = sendSettings.autoTargets ?? {};
          const blocks: AddedBlock[] = [];
          const byPath = new Map<string, number[]>();
          for (const ref of ctxUnsent) {
            const key = ctxKeyOf(ref.path, ref.page);
            if (effectiveMode(targets, ref.path) === 'off') {
              console.log(
                '[SmartNoteAI]',
                `added page dropped (now Off): ${ref.path} p.${ref.page + 1}`,
              );
              ctxOffKeys.add(key);
              continue;
            }
            if (
              includeContext &&
              capture !== null &&
              ref.path === capture.notePath &&
              ctxPages.includes(ref.page)
            ) {
              ctxSentKeys.add(key); // in the page context of this send
              continue;
            }
            byPath.set(ref.path, [...(byPath.get(ref.path) ?? []), ref.page]);
          }
          for (const [path, pgs] of byPath) {
            const texts = await pageTextsFromStore(path, pgs).catch(
              () => [] as {page: number; text: string}[],
            );
            const name = baseName(path);
            for (const t of texts) {
              // Only a page whose text ACTUALLY becomes a block is
              // marked sent (audit 2026-07-19 #3: an evicted/renamed doc
              // yielded an empty text, the block was filtered out, yet
              // the page showed "in CHAT" forever without its content
              // ever reaching Mistral). Empty ones stay pending —
              // visible and removable.
              if (t.text.trim().length > 0) {
                blocks.push({name, page: t.page, text: t.text});
                ctxSentKeys.add(ctxKeyOf(path, t.page));
              }
            }
          }
          userText = composeAddedText(userText, blocks);
        }

        // An Off-file transcript embedded in the turn is "read once, don't
        // save": flag it so the history auto-save redacts the transcript
        // block (it used to persist the full page text to disk and re-send
        // it on every Resume — audit 2026-07-18).
        // The STORED turn is text-only (v0.81). Lasso images ride only on
        // the wire (grafted onto `outgoingWire` below), so the history never
        // bloats and follow-ups don't double-send from prior turns.
        // N1 (privacy fail-open, 2026-08-12): a crop whose source path could not
        // be captured (src === '') has UNKNOWN provenance and bypassed the Off
        // consent gate above (never among `candidates`). Never send onward what
        // we cannot verify — drop it from the wire. Computed HERE (re-audit)
        // because the 🖼 marker AND the "read the image" directive must key off
        // what is ACTUALLY sent, or an empty-src capture sent a directive with
        // zero images and stored a 🖼 that could never be restored.
        const wireImages = ctxImages.filter(c => (c.src ?? '').length > 0);
        if (wireImages.length < ctxImages.length) {
          console.warn(
            '[SmartNoteAI.chat]',
            `${ctxImages.length - wireImages.length} lassoed image(s) left out ` +
              '— their source note could not be verified (privacy).',
          );
        }
        const outgoing: ChatTurn =
          isOff && includeContext
            ? {role: 'user', text: userText, ephemeral: true}
            : {role: 'user', text: userText};
        // v0.81: mark the stored turn as having carried image(s) — a light
        // 🖼 in the bubble (the images themselves stay in ctxImages, visible
        // as removable chips, and persist until the user clears them).
        if (wireImages.length > 0) {
          outgoing.hadImage = true;
        }
        setTurns([...prior, outgoing]);
        // Anchor the just-added user message (index = prior.length) to the
        // top when the answer comes in.
        anchorIdx.current = prior.length;

        const cfg: ModelConfig = {
          ...keyState.config,
          // The agent's model wins while an agent is active (its line in
          // the status bar says so); '' falls through to the FRESH chat
          // model (re-audit P1 — `model` state was mount-time).
          model:
            (agent !== null && agent.model.trim().length > 0
              ? agent.model.trim()
              : freshModel) || keyState.config.model,
        };
        // v0.75.2 (user decision): the persona is used AS-IS. An empty
        // persona sends an empty system prompt — NOT the old DEFAULT_SYSTEM
        // substituted behind the user's back. PLAIN_TEXT_RULE is gone too:
        // the panel renders Markdown.
        const baseSystem = agent !== null ? agent.persona : freshPersona;
        // v0.81 lasso: when an image is in context, append the "read the
        // image" directive (fresh from settings; EMPTY = the user chose to
        // send none). Placed AFTER persona + agent docs.
        const lassoDir =
          typeof sendSettings.lassoDirective === 'string'
            ? sendSettings.lassoDirective
            : DEFAULT_LASSO_DIRECTIVE;
        const directive =
          wireImages.length > 0 && lassoDir.trim().length > 0
            ? `\n\n${lassoDir.trim()}`
            : '';
        const system = (baseSystem + agentDocsSection + directive).trim();
        // Answer style → temperature (v0.49). 'balanced' sends nothing —
        // each model's own default applies. v0.59: the agent's own style
        // wins when set; absent = inherit the CHAT default (unification:
        // the standard chat is just the default agent).
        const styleTemp = styleTemperature(
          agent?.answerStyle ?? sendSettings.answerStyle ?? 'balanced',
        );
        // v0.81: graft the persistent lasso images onto the OUTGOING turn
        // for the wire only (stored turns stay text-only). They ride EVERY
        // send until the user removes their chips. `wireImages` (computed above)
        // already excludes the unverifiable empty-src crops.
        const outgoingWire: ChatTurn =
          wireImages.length > 0
            ? {...outgoing, images: wireImages.map(c => c.image)}
            : outgoing;
        // One-shot connectors ARMED → this message goes through the
        // Conversations API; otherwise plain chat completions (cheaper:
        // prompt caching — Conversations has no prompt_cache_key). The
        // history is fully client-side (store:false both sides), so
        // switching endpoint mid-conversation loses nothing, and the
        // cache re-matches the append-only prefix on the next plain turn.
        const tools: ConnectorTool[] = modelLacksTools(cfg.model)
          ? []
          : [...(armWeb ? (['web_search'] as const) : [])];
        const chatReq = {
          // Anti-confabulation (the Madrid incident, 2026-08-16): tell the
          // model — from the SAME condition that builds tools[] — whether a
          // live tool exists for this message. The unarmed line is constant,
          // so the completions prompt-cache prefix still matches.
          system:
            system + (tools.length > 0 ? WEB_TOOL_LINE : NO_LIVE_TOOLS_LINE),
          // Local "⚠ …" failure bubbles stay OUT of what the model sees
          // (audit 2026-07-19 A4) — they are UI state, not conversation.
          turns: [...prior, outgoingWire].filter(t => t.error !== true),
          maxTokens: keyState.config.maxTokens,
          cacheKey: convId.current,
          ...(styleTemp !== undefined ? {temperature: styleTemp} : {}),
        };
        let r;
        let sources: {title: string; url: string}[] = [];
        let webUsed = false;
        // v0.80.0 (audit): the outer 90 s self-abort is gone — mistralRequest
        // enforces its own 60 s per-attempt timeout (with an honest "Request
        // timed out" message), which always fired first anyway. The manual
        // ⏹ Stop abort (controller) is untouched.
        try {
          if (tools.length > 0) {
            const cr = await sendConversation(
              fetchAdapter,
              cfg.apiKey,
              cfg.model,
              tools,
              chatReq,
              controller.signal,
            );
            if (cr.ok) {
              sources = cr.sources;
              if (cr.toolsUsed.length > 0) {
                console.log(
                  '[SmartNoteAI]',
                  `connectors used: ${cr.toolsUsed.join(', ')}`,
                );
              }
              // 🌐 badge (2026-08-16): only a turn produced by a REAL web
              // run gets the marker — the prompt reduces confabulation, the
              // badge is the signal that cannot lie.
              webUsed = cr.toolsUsed.includes('web_search');
            }
            r = cr;
          } else {
            r = await sendChat(fetchAdapter, cfg, chatReq, controller.signal);
          }
        } finally {
          // One-shot: the arming covers exactly ONE send attempt —
          // success or failure, the next message reverts to plain chat
          // completions (and its cached prefix).
          setArmWeb(false);
        }
        // Only mark the context as sent if the capture AND the scope are
        // still the ones we sent — a Refresh or a scope change landing
        // mid-request must keep its "will be sent" state for the next
        // message. Success OR failure (audit 2026-07-19 A4, the rule the
        // Added blocks already follow): the user turn CARRYING the
        // transcript blocks stays in the local history either way and
        // ships with the next send — recomposing the context would
        // duplicate the pages in the history and re-bill them every turn.
        if (
          includeContext &&
          capRef.current === capture &&
          scopeRef.current === sentScope
        ) {
          setContextSent(true);
        }
        if (r.ok && r.modelId) {
          setResolvedModel(r.modelId);
        }
        if (r.ok) {
          setLastUsage(r.usage);
        }
        // Mark the added pages as IN the conversation (they stay listed
        // for its whole lifetime); drop the Off-refused ones. Entries
        // added while the request was in flight stay unsent. This runs
        // even when the request FAILED (audit 2026-07-19 #1): the user
        // turn carrying the blocks STAYS in the local history and ships
        // with the next send — re-composing them would duplicate the
        // pages in the history and re-bill them every turn.
        if (ctxSentKeys.size > 0 || ctxOffKeys.size > 0) {
          setPendingCtx(list =>
            list
              .filter(ref => !ctxOffKeys.has(ctxKeyOf(ref.path, ref.page)))
              .map(ref =>
                ctxSentKeys.has(ctxKeyOf(ref.path, ref.page))
                  ? {...ref, sent: true}
                  : ref,
              ),
          );
        }
        const failText = stopRequested.current
          ? 'Stopped.'
          : r.ok
          ? ''
          : r.reason;
        // Web-search citations ride inside the answer text — visible,
        // copyable, and preserved in history without a new turn shape.
        const sourcesBlock =
          sources.length > 0
            ? '\n\nSources:\n' +
              sources.map(s => `• ${s.title}\n  ${s.url}`).join('\n')
            : '';
        setTurns([
          ...prior,
          outgoing,
          r.ok
            ? {
                role: 'assistant',
                text: r.text + sourcesBlock,
                ...(webUsed ? {web: true as const} : {}),
              }
            : {role: 'assistant', text: `⚠ ${failText}`, error: true},
        ]);
      } finally {
        // Whatever happens above, never leave the panel locked.
        abortRef.current = null;
        setProgress(null);
        setBusy(false);
        holdForeground(false); // resume the Auto drain
      }
    },
    [
      keyState,
      cap,
      turns,
      // model/persona left the deps on purpose (re-audit P1): send()
      // reads them FRESH from settings — the states are display-only.
      ctxMode,
      rangeStart,
      rangeEnd,
      contextSent,
      armWeb,
      pendingCtx,
      ctxImages,
      agentId,
      ctxPageOff,
      holdForeground,
    ],
  );

  // Consume a lasso seed: pre-fill the field with its prompt and attach
  // its crop to the next message. Fires on mount AND via subscription —
  // a lasso can be fired while the chat is already open (the panel stays
  // mounted across collapse).
  const turnsLenRef = useRef(0);
  turnsLenRef.current = turns.length;
  useEffect(() => {
    const apply = () => {
      const seed = consumeLassoSeed();
      if (seed !== null) {
        // v0.81: a lasso adds an image to the PERSISTENT context (a chip
        // with ✕, several allowed) on WHATEVER brain is active — no
        // dedicated agent. The page auto-context steps aside (ctxPageOff),
        // the image quick actions appear, and the "read the image"
        // directive is injected at send. The input is left alone (the user
        // taps an image quick action or types).
        const imgId = `img-${Date.now()}-${imgIdRef.current++}`;
        setCtxImages(cur => [
          ...cur,
          {
            id: imgId,
            image: seed.image,
            src: seed.note,
            // Unknown until proven otherwise: an image counts as Off (never
            // persisted) until a settings read says it is not. Round 5 #3:
            // the flag used to be set only inside send(), so an Off image
            // added and never sent was written to disk on close.
            off: true,
          },
        ]);
        resolveImageOff(imgId, seed.note);
        setCtxPageOff(true);
        setSearchOn(false);
        console.log(
          '[SmartNoteAI.lasso]',
          `lasso image added to context (turns=${turnsLenRef.current}, ` +
            `${seed.image.length}b)`,
        );
      }
    };
    apply();
    return subscribeLassoSeed(apply);
  }, [resolveImageOff]);

  // v0.75: consume "Add to CHAT" queued from the Library (spec §3b). Folds
  // the refs into pendingCtx as UNSENT entries (deduped vs existing), on
  // mount and live via subscription — the library can queue pages while
  // the panel is already open. Off docs still drop at send time.
  useEffect(() => {
    const apply = () => {
      const seeded = consumeChatCtxSeed();
      if (seeded.length === 0) {
        return;
      }
      setPendingCtx(list => {
        const seen = new Set(list.map(x => `${x.path} ${x.page}`));
        const add = seeded.filter(r => !seen.has(`${r.path} ${r.page}`));
        if (add.length === 0) {
          return list;
        }
        console.log(
          '[SmartNoteAI.ctx]',
          `library handoff: +${add.length} page(s) to chat`,
        );
        return [...list, ...add.map(r => ({path: r.path, page: r.page}))];
      });
    };
    apply();
    return subscribeChatCtxSeed(apply);
  }, []);

  // Resume a send paused by the Off / estimate dialogs.
  const resumePending = useCallback(
    (extra: {skipEstimate?: boolean}) => {
      const p = pendingRef.current;
      pendingRef.current = null;
      setEstimateAsk(null);
      setOffAsk(null);
      if (p) {
        send(p.text, {...p, ...extra});
      }
    },
    [send],
  );

  // OFF gate: remember consent for this file (this conversation) and resume;
  // the read then happens and is discarded afterwards (ephemeral).
  const onOffOk = useCallback(() => {
    if (offAsk) {
      offConsentedRef.current.add(offAsk.path);
    }
    resumePending({});
  }, [offAsk, resumePending]);

  const onDialogCancel = useCallback(() => {
    // Cancelling an Off/estimate dialog used to EAT the typed message
    // (audit 2026-07-19 C2): the input was cleared at onSend and the
    // pending text just dropped. Put it back — unless the user already
    // typed something new meanwhile.
    const p = pendingRef.current;
    pendingRef.current = null;
    if (p !== null && p.text.trim().length > 0) {
      setInput(cur => (cur.trim().length > 0 ? cur : p.text));
    }
    setEstimateAsk(null);
    setOffAsk(null);
  }, []);

  // A manual ('user') entry is never overwritten silently: the first tap
  // arms a confirmation, the second executes (no long-press on e-ink).
  const guardOverwrite = useCallback(
    (action: 'reread' | 'improve'): boolean => {
      if (voletEntry?.source !== 'user') {
        disarmOv();
        return true;
      }
      return confirmOv(action);
    },
    [voletEntry, confirmOv, disarmOv],
  );

  // "Re-read" (Transcript sheet): re-run the configured engine on the
  // current page (or the whole PDF) and replace the store entry.
  const onReread = useCallback(async (rotateDeg?: number) => {
    const capture = capRef.current;
    // busyRef too: a Re-read during a busy send double-read the same page
    // and its setContextSent(false) was overwritten by the send's finish
    // (audit 2026-07-18).
    if (capture === null || keyState.kind !== 'ok' || rereading || busyRef.current) {
      return;
    }
    // Phase A (spec S5): an explicit action on a LOCKED page refuses
    // loudly — it never obeys and never bypasses (round-8: this path
    // ignored locks entirely).
    {
      const st = await loadStore();
      if (isPageLocked(st, capture.notePath, capture.page)) {
        setOffline('🔒 Page locked — unlock it in the Library to re-read.');
        return;
      }
      if (!canPersistDoc(capture.notePath)) {
        // Audit 9 #3: same rule as the Library — never pay for a read the
        // store cannot keep this session.
        setOffline(STORAGE_UNAVAILABLE_MSG);
        return;
      }
    }
    if (!guardOverwrite('reread')) {
      return;
    }
    setRereading(true);
    // v0.80.0 (audit M2): a paid re-read is Stop-able like a send — the
    // underlying readers already honour an AbortSignal.
    const ctl = new AbortController();
    rereadAbortRef.current = ctl;
    try {
      let r: {ok: boolean; reason?: string} = {ok: true};
      if (isNotePath(capture.notePath)) {
        r = await readNotePages(
          captureBridge(),
          keyState.config.apiKey,
          await freshVisionSystem(),
          capture.notePath,
          [capture.page],
          {force: true, rotateDeg, signal: ctl.signal},
        );
      } else if (/\.pdf$/i.test(capture.notePath)) {
        // ONE page, never the document (release audit 2026-08-12, critical):
        // this used to call readPdf(force) — which skips the covered check
        // and re-OCRs the WHOLE file, then re-Visions every page of it. On a
        // 400-page PDF that is ~1.60 € per tap, with no dialog, and it
        // overwrote every stored transcript including unlocked hand
        // corrections. The Library's twin button was fixed for exactly this
        // reason (see its comment); this copy had been left behind.
        r = await readPdfPageVision(
          captureBridge(),
          keyState.config.apiKey,
          await freshPdfVisionSystem(),
          capture.notePath,
          capture.page,
          {signal: ctl.signal},
        );
      }
      // Surface a refusal/failure (e.g. the Off gate) instead of silently
      // keeping the old entry — the banner is the panel's message line.
      // A SUCCESS can carry a reason too ("this page is blank", "vision
      // found nothing to add"): the single-page PDF path returns one, and
      // dropping it made a paid tap look like a no-op (verification pass
      // 2026-08-12). The Library twin already shows it.
      setOffline(r.reason ?? '');
      // A fresh read is a better context than whatever was sent before.
      setContextSent(false);
    } finally {
      rereadAbortRef.current = null;
      setRereading(false);
    }
  }, [keyState, rereading, guardOverwrite]);

  // ("Improve" was retired in v0.52 — since v0.38 the Redo path is
  // already OCR→vision with the previous text as hint; two paid buttons
  // doing near the same thing only confused. Library wording aligned.)

  // "Edit" (v0.21): manual correction → source 'user', top rank. Stamped
  // with the page's PAGEID *and* rev (pageStamp) so the entry survives
  // reorders and is never mistaken for a stale one (audit 2026-07-17).
  const onEditSave = useCallback(async () => {
    const capture = capRef.current;
    if (capture === null || voletDraft.trim().length === 0) {
      setVoletEditing(false);
      return;
    }
    const st = await pageStamp(captureBridge(), capture.notePath, capture.page);
    await upsertTranscript(
      capture.notePath,
      capture.page,
      voletDraft.trim(),
      'user',
      st,
      undefined,
      undefined,
      true, // the user's own hands (round 10 #6): the lock barrier lets it through
    );
    setVoletEditing(false);
    setContextSent(false);
  }, [voletDraft]);

  const onSend = useCallback(() => {
    const text = input;
    setInput('');
    // Send always exits the armed search: same text, the OTHER exit.
    setSearchOn(false);
    send(text);
  }, [input, send]);

  // ---- v0.55 agents: start-card selection + gaps flow ----

  // Pick an agent on the start card. If some of its docs are not read
  // yet, offer to read them NOW (paid) — or chat with what the store has.
  const onPickAgent = useCallback(
    (a: Agent | null) => {
      setAgentId(a?.id ?? null);
      setAgentGapAsk(null);
      if (a === null) {
        return;
      }
      const stats = agentStats.get(a.id);
      if (stats !== undefined && stats.unread > 0) {
        // Honest quote (sweep 2026-08-16): the gap read pays notes in full
        // (OCR + Vision) but PDFs OCR-only (skipVision — agent reads never
        // pay Vision), so each class is priced at what it actually costs.
        const noteUnread = stats.unread - stats.unreadPdf;
        const cents =
          noteUnread * FULL_PAGE_READ_CENTS + stats.unreadPdf * OCR_COST_CENTS;
        setAgentGapAsk({
          agent: a,
          unread: stats.unread,
          euros: (Math.round(cents) / 100).toFixed(2),
        });
      }
    },
    [agentStats],
  );

  // "Read N pages now": walk the agent's docs and read what's missing.
  // Off docs are excluded; Stop (⏹) aborts between pages like a chat read.
  const onAgentReadGaps = useCallback(async () => {
    const ask = agentGapAsk;
    setAgentGapAsk(null);
    if (ask === null || keyState.kind !== 'ok' || busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    holdForeground(true); // agent doc read is foreground, pause Auto
    stopRequested.current = false;
    const controller = new AbortController();
    // Hoisted above the try: the catch keeps the skip warning visible
    // (round 13 #3 — a failed gap-read used to un-report the skip).
    let skipWarning = '';
    abortRef.current = controller;
    try {
      const st = await readSettings();
      const targets = st.autoTargets ?? {};
      const store = await loadStore();
      const lib = docsSummary(store);
      const paths = resolveAgentDocs(
        ask.agent.docs,
        lib.map(d => d.path),
      ).filter(p => effectiveMode(targets, p) !== 'off');
      // Round 11 #0: THE persistence question, here too — a doc whose
      // result cannot be kept this session is skipped, not billed.
      const unpersistable = paths.filter(p => !canPersistDoc(p)).length;
      skipWarning =
        unpersistable > 0
          ? `⚠ ${unpersistable} document(s) skipped — storage unavailable this session.`
          : '';
      const persistablePaths = paths.filter(p => canPersistDoc(p));
      // Round 12 #5: totals from the FILTERED set, or the progress label
      // can never reach its total when docs were skipped.
      const unreadTotal = persistablePaths.reduce((n, p2) => {
        const d2 = lib.find(x => x.path === p2);
        return n + (d2 !== undefined ? Math.max(0, d2.total - d2.read) : 0);
      }, 0);
      const vision = await freshVisionSystem();
      const pdfVision = await freshPdfVisionSystem();
      let done = 0;
      for (const p of persistablePaths) {
        if (stopRequested.current) {
          break;
        }
        const d = lib.find(x => x.path === p);
        if (!d || d.total <= d.read) {
          continue;
        }
        setProgress({label: `reading ${baseName(p)}`, done, total: unreadTotal});
        if (isNotePath(p)) {
          const toRead = Array.from({length: d.total}, (_, i) => i);
          const r = await readNotePages(
            captureBridge(),
            keyState.config.apiKey,
            vision,
            p,
            toRead,
            {
              shouldStop: () => stopRequested.current,
              signal: controller.signal,
              onProgress: dd => setProgress({
                label: `reading ${baseName(p)}`,
                done: done + dd,
                total: unreadTotal,
              }),
            },
          );
          done += r.read;
        } else if (/\.pdf$/i.test(p)) {
          await readPdf(
            captureBridge(),
            keyState.config.apiKey,
            pdfVision,
            p,
            // skipVision (user decision 2026-08-16): agent reads, like chat
            // sends, never pay vision — OCR text answers; the backlog
            // belongs to the drain/Sync.
            {signal: controller.signal, skipVision: true},
          );
          done += Math.max(0, d.total - d.read);
        }
      }
      setOffline(skipWarning); // round 12 #1: a skip is never un-reported
    } catch (e) {
      setOffline(
        `${skipWarning.length > 0 ? skipWarning + ' · ' : ''}` +
          `Agent read failed: ${String((e as Error).message ?? e)}`,
      );
    } finally {
      abortRef.current = null;
      setProgress(null);
      setBusy(false);
      holdForeground(false); // resume the Auto drain
    }
  }, [agentGapAsk, keyState, holdForeground]);

  // "Add to CHAT": toggle a search hit in/out of the added list
  // (multi-select — the overlay stays open). A page already SENT is part
  // of the conversation history and cannot be un-added.
  const onToggleAdd = useCallback((h: SearchHit) => {
    setPendingCtx(list => {
      const i = list.findIndex(x => x.path === h.path && x.page === h.page);
      if (i >= 0) {
        return list[i].sent === true ? list : list.filter((_, j) => j !== i);
      }
      return [...list, {path: h.path, page: h.page}];
    });
  }, []);

  // v0.76.2 (audit #2/#4): add a WHOLE note to the chat context — every
  // transcribed page of `path` folded into pendingCtx (deduped, unsent).
  // Used by the search results (whole-note add) and the context sheet
  // (add the current note). Returns how many pages were newly added.
  const onAddNoteToChat = useCallback(
    async (path: string): Promise<number> => {
      const store = await loadStore();
      const pages = Object.entries(store.docs[path]?.pages ?? {})
        .filter(([, e]) => e.text.trim().length > 0)
        .map(([k]) => Number(k));
      let added = 0;
      setPendingCtx(list => {
        const seen = new Set(list.map(x => `${x.path} ${x.page}`));
        const add = pages
          .filter(p => !seen.has(`${path} ${p}`))
          .map(p => ({path, page: p}));
        added = add.length;
        return add.length > 0 ? [...list, ...add] : list;
      });
      return added;
    },
    [],
  );

  // "Read & add": a META hit (★/kw) with no transcript yet — one paid
  // page read (the overlay ran the two-tap cost confirm), then added.
  // Off files never reach here (the overlay hides the button) and the
  // reading layer would refuse them anyway (OFF_READ_REFUSED).
  const onReadAdd = useCallback(
    async (h: SearchHit) => {
      if (keyState.kind !== 'ok' || busyRef.current || readingKey !== null) {
        return;
      }
      if (!canPersistDoc(h.path)) {
        setOffline(STORAGE_UNAVAILABLE_MSG);
        return;
      }
      const key = ctxKeyOf(h.path, h.page);
      setReadingKey(key);
      try {
        const r = await readNotePages(
          captureBridge(),
          keyState.config.apiKey,
          await freshVisionSystem(),
          h.path,
          [h.page],
        );
        if (r.ok) {
          setOffline('');
          setPendingCtx(list =>
            list.some(x => x.path === h.path && x.page === h.page)
              ? list
              : [...list, {path: h.path, page: h.page}],
          );
        } else {
          setOffline(r.reason ?? 'Read failed.');
        }
      } finally {
        setReadingKey(null);
      }
    },
    [keyState, readingKey],
  );

  const onStop = useCallback(() => {
    // One flag, two effects: gather loops bail at the next page boundary,
    // and the HTTP request (if started) aborts.
    stopRequested.current = true;
    abortRef.current?.abort();
  }, []);

  const onRefresh = useCallback(() => {
    // Re-locate the page currently on screen (v0.36: three cheap SDK
    // calls — the render/OCR cascade is gone); keeps the conversation.
    // Drop the 45s note cache first so the next read reflects fresh ink,
    // not a stale cached snapshot (C7).
    const path = capRef.current?.notePath;
    if (path) {
      invalidateNoteCache(path);
    }
    setRefreshing(true);
    const pc = captureCurrent(captureBridge())
      .catch(() => null)
      .finally(() => setRefreshing(false));
    setCurrentCapture(pc);
  }, []);

  // Follow the note: poll the displayed page AND file; when either
  // changes, re-capture so the panel reflects what you're looking at.
  // The SDK emits no "file changed" event, and page numbers collide
  // across notes (note A p.3 → note B p.3), so the path check is what
  // keeps range / whole-note queries from silently targeting the
  // previous note. Cheap poll; the heavy render only runs on a change.
  // One poll pass: does the capture match what's on screen? If not,
  // re-capture (self-heals next pass, v0.52).
  const pollOnce = useCallback(async () => {
    if (busy) {
      return;
    }
    try {
      const bridge = captureBridge();
      const raw: any = await bridge.getCurrentPageNum();
      const p = typeof raw === 'number' ? raw : raw?.result;
      if (typeof p !== 'number') {
        return;
      }
      const rawF: any = await bridge.getCurrentFilePath().catch(() => null);
      const f = typeof rawF === 'string' ? rawF : rawF?.result;
      const fileChanged =
        typeof f === 'string' && cap !== null && f !== cap.notePath;
      // Poke Auto once per page actually turned (debounced downstream).
      if (p !== lastSeenPage.current) {
        lastSeenPage.current = p;
        pokeAuto('page-turn');
      }
      if (cap !== null && p === cap.page && !fileChanged) {
        return; // in sync
      }
      if (refreshing) {
        return; // a capture is already in flight
      }
      onRefresh();
    } catch {
      // ignore transient errors
    }
  }, [busy, cap, refreshing, onRefresh]);

  // v0.53 (device repro: the poll STILL missed page turns): React Native
  // PAUSES JS timers while the host activity is backgrounded — which is
  // exactly the floating-panel situation (the note app is foreground).
  // setInterval therefore never ticked between your page turns (same
  // root cause as the v0.25.4 search-debounce bug). The overlay module
  // now emits a NATIVE heartbeat every 2.5 s (a main-looper Handler is
  // not paused) and the panel polls on it; the interval below stays as
  // belt-and-braces for when the activity IS active.
  useEffect(() => {
    const beat = () => {
      pollOnce();
      // v0.86.5 (converged sync): the assistant overlay is the one reliably
      // non-frozen foreground pulse (native heartbeat, main-looper Handler).
      // Poke Auto on it so pending work for the current host keeps draining
      // while the assistant is up — no button. Non-force: the tick's 20 s floor
      // throttles the actual runs, and a chat send pauses Auto (foregroundBusy).
      pokeAuto('heartbeat');
      // Flush the tick throttles' trailing edge (see TICK_GAP_MS above):
      // bursts marked dirty get their ONE deferred re-render here.
      if (storeDirty.current) {
        storeDirty.current = false;
        lastStoreTickAt.current = Date.now();
        setProvTick(t => t + 1);
      }
      if (settingsDirty.current) {
        settingsDirty.current = false;
        lastSettingsTickAt.current = Date.now();
        setSettingsTick(t => t + 1);
      }
    };
    let lastNativeBeat = 0;
    const sub = DeviceEventEmitter.addListener('SmartNoteAiHeartbeat', () => {
      lastNativeBeat = Date.now();
      beat();
    });
    // Belt-and-braces only: when native beats are arriving, the interval
    // stands down (perf audit 2026-07-20 — both fired, doubling pollOnce
    // bridge calls whenever the activity was foreground).
    const id = setInterval(() => {
      if (Date.now() - lastNativeBeat > 4000) {
        beat();
      }
    }, 2500);
    return () => {
      sub.remove();
      clearInterval(id);
    };
  }, [pollOnce]);

  // While a request is in flight, scroll down so the "…thinking" line is
  // visible.
  useEffect(() => {
    if (busy) {
      setTimeout(() => scrollRef.current?.scrollToEnd({animated: true}), 60);
    }
  }, [busy]);

  // The ONE persist routine, ref-driven so New chat / Resume / the unmount
  // flush can save the CURRENT conversation before switching away. The
  // debounced auto-save alone lost the last assistant turn whenever the
  // panel closed (or the conversation swapped) less than 600 ms after an
  // answer — its own cleanup cancelled the pending timer (audit 2026-07-18).
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const bornOnRef = useRef(bornOn);
  bornOnRef.current = bornOn;
  const pendingCtxRef = useRef(pendingCtx);
  pendingCtxRef.current = pendingCtx;
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;
  const ctxImagesRef = useRef(ctxImages);
  ctxImagesRef.current = ctxImages;
  const persistNow = useCallback(() => {
    const t = turnsRef.current;
    if (t.length === 0) {
      return;
    }
    const capture = capRef.current;
    const noteName =
      bornOnRef.current.length > 0
        ? bornOnRef.current
        : capture !== null
        ? baseName(capture.notePath)
        : '';
    saveConversation({
      id: convId.current,
      title: titleFor(noteName, t),
      noteName,
      notePath: capture?.notePath ?? '',
      createdAt: convCreatedAt.current,
      updatedAt: Date.now(),
      turns: redactForSave(t),
      pendingCtx: pendingCtxRef.current,
      // v0.81 (user, decision D): lasso images persist with the conversation
      // and are dropped with it on delete.
      // Off images are ephemeral: they never reach the conversation file.
      ...(ctxImagesRef.current.filter(c => c.off !== true).length > 0
        ? {ctxImages: ctxImagesRef.current.filter(c => c.off !== true)}
        : {}),
      ...(agentIdRef.current !== null ? {agentId: agentIdRef.current} : {}),
    }).catch(() => {});
  }, []);

  // Flush on unmount — closing the panel must never eat the last turn.
  useEffect(() => () => persistNow(), [persistNow]);

  const onNewChat = useCallback(() => {
    // The previous conversation is already persisted (auto-save after
    // every turn) — "New chat" just archives by starting a fresh id.
    // Never during a send: the in-flight response would resurrect the
    // old turn list and auto-save it under the NEW conversation id.
    // busyRef, not the closure `busy` (audit 2026-07-19): a tap landing
    // in the same frame as Send saw busy=false and corrupted the
    // conversation — same fix as send/onResume.
    if (busyRef.current) {
      return;
    }
    persistNow(); // don't lose a turn younger than the save debounce
    setTurns([]);
    setContextSent(false);
    setPendingCtx([]); // added pages are per-conversation
    setCtxImages([]); // v0.81: lasso images are per-conversation too
    setAgentId(null); // back to the start card — pick again
    setAgentGapAsk(null);
    offConsentedRef.current.clear(); // OFF consent is per-conversation
    anchorIdx.current = null;
    turnY.current = {};
    convId.current = makeConvId(); // new cache scope
    convCreatedAt.current = Date.now();
    setBornOn('');
    setLastUsage(null);
    setOffline(''); // v0.80.0 (audit): a stale ⚠ must not haunt a fresh chat
  }, [persistNow]);

  // Auto-save after each turn. EVENT-DRIVEN when a turn just COMPLETED
  // (last turn = assistant): the 600 ms debounce is a JS timer, and RN
  // freezes those for the whole floating state — the promised
  // crash-protection never ran there, everything hung on the unmount
  // flush (audit 2026-07-19 E2). Renders/effects still run in the
  // background (only timers freeze), so persisting directly here works.
  // The debounce stays for mid-conversation states (typing, user turn
  // just added) where a timer is fine-if-late.
  useEffect(() => {
    if (turns.length === 0) {
      return;
    }
    if (turns[turns.length - 1].role === 'assistant') {
      persistNow();
      return;
    }
    const t = setTimeout(persistNow, 600);
    return () => clearTimeout(t);
  }, [turns, bornOn, persistNow]);

  const openHistory = useCallback(async () => {
    setHistList(await listConversations().catch(() => []));
    disarmDel();
    setHistOpen(true);
  }, [disarmDel]);

  const onResume = useCallback(async (meta: ConvMeta) => {
    // Same rule as New chat: never swap conversations under a busy send.
    if (busyRef.current) {
      return;
    }
    persistNow(); // the outgoing conversation may have a turn < 600 ms old
    const conv = await loadConversation(meta.id).catch(() => null);
    setHistOpen(false);
    if (conv === null) {
      return;
    }
    setTurns(conv.turns);
    convId.current = conv.id;
    convCreatedAt.current = conv.createdAt;
    offConsentedRef.current.clear(); // OFF consent is per-conversation (C5)
    setContextSent(false); // fresh context will re-attach, labelled
    setPendingCtx(conv.pendingCtx ?? []); // un-sent added pages survive
    setCtxImages(conv.ctxImages ?? []); // v0.81: lasso images restored
    // The conversation keeps talking to its agent; if the agent was
    // deleted, send() falls back to standard Chat and the tag survives.
    setAgentId(conv.agentId ?? null);
    anchorIdx.current = null;
    turnY.current = {};
    setLastUsage(null);
    const here = capRef.current?.notePath ?? '';
    setBornOn(
      conv.notePath.length > 0 && conv.notePath !== here ? conv.noteName : '',
    );
  }, [persistNow]);

  const onDeleteConv = useCallback(
    async (id: string) => {
      if (!confirmDel(id)) {
        return;
      }
      await deleteConversation(id).catch(() => {});
      setHistList(await listConversations().catch(() => []));
    },
    [confirmDel],
  );

  // "Lib" header link (v0.64): open the config directly on the Library.
  const openSettingsRef = useRef<(() => void) | null>(null);
  const openLibrary = useCallback(() => {
    setNavIntent('library');
    openSettingsRef.current?.();
  }, []);
  const openSettings = useCallback(() => {
    // Settings live in the config page. Show it FIRST, then remove the
    // overlay a beat later — closing first and losing the showPluginView
    // race made the window vanish into nothing.
    try {
      const p = (
        PluginManager as {showPluginView?: () => Promise<unknown>}
      ).showPluginView?.();
      if (p && typeof (p as Promise<unknown>).then === 'function') {
        (p as Promise<unknown>).then(
          (r: unknown) =>
            console.log('[SmartNoteAI]', `showPluginView -> ${String(r)}`),
          (e: unknown) =>
            console.warn('[SmartNoteAI]', `showPluginView err ${String(e)}`),
        );
      } else {
        console.warn('[SmartNoteAI]', 'showPluginView not available');
      }
    } catch (e) {
      console.warn('[SmartNoteAI]', `openSettings threw ${String(e)}`);
    }
    setTimeout(() => {
      if (SmartNoteAiOverlay && SmartNoteAiOverlay.close) {
        SmartNoteAiOverlay.close();
      }
    }, 300);
  }, []);
  openSettingsRef.current = openSettings;

  const onCopy = useCallback(async (text: string, key: string) => {
    try {
      await SmartNoteAiOverlay.copyToClipboard(text, 'SmartNote AI');
      setCopied(key);
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1600);
    } catch {
      // best-effort; selectable text remains as a fallback
    }
  }, []);


  // Also blocked while a Refresh capture is in flight: a send started
  // then would still use the previous page's context.
  // Live tools capability for the one-shot buttons; static list fallback
  // when the (session-cached) /v1/models fetch is unavailable.
  // Effective model of the NEXT message: the active agent's model wins
  // (v0.55), else the chat model. Drives the tools capability and the
  // status line.
  const activeAgent =
    agentId !== null ? agents.find(a => a.id === agentId) ?? null : null;
  // v0.81: the BrainBar dropdown entries — Chat + the user agents. The lasso
  // is no longer a brain; it rides whatever is selected here.
  const brainEntries: BrainEntry[] = [
    {key: 'chat', icon: '💬', name: 'Chat', id: null, agent: null},
    ...agents.map(a => ({
      key: a.id,
      icon: a.icon,
      name: a.name,
      id: a.id as string | null,
      agent: a as Agent | null,
    })),
  ];
  const effectiveModel =
    (activeAgent !== null && activeAgent.model.trim().length > 0
      ? activeAgent.model.trim()
      : model) || DEFAULT_MODEL;
  useEffect(() => {
    if (keyState.kind !== 'ok') {
      return;
    }
    let alive = true;
    modelSupportsTools(keyState.config.apiKey, effectiveModel).then(v => {
      if (alive) {
        setLiveTools(v);
      }
    });
    return () => {
      alive = false;
    };
  }, [keyState, effectiveModel]);
  const toolsOk =
    liveTools !== undefined ? liveTools : !modelLacksTools(effectiveModel);

  const canSend = keyState.kind === 'ok' && !busy && !refreshing;
  // v0.59 unification: an agent with its OWN quick actions replaces the
  // CHAT defaults for its conversations; absent = inherit.
  const baseQuickActions = (activeAgent?.quickActions ?? quickActions).filter(
    a => a.enabled && a.label.trim().length > 0 && a.prompt.trim().length > 0,
  );
  // v0.81: the IMAGE quick actions (config: door 3, CHAT) show ONLY when a
  // lasso image is in context, AHEAD of the normal ones — on whatever brain
  // is active.
  const imageQaActive =
    ctxImages.length > 0
      ? imageQuickActions.filter(
          a =>
            a.enabled &&
            a.label.trim().length > 0 &&
            a.prompt.trim().length > 0,
        )
      : [];
  const enabledQuickActions = [...imageQaActive, ...baseQuickActions];
  // (v0.80.0 audit: the old keyLine/agentLine header status block was dead
  // code — the v0.79.6 brain dropdown replaced that display entirely.)

  const msgText = {fontSize: 14 * scale, lineHeight: 20 * scale};

  // Collapsed: render nothing heavy (all hooks above already ran, so
  // turns/cap/etc. are preserved) — the light bubble is drawn by the
  // shell. This is what makes the collapsed window cheap to drag.
  if (collapsed) {
    return <View style={styles.root} />;
  }

  return (
    <View style={styles.root}>
      <View style={styles.header} {...(headerHandlers ?? {})}>
        <Text style={styles.handle}>⠿</Text>
        {/* v0.79.6: the plugin name is gone; the ACTIVE agent + ▾ takes the
            header spot and opens the brain dropdown (agents + model/context +
            New chat / History). */}
        <TouchableOpacity
          onPress={() => {
            setBrainOpen(v => !v);
            setSnapOpen(false);
          }}
          style={[styles.headerBrain, {flexDirection: 'row', alignItems: 'center'}]}
          hitSlop={{top: 6, bottom: 6}}>
          {/* v0.80.0 (audit M5): the ▾ lives OUTSIDE the ellipsized name —
              a long agent name used to eat the only dropdown affordance. */}
          <Text
            style={[styles.headerBrainText, {flexShrink: 1}]}
            numberOfLines={1}
            ellipsizeMode="tail">
            {activeAgent !== null
              ? `${activeAgent.icon} ${activeAgent.name}`
              : '💬 Chat'}
          </Text>
          <Text style={styles.headerBrainText}> ▾</Text>
        </TouchableOpacity>
        <View style={styles.headerRight}>
          {/* ✕ and ⚙ are HELD while a send is in flight (audit
              2026-07-19 C1): both used to throw away the answer being
              paid for — never persisted. Stop (⏹) first, then close. */}
          {/* v0.85: one "≡ Menu" button (back to the hub) replaces the old
              Lib + Settings header buttons. */}
          {onMenu !== undefined ? (
            <TouchableOpacity
              onPress={onMenu}
              disabled={busy}
              style={iconStyles.iconBtn}
              hitSlop={{top: 8, bottom: 8}}>
              <Text style={styles.libLink}>≡ Menu</Text>
            </TouchableOpacity>
          ) : null}
          {/* ▾ (v0.54): the five window snaps live in a popover — the
              header shrank from 9 icons to 5. */}
          <TouchableOpacity
            onPress={() => {
              setSnapOpen(v => !v);
              setBrainOpen(false);
            }}
            style={[iconStyles.iconBtn, styles.snapTrigger]}
            hitSlop={{top: 8, bottom: 8}}>
            <Image source={IC.default} style={iconStyles.icon} resizeMode="contain" />
            <Text style={styles.snapCaret}>▾</Text>
          </TouchableOpacity>
          <IconBtn src={IC.collapse} onPress={onCollapse} />
          {/* Gap so Close isn't mis-tapped from the snap buttons. */}
          <View style={styles.headerSep} />
          {/* v0.80.0 (audit M1): ✕ is never a dead end — during a send it
              aborts the request first, then closes (the user chose to
              walk away from the in-flight answer). ⚙/Lib stay held. */}
          <IconBtn
            src={IC.close}
            onPress={() => {
              if (busyRef.current) {
                onStop();
              }
              onClose();
            }}
          />
        </View>
      </View>

      {snapOpen ? (
        <View style={styles.snapPopover}>
          {(
            [
              ['default', IC.default],
              ['top', IC.snaptop],
              ['bottom', IC.snapbottom],
              ['left', IC.snapleft],
              ['right', IC.snapright],
              ['full', IC.fullscreen],
            ] as [SnapKind, number][]
          ).map(([k, src]) => (
            <IconBtn
              key={k}
              src={src}
              onPress={() => {
                setSnapOpen(false);
                onSnap(k);
              }}
            />
          ))}
        </View>
      ) : null}

      {/* v0.79.6: the brain dropdown (opened from the header agent name).
          Extracted to BrainDropdown.tsx (Lot 3) — pure render. */}
      <BrainDropdown
        styles={styles}
        open={brainOpen}
        effectiveModel={effectiveModel}
        entries={brainEntries}
        agentId={agentId}
        busy={busy}
        pendingCtxCount={pendingCtx.length}
        activeStats={
          activeAgent !== null
            ? agentStats.get(activeAgent.id) ?? null
            : null
        }
        statsFor={id => agentStats.get(id)}
        modelLabelFor={a =>
          shortModelId(
            (a && a.model.trim().length > 0 ? a.model.trim() : model) ||
              DEFAULT_MODEL,
          )
        }
        lastUsage={lastUsage}
        onNewChat={onNewChat}
        onOpenHistory={openHistory}
        onPickAgent={onPickAgent}
        onClose={() => setBrainOpen(false)}
      />

      {/* v0.78 ContextTray: the context as CHIPS (lasso · page/scope ·
          +N added). Any chip → the context sheet. Replaces the old
          "Context: … ▾" line and the separate lasso-image chip. */}
      <View style={styles.ctxTray}>
        {/* v0.80.1 (user): name the row — these chips ARE what ships with
            the next message. */}
        <Text style={styles.ctxTrayLabel}>Chat context:</Text>
        {/* v0.80.1 (user): the active agent's KNOWLEDGE is context too —
            make it visible ("Writer looked empty" with folders attached).
            Tap opens the brain dropdown, where the docs live. */}
        {activeAgent !== null && agentStats.get(activeAgent.id) !== undefined ? (
          <TouchableOpacity
            onPress={() => {
              setBrainOpen(v => !v);
              setSnapOpen(false);
            }}
            style={styles.ctxChip}
            hitSlop={{top: 6, bottom: 6}}>
            <Text style={styles.ctxChipText} numberOfLines={1}>
              {activeAgent.icon}{' '}
              {`${agentStats.get(activeAgent.id)!.docs} docs · ${
                agentStats.get(activeAgent.id)!.read
              } p`}
            </Text>
          </TouchableOpacity>
        ) : null}
        {/* v0.81: one chip per lasso image, always removable (✕), several
            allowed. They persist in context until cleared. */}
        {ctxImages.map((img, i) => (
          <View
            key={img.id}
            style={[
              styles.ctxChip,
              styles.ctxChipOn,
              {flexDirection: 'row', alignItems: 'center'},
            ]}>
            <TouchableOpacity
              onPress={() => setLassoView(img.id)}
              hitSlop={{top: 6, bottom: 6}}>
              <Text style={styles.ctxChipTextOn}>
                🖼 Lasso{ctxImages.length > 1 ? ` ${i + 1}` : ''}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() =>
                setCtxImages(cur => cur.filter(x => x.id !== img.id))
              }
              hitSlop={{top: 6, bottom: 6, left: 4, right: 6}}>
              <Text style={styles.ctxChipTextOn}> ✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity
          onPress={() => setCtxOpen(true)}
          style={styles.ctxChip}
          hitSlop={{top: 6, bottom: 6}}>
          <Text style={styles.ctxChipText} numberOfLines={1}>
            📄{' '}
            {cap === null
              ? 'no page'
              : ctxPageOff
              ? 'page removed'
              : `${cap.notePath.split('/').pop() || cap.notePath} · ${
                  ctxMode === 'note'
                    ? `all ${cap.totalPages} p`
                    : ctxMode === 'range'
                    ? `p.${rangeStart}–${rangeEnd}/${cap.totalPages}`
                    : `p.${cap.page + 1}/${cap.totalPages}`
                }`}
            {/* v0.80.1 (user): the "Chat context:" row label carries the
                meaning now — no per-chip "to send" suffix. */} ▾
          </Text>
        </TouchableOpacity>
        {pendingCtx.length > 0 ? (
          <TouchableOpacity
            onPress={() => setAddedOpen(true)}
            style={styles.ctxChip}
            hitSlop={{top: 6, bottom: 6}}>
            <Text style={styles.ctxChipText}>+{pendingCtx.length} pages ▾</Text>
          </TouchableOpacity>
        ) : null}
        {/* v0.79.7 (context spec): the ＋ tag ends the row — it opens the
            context manager (whole note / from Library / from Search / range,
            add & remove each element). */}
        <TouchableOpacity
          onPress={openLibrary}
          style={[styles.ctxChip, styles.ctxAddChip]}
          hitSlop={{top: 6, bottom: 6}}>
          <Text style={styles.ctxChipText}>＋</Text>
        </TouchableOpacity>
      </View>


      {searchOn ? (
        <SearchOverlay
          scale={scale}
          query={input}
          added={
            new Map(
              pendingCtx.map(r => [ctxKeyOf(r.path, r.page), r.sent === true]),
            )
          }
          onToggleAdd={onToggleAdd}
          onReadAdd={onReadAdd}
          canReadAdd={keyState.kind === 'ok' && !busy && readingKey === null}
          readingKey={readingKey}
          agents={agents.map(a => ({id: a.id, icon: a.icon, name: a.name}))}
          onAddNoteToChat={onAddNoteToChat}
          onClose={() => {
            // Go to page: the note opened underneath — back to the normal
            // floating chat so the target page is visible (v0.52 rule).
            setSearchOn(false);
            onSnap('default');
          }}
        />
      ) : (
      <ScrollView
        ref={scrollRef}
        style={styles.chat}
        contentContainerStyle={styles.chatContent}
        onLayout={e => {
          vpH.current = e.nativeEvent.layout.height;
        }}
        onScrollBeginDrag={() => {
          // User took over — stop auto-anchoring.
          anchorIdx.current = null;
        }}
        onContentSizeChange={(_w, h) => {
          const idx = anchorIdx.current;
          const y = idx != null ? turnY.current[idx] : undefined;
          if (y != null) {
            const maxY = Math.max(0, h - vpH.current);
            scrollRef.current?.scrollTo({y: Math.min(y, maxY), animated: true});
          }
        }}>
        {turns.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[styles.hint, msgText]}>
              {/* Release audit 2026-08-12: with no key the field is not even
                  editable and every action is greyed, and NOTHING said why —
                  a first-time user meets a plugin that looks broken. */}
              {keyState.kind !== 'ok'
                ? 'No Mistral API key yet. Open the menu → ⚙ Plugin configuration → 1 · API key, paste your key and save it — then come back here.'
                : 'Ask about your page, or tap a quick action below.'}
            </Text>
          </View>
        ) : (
          turns.map((t, i) => (
            <TurnBubble
              key={i}
              styles={styles}
              turn={t}
              index={i}
              scale={scale}
              msgText={msgText}
              copied={copied}
              onCopy={onCopy}
              onLayout={e => {
                turnY.current[i] = e.nativeEvent.layout.y;
              }}
            />
          ))
        )}
      </ScrollView>
      )}

      {/* v0.79.9: the busy bar ALWAYS carries a Stop while a send/read is in
          flight (the old Stop lived in the ActivityBanner, removed from the
          floating window). A stalled request self-aborts at 60 s, but the user
          can always cut it now. */}
      {busy ? (
        <View style={styles.busyBar}>
          <Text style={styles.busyText} numberOfLines={1}>
            {progress
              ? `${progress.label} ${progress.done}/${progress.total}…`
              : '…thinking'}
          </Text>
          <TouchableOpacity
            onPress={onStop}
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
            style={styles.stopBtn}>
            <Text style={styles.stopBtnText}>⏹ Stop</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* v0.80.0 (audit H2): errors show right above the input — where the
          user acts — on two lines, instead of a truncated line pinned to
          the top of the panel. */}
      {offline.length > 0 ? (
        <Text style={styles.offlineBanner} numberOfLines={2}>
          ⚠ {offline}
        </Text>
      ) : null}

      <View style={styles.inputRow}>
        {/* ONE field, two exits (v0.54): 🔍 arms the free local search
            (live results over the conversation), send exits it and asks
            the AI. Typing while armed searches; typing while idle drafts
            a question — the final tap decides. */}
        <TouchableOpacity
          onPress={() => setSearchOn(v => !v)}
          style={[styles.oneShot, searchOn && styles.oneShotOn]}>
          <Text style={[styles.oneShotText, searchOn && styles.oneShotTextOn]}>
            🔍
          </Text>
        </TouchableOpacity>
        <TextInput
          style={[styles.chatInput, {fontSize: 14 * scale}]}
          value={input}
          onChangeText={setInput}
          placeholder={
            searchOn ? 'Search your notes…' : 'Search notes 🔍 · Ask AI'
          }
          multiline
          // The search is free and local — typing must work even while a
          // chat request is busy; only the AI exit is gated.
          editable={searchOn || canSend}
          // v0.70: make the window focusable BEFORE the tap focuses the
          // field (touch-down), so the keyboard shows; drop it on blur so
          // the panel can't hold the system focus while idle.
          // v0.80.0 (audit H3): gate on editability — tapping the DISABLED
          // field during a send used to grab the system focus with no blur
          // ever firing to release it (the note app's 2-finger lasso died
          // until the panel was collapsed).
          onTouchStart={() => (searchOn || canSend) && setPanelFocusable(true)}
          onFocus={() => setPanelFocusable(true)}
          onBlur={() => setPanelFocusable(false)}
        />
        {/* v0.64 (user): empty field → Paste (system clipboard, native
            method — long-press paste also works); non-empty → ✕ clears. */}
        {input.length > 0 ? (
          <TouchableOpacity
            onPress={() => setInput('')}
            style={styles.oneShot}
            hitSlop={{top: 8, bottom: 8}}>
            <Text style={styles.oneShotText}>✕</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={async () => {
              try {
                const r = await (
                  SmartNoteAiOverlay as {
                    getClipboardText?: () => Promise<{
                      success?: boolean;
                      text?: string;
                    }>;
                  }
                ).getClipboardText?.();
                if (r?.success === true && (r.text ?? '').length > 0) {
                  setInput(cur => cur + (r.text as string));
                }
              } catch {
                // old binary / empty clipboard — nothing to paste
              }
            }}
            style={styles.oneShot}
            hitSlop={{top: 8, bottom: 8}}>
            <Text style={styles.oneShotText}>Paste</Text>
          </TouchableOpacity>
        )}
        {/* One-shot connectors (v0.50): armed = NEXT message only, then
            auto-reset. Greyed when the model can't drive tools (live
            capability, static list as offline fallback). */}
        <TouchableOpacity
          onPress={() => toolsOk && setArmWeb(v => !v)}
          disabled={!toolsOk || busy}
          style={[styles.oneShot, armWeb && styles.oneShotOn, (!toolsOk || busy) && styles.oneShotOff]}>
          <Text style={[styles.oneShotText, armWeb && styles.oneShotTextOn]}>Web</Text>
        </TouchableOpacity>
        {busy ? (
          <TouchableOpacity onPress={onStop} style={styles.sendBtn}>
            <Text style={styles.sendText}>⏹</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={onSend}
            disabled={!canSend || input.trim().length === 0}
            style={[
              styles.sendBtn,
              (!canSend || input.trim().length === 0) && styles.sendBtnOff,
            ]}>
            {/* The Mistral "M" (official monochrome icon): this button
                literally sends to Mistral — the placeholder's "Ask AI"
                exit. */}
            <Image
              source={IC.mistralW}
              style={styles.sendLogo}
              resizeMode="contain"
            />
          </TouchableOpacity>
        )}
      </View>

      {/* v0.77 (user): quick actions INLINE under the field — no more ⚡
          sheet. The selection action (when a lasso image is present) leads,
          accented. Tap = send that prompt. */}
      {!searchOn && enabledQuickActions.length > 0 ? (
        <View style={styles.qaInline}>
          {enabledQuickActions.map((a, i) => (
            <TouchableOpacity
              key={i}
              // v0.80.0 (audit M3): never silently destroy typed text — a
              // quick action APPENDS to a non-empty draft instead of
              // replacing it.
              onPress={() =>
                setInput(cur =>
                  cur.trim().length > 0 ? `${a.prompt}\n${cur}` : a.prompt,
                )
              }
              disabled={!canSend}
              style={[
                styles.qaChip,
                // v0.81: the first (image) quick action is highlighted when a
                // lasso image is in context.
                i < imageQaActive.length && styles.qaChipHot,
                {paddingHorizontal: 9 * btnScale, paddingVertical: 5 * btnScale},
                // audit M3: an inert chip must LOOK inert on e-ink.
                !canSend && {borderColor: '#999999'},
              ]}>
              <Text
                style={[
                  styles.qaChipText,
                  {fontSize: 11.5 * btnScale},
                  i < imageQaActive.length && styles.qaChipTextHot,
                  !canSend && {color: '#999999'},
                ]}
                numberOfLines={1}>
                {a.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <ContextSheet
        styles={styles}
        btnScale={btnScale}
        open={ctxOpen}
        noteName={cap !== null ? cap.notePath.split('/').pop() || cap.notePath : null}
        ctxMode={ctxMode}
        setCtxMode={setCtxMode}
        rangeStart={rangeStart}
        setRangeStart={setRangeStart}
        rangeEnd={rangeEnd}
        setRangeEnd={setRangeEnd}
        setPanelFocusable={setPanelFocusable}
        bornOn={bornOn}
        ctxPageOff={ctxPageOff}
        contextSent={contextSent}
        onClose={() => setCtxOpen(false)}
        onSeeTranscript={() => {
          // The transcript sheet takes over (same spot).
          setCtxOpen(false);
          setVoletOpen(true);
        }}
        onTogglePageOff={() => setCtxPageOff(v => !v)}
      />

      <LassoPopup
        styles={styles}
        open={lassoView !== null}
        imageB64={ctxImages.find(x => x.id === lassoView)?.image ?? null}
        onClose={() => setLassoView(null)}
        onRemove={() => {
          setCtxImages(cur => cur.filter(x => x.id !== lassoView));
          setLassoView(null);
        }}
      />

      <AddedPagesPopup
        styles={styles}
        open={addedOpen}
        refs={pendingCtx}
        keyOf={ctxKeyOf}
        nameOf={baseName}
        onClose={() => setAddedOpen(false)}
        onRemove={ref =>
          setPendingCtx(list =>
            list.filter(x => !(x.path === ref.path && x.page === ref.page)),
          )
        }
        onSeeTranscript={() => {
          const refs = pendingCtx.slice();
          loadStore()
            .then(st => {
              const parts = refs.map(ref => {
                const e = getPage(st, ref.path, ref.page);
                const body =
                  e !== null && e.text.trim().length > 0
                    ? e.text
                    : '_(not read yet)_';
                return (
                  `## ${baseName(ref.path)} · p.${ref.page + 1}` + '\n\n' + body
                );
              });
              setAddedOpen(false);
              setAddedVolet({
                title: `Added pages (${refs.length})`,
                text: parts.join('\n\n'),
              });
            })
            .catch(() => {});
        }}
      />

      <AddedTranscriptSheet
        styles={styles}
        volet={addedVolet}
        scale={scale}
        onClose={() => setAddedVolet(null)}
      />

      {/* ---- Transcript sheet (tap on the provenance chip) ---- */}
      {voletOpen && cap !== null ? (
        <View style={styles.sheetWrap}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setVoletOpen(false)}
          />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle} numberOfLines={1}>
                Transcript · p.{cap.page + 1}/{cap.totalPages} ·{' '}
                {cap.notePath.split('/').pop()}
              </Text>
              <TouchableOpacity
                onPress={() => setVoletOpen(false)}
                style={styles.sheetClose}>
                <Text style={styles.sheetCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.voletSrcRow}>
              <Text style={[styles.sheetSrc, styles.flexOne]} numberOfLines={1}>
                Source: {voletEntry?.label ?? '…'}
              </Text>
              {/* v0.88.5 (user): jump to this very page in the Library. */}
              <TouchableOpacity
                onPress={() => {
                  setLibTargetIntent({doc: cap.notePath, page: cap.page});
                  setNavIntent('library');
                  (
                    PluginManager as {
                      showPluginView?: () => Promise<unknown>;
                    }
                  ).showPluginView?.().catch(() => {});
                  setVoletOpen(false);
                  onClose();
                }}
                hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}>
                <Text style={styles.voletLibLink}>📚 Open in Library ›</Text>
              </TouchableOpacity>
            </View>
            {voletEditing ? (
              <TextInput
                style={[styles.sheetBody, styles.sheetEdit, msgText]}
                value={voletDraft}
                onChangeText={setVoletDraft}
                multiline
                onTouchStart={() => setPanelFocusable(true)}
                onFocus={() => setPanelFocusable(true)}
                onBlur={() => setPanelFocusable(false)}
              />
            ) : (
              <ScrollView style={styles.sheetBody}>
                {voletEntry !== null && voletEntry.text.length > 0 ? (
                  <MarkdownView
                    text={voletEntry.text}
                    scale={scale}
                    baseStyle={styles.bubbleText}
                    selectable
                  />
                ) : (
                  <Text selectable style={[styles.bubbleText, msgText]}>
                    {voletEntry === null
                      ? '…'
                      : voletOff
                      ? '(no transcript)'
                      : '(empty: this page has no transcript yet. Redo AI transcript to create one)'}
                  </Text>
                )}
              </ScrollView>
            )}
            {voletEditing ? (
              <View style={styles.sheetBtns}>
                <TouchableOpacity
                  onPress={() => setVoletEditing(false)}
                  style={styles.actBtn2}>
                  <Text style={styles.actBtn2Text}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={onEditSave}
                  style={[styles.actBtn2, styles.actBtnDark]}>
                  <Text style={[styles.actBtn2Text, {color: '#ffffff'}]}>
                    Save (manual, top rank)
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.sheetBtns}>
                {voletOff ? (
                  <Text style={styles.offWarn}>
                    ⚠ No transcript available: sync is set to "Off" for
                    this note. You can still ask the Chat about it.
                  </Text>
                ) : null}
                <TouchableOpacity
                  onPress={() => voletEntry && onCopy(voletEntry.text, 'volet')}
                  disabled={!voletEntry || voletEntry.text.length === 0}
                  style={styles.actBtn2}>
                  <Text style={styles.actBtn2Text}>
                    {copied === 'volet' ? '✓ copied' : 'Copy'}
                  </Text>
                </TouchableOpacity>
                {ctxMode === 'page' ? (
                  <TouchableOpacity
                    onPress={() => {
                      setVoletDraft(voletEntry?.text ?? '');
                      setVoletEditing(true);
                    }}
                    disabled={cap === null || !isNotePath(cap.notePath)}
                    style={styles.actBtn2}>
                    <Text style={styles.actBtn2Text}>Edit</Text>
                  </TouchableOpacity>
                ) : null}
                {ctxMode !== 'page' ? null : (
                <TouchableOpacity
                  // v0.80.0 (audit M2): while a re-read runs, this SAME
                  // button becomes its Stop — a paid call is never a
                  // frozen wait.
                  onPress={() =>
                    rereading ? rereadAbortRef.current?.abort() : onReread()
                  }
                  disabled={!rereading && (voletOff || keyState.kind !== 'ok')}
                  style={[
                    styles.actBtn2,
                    rereading && styles.actBtnBusy,
                    // v0.80.1 (user): armed = inverted video, everywhere.
                    confirmOverwrite === 'reread' && {backgroundColor: '#000000'},
                    voletOff && styles.actBtnOff,
                  ]}>
                  <Text
                    style={[
                      styles.actBtn2Text,
                      (rereading || confirmOverwrite === 'reread') && {
                        color: '#ffffff',
                      },
                    ]}>
                    {rereading
                      ? '⏹ Stop redo'
                      : confirmOverwrite === 'reread'
                      ? 'Overwrite manual edit?'
                      : 'Redo AI transcript'}
                  </Text>
                </TouchableOpacity>
                )}
                {/* Rotation is a NOTE-page operation: the single-page PDF
                    re-read has no rotate argument, so on a PDF these two
                    buttons silently did a plain redo (verification pass
                    2026-08-12). Hidden rather than lying. */}
                {ctxMode !== 'page' ||
                (cap !== null && !isNotePath(cap.notePath)) ? null : (
                <>
                <TouchableOpacity
                  onPress={() => onReread(90)}
                  disabled={rereading || voletOff || keyState.kind !== 'ok'}
                  style={[
                    styles.actBtn2,
                    voletOff && styles.actBtnOff,
                  ]}>
                  <Text style={styles.actBtn2Text}>
                    ↻ Rotate right + redo
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onReread(270)}
                  disabled={rereading || voletOff || keyState.kind !== 'ok'}
                  style={[
                    styles.actBtn2,
                    voletOff && styles.actBtnOff,
                  ]}>
                  <Text style={styles.actBtn2Text}>
                    ↺ Rotate left + redo
                  </Text>
                </TouchableOpacity>
                </>
                )}
              </View>
            )}
          </View>
        </View>
      ) : null}

      {/* ---- Historique (v0.21): list + resume ---- */}
      <HistorySheet
        styles={styles}
        open={histOpen}
        histList={histList}
        currentConvId={convId.current}
        agents={agents}
        confirmDelId={confirmDelId}
        fmtDay={fmtDay}
        onResume={onResume}
        onDeleteConv={onDeleteConv}
        onNewChat={onNewChat}
        onClose={() => setHistOpen(false)}
      />

      <OffGateDialog
        styles={styles}
        ask={offAsk}
        onCancel={onDialogCancel}
        onOk={onOffOk}
      />

      <AgentGapsDialog
        styles={styles}
        ask={agentGapAsk}
        onCancel={() => {
          setAgentGapAsk(null);
          setAgentId(null); // back to the card, nothing chosen
        }}
        onChatAnyway={() => setAgentGapAsk(null)}
        onReadNow={onAgentReadGaps}
      />

      <EstimateDialog
        styles={styles}
        ask={estimateAsk}
        onCancel={onDialogCancel}
        onRead={() => resumePending({skipEstimate: true})}
      />
    </View>
  );
}

// Header icon buttons — pure layout (no font), shared by the module-level
// IconBtn helper and the component, so they stay a plain module StyleSheet.
const iconStyles = StyleSheet.create({
  iconBtn: {paddingHorizontal: 4, paddingVertical: 6},
  iconBtnOff: {opacity: 0.3},
  icon: {width: 20, height: 20},
});
// (makeStyles moved to panelStyles.ts — Lot 2 structure split)
