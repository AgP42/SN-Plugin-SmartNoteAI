/**
 * 3 · CHAT & AGENTS — ONE page for every assistant (v0.59 unification,
 * user decision: "the standard chat is just the default agent without
 * documents"). The list starts with the DEFAULT CHAT (persona, model,
 * answer style, quick actions — the historical settings fields, still
 * owned by App's debounced save) followed by up to MAX_AGENTS custom
 * agents (self-persisted immediately via updateSettings — the v0.57
 * one-writer rule is unchanged). Every entry edits through the same
 * collapsible ZONES; agents add Name & icon, Documents and the cost
 * pedagogy, and may OVERRIDE answer style / quick actions (absent =
 * inherit the CHAT defaults).
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {DEFAULT_MODEL} from '../src/core/config/keyFile';
import {
  MISTRAL_MODELS,
  modelLacksTools,
  inputPriceEurPerM,
} from '../src/core/model/catalog';
import {
  DEFAULT_SYSTEM,
  NO_LIVE_TOOLS_LINE,
  WEB_TOOL_LINE,
} from '../src/core/convo/compose';
import {
  MAX_QUICK_ACTIONS,
  type QuickActionItem,
} from '../src/core/actions/quickActions';
import {
  MAX_AGENTS,
  PRESET_AGENTS,
  MAX_IMAGE_QUICK_ACTIONS,
  estimateAgentCost,
  resolveAgentDocs,
  type Agent,
} from '../src/core/agents/agents';
import {InlineMenu} from '../src/ui/AddToPicker';
import {useScrollToFocused} from '../src/ui/useScrollToFocused';
import {BigTextInput} from '../src/ui/BigTextInput';
import {effectiveMode, type AutoTarget} from '../src/core/store/autoEngine';
import {
  updateSettingsWith,
  readSettings,
  subscribeSettings,
} from '../src/native/settings';
import {loadStore} from '../src/native/transcriptStoreIo';
import {getPage} from '../src/core/store/transcriptStore';
import type {DocSummary} from '../src/core/store/transcriptStore';
import {useArmedConfirm} from '../src/ui/useArmedConfirm';
import {useModelInfo} from '../src/ui/useModelInfo';
import {theme, makeTheme} from '../src/ui/theme';
import type {ChipRowFn, KeyState, SubHeaderFn} from '../App';

export interface ChatAgentsScreenProps {
  keyState: KeyState;
  model: string;
  setModel: (v: string) => void;
  persona: string;
  setPersona: (v: string) => void;
  answerStyle: 'precise' | 'balanced' | 'creative';
  setAnswerStyle: (v: 'precise' | 'balanced' | 'creative') => void;
  // v0.81 lasso: image quick actions (max 3) shown only when a lasso image
  // is in context. Edited here in the CHAT entry.
  imageQuickActions: QuickActionItem[];
  setImageQuickActions: React.Dispatch<React.SetStateAction<QuickActionItem[]>>;
  goLibrary: () => void;
  quickActions: QuickActionItem[];
  setQuickActions: React.Dispatch<React.SetStateAction<QuickActionItem[]>>;
  agents: Agent[];
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  autoTargets: Record<string, AutoTarget>;
  lib: DocSummary[];
  scale: number;
  btnScale: number;
  chipRow: ChipRowFn;
  subHeader: SubHeaderFn;
}

const newAgentId = (): string =>
  `ag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// Predefined icon choices (v0.55.1, device feedback: the Supernote
// keyboard has no emoji — a free-text field was unusable). A grid to
// tap; settings hand-edited with any other emoji still work.
const AGENT_ICONS = [
  '🤖',
  '🎓',
  '📋',
  '💼',
  '📚',
  '⚖️',
  '📈',
  '🛠️',
  '💡',
  '🌍',
  '✈️',
  '🍳',
  '🏥',
  '🧪',
  '🎨',
  '❤️',
];

const STYLE_CHIPS = [
  ['precise', 'Precise'],
  ['balanced', 'Balanced'],
  ['creative', 'Creative'],
] as ['precise' | 'balanced' | 'creative', string][];

// 'default' selects the standard CHAT entry; anything else is an agent id.
type SelKey = 'default' | string;

// The quick-actions editor, shared by the DEFAULT entry (App state) and
// the per-agent override (agent field) — same UI as the old
// ChatConfigScreen, writing through a plain onChange.
function QaEditor({
  list,
  onChange,
  mf,
  onInputFocus,
}: {
  list: QuickActionItem[];
  onChange: (next: QuickActionItem[]) => void;
  mf: {fontSize: number; lineHeight: number};
  // Keyboard fix (2026-08-03): the parent scrolls the field into view.
  onInputFocus?: (evt: unknown) => void;
}): React.JSX.Element {
  const patch = (i: number, p: Partial<QuickActionItem>): void =>
    onChange(list.map((a, j) => (j === i ? {...a, ...p} : a)));
  const move = (i: number, dir: -1 | 1): void => {
    const j = i + dir;
    if (j < 0 || j >= list.length) {
      return;
    }
    const copy = list.slice();
    [copy[i], copy[j]] = [copy[j], copy[i]];
    onChange(copy);
  };
  return (
    <>
      <Text style={[styles.manual, mf]}>
        Toggle which appear in the panel (ON/off), reorder with ↑ ↓.
      </Text>
      {list.map((a, i) => (
        <View key={i} style={styles.qaCard}>
          <View style={local.qaRow}>
            <TouchableOpacity
              onPress={() => patch(i, {enabled: !a.enabled})}
              style={[local.qaToggle, a.enabled && styles.chipOn]}>
              <Text
                style={[local.qaToggleText, a.enabled && styles.chipTextOn]}>
                {a.enabled ? 'ON' : 'off'}
              </Text>
            </TouchableOpacity>
            <TextInput
              style={[styles.input, local.qaLabel]}
              value={a.label}
              onChangeText={t => patch(i, {label: t})}
              placeholder="Button label"
              onFocus={onInputFocus}
            />
            <TouchableOpacity onPress={() => move(i, -1)} style={local.qaMini}>
              <Text style={local.qaMiniText}>↑</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => move(i, 1)} style={local.qaMini}>
              <Text style={local.qaMiniText}>↓</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onChange(list.filter((_, j) => j !== i))}
              style={local.qaMini}>
              <Text style={local.qaMiniText}>✕</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={[styles.input, local.qaPrompt]}
            value={a.prompt}
            onChangeText={t => patch(i, {prompt: t})}
            placeholder="Prompt sent to the AI…"
            multiline
            onFocus={onInputFocus}
          />
        </View>
      ))}
      {list.length < MAX_QUICK_ACTIONS ? (
        <TouchableOpacity
          onPress={() =>
            onChange([
              ...list,
              {label: 'New action', prompt: '', enabled: true},
            ])
          }
          style={[styles.smallBtn, styles.gapTop]}>
          <Text style={styles.smallBtnText}>+ Add action</Text>
        </TouchableOpacity>
      ) : null}
    </>
  );
}

function ChatAgentsScreen({
  keyState,
  model,
  setModel,
  persona,
  setPersona,
  answerStyle,
  imageQuickActions,
  setImageQuickActions,
  goLibrary,
  setAnswerStyle,
  quickActions,
  setQuickActions,
  agents,
  setAgents,
  autoTargets,
  lib,
  scale,
  btnScale,
  chipRow,
  subHeader,
}: ChatAgentsScreenProps): React.JSX.Element {
  // Keyboard fix (2026-08-03, user: typing a lasso quick action was
  // blind): any focused field scrolls clear of the soft keyboard.
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollToFocused = useScrollToFocused(scrollRef);
  // v1.0.34 (coherence with Door 2's "Full prompt" sections): show what the
  // chat actually sends as its system prompt.
  const [showChatPrompt, setShowChatPrompt] = useState<boolean>(false);
  // v0.80.0 (audit): text/button-size settings apply here too (shadows the
  // module-level unscaled `styles` that QaEditor keeps using).
  // eslint-disable-next-line @typescript-eslint/no-shadow
  const styles = useMemo(
    () => ({
      ...makeTheme(scale, btnScale),
      ...local,
      // v0.80.1 (device): the door-3 tappables follow the Button-size
      // setting — entry rows, zone headers and icon cells had fixed pads.
      row: {
        ...local.row,
        paddingHorizontal: 12 * btnScale,
        paddingVertical: 10 * btnScale,
        minHeight: 30 * btnScale,
      },
      zoneHead: {
        ...local.zoneHead,
        paddingHorizontal: 12 * btnScale,
        paddingVertical: 10 * btnScale,
      },
      qaMini: {
        ...local.qaMini,
        width: 34 * btnScale,
        height: 34 * btnScale,
      },
    }),
    [scale, btnScale],
  );
  const [selKey, setSelKey] = useState<SelKey>('default');
  // Open zones, per selected entry (collapse everything on switch).
  const [openZones, setOpenZones] = useState<Set<string>>(new Set());
  const toggleZone = useCallback((id: string): void => {
    setOpenZones(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);
  const select = useCallback((k: SelKey): void => {
    setSelKey(k);
    setOpenZones(new Set());
  }, []);

  // chars of stored text per doc path — the cost estimate's raw material.
  const [charsByPath, setCharsByPath] = useState<Map<string, number>>(
    new Map(),
  );
  // Per-page chars (N3, 2026-08-12): pages PINNED to an agent (a.docPages) are
  // sent and billed but were absent from the cost/knowledge estimate, so an
  // agent whose context is entirely pinned pages showed "0 doc · 0 page · ~0¢".
  // Keyed `${path}#${page}` so the estimate can price the exact pinned pages.
  const [pageChars, setPageChars] = useState<Map<string, number>>(new Map());
  const {armed: delArmed, confirm: confirmDel} = useArmedConfirm(4000);
  const modelInfo = useModelInfo(
    keyState.kind === 'ok' ? keyState.config.apiKey : null,
  );

  // v0.88 (audit): the screen is KEPT MOUNTED by PluginHost across
  // close/reopen, so a mount-only resync missed everything written while it
  // was backgrounded (Library/panel doc adds). Subscribe to the settings
  // notifications instead — one initial pull, then live for as long as the
  // screen exists. Writes are queue-transformed (apply), so this is purely
  // a DISPLAY sync and can never overwrite anything.
  useEffect(() => {
    let alive = true;
    const pull = (): void => {
      readSettings()
        .then(s => {
          if (alive) {
            const fresh = s.agents ?? [];
            setAgents(prev =>
              JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh,
            );
          }
        })
        .catch(() => {});
    };
    pull();
    const unsub = subscribeSettings(pull);
    return () => {
      alive = false;
      unsub();
    };
  }, [setAgents]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const store = await loadStore();
      if (!alive) {
        return;
      }
      const m = new Map<string, number>();
      const pm = new Map<string, number>();
      for (const d of lib) {
        let chars = 0;
        for (let p = 0; p < Math.max(d.total, d.read); p++) {
          const e = getPage(store, d.path, p);
          if (e !== null) {
            chars += e.text.length;
            // TRIMMED length (re-audit 2026-08-12): the send drops a
            // whitespace-only page (text.trim().length===0), so the estimate
            // must too — otherwise a blank OCR page shows as read + billed.
            pm.set(`${d.path}#${p}`, e.text.trim().length);
          }
        }
        m.set(d.path, chars);
      }
      setCharsByPath(m);
      setPageChars(pm);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [lib]);

  const sel = agents.find(a => a.id === selKey) ?? null;

  // ---- agent SELF-PERSISTENCE (v0.57 immediate / v0.58 singleton) ----
  // Unchanged by the unification: the DEFAULT entry's fields stay owned
  // by App's debounced save (its setters below), the agents field stays
  // owned by THIS screen, written immediately and visibly.
  const [saveInfo, setSaveInfo] = useState<string>('');
  // Last non-empty name per agent (audit 2026-07-19 C4): the writer
  // fires per keystroke and catches the Name field mid-edit — but
  // sanitizeAgents DROPS nameless agents at the next load, so clearing
  // the field silently destroyed the agent (and a send mid-conversation
  // fell back to standard Chat without saying so). The UI keeps the
  // empty draft; the DISK always gets a real name.
  const lastNames = useRef(new Map<string, string>());
  useEffect(() => {
    for (const a of agents) {
      if (a.name.trim().length > 0) {
        lastNames.current.set(a.id, a.name);
      }
    }
  }, [agents]);
  // v0.88 (audit — the three-writer `agents` incident class): every mutation
  // is computed INSIDE the settings write queue against the FRESH disk
  // state, as a per-operation transform — never "persist my whole React
  // array". A doc added to an agent from the Library/panel while this
  // screen is up can no longer be wiped by the next keystroke here, and
  // the local state is re-synced to the merged truth after each write.
  const apply = useCallback(
    (transform: (cur: Agent[]) => Agent[]): void => {
      updateSettingsWith(s => {
        const cur = s.agents ?? [];
        const safe = transform(cur).map(a =>
          a.name.trim().length > 0
            ? a
            : {...a, name: lastNames.current.get(a.id) ?? 'Agent'},
        );
        setAgents(safe); // UI mirrors the merged truth
        return {agents: safe};
      })
        .then(ok => {
          setSaveInfo(
            ok
              ? `✓ saved ${new Date().toTimeString().slice(0, 8)}`
              : '⚠ SAVE FAILED: settings not writable',
          );
          if (!ok) {
            console.log(
              '[SmartNoteAI.agents]',
              'SAVE FAILED (write returned false)',
            );
          }
        })
        .catch(e => {
          console.warn('[SmartNoteAI.agents]', `save threw: ${String(e)}`);
          setSaveInfo('⚠ SAVE FAILED: see logcat');
        });
    },
    [setAgents],
  );

  const upd = useCallback(
    (id: string, patch: Partial<Agent>) => {
      apply(cur => cur.map(a => (a.id === id ? {...a, ...patch} : a)));
    },
    [apply],
  );

  const addAgent = useCallback(() => {
    if (agents.length >= MAX_AGENTS) {
      return;
    }
    const a: Agent = {
      id: newAgentId(),
      name: `Agent ${agents.length + 1}`,
      icon: '🤖',
      persona: '',
      model: '',
      docs: [],
    };
    apply(cur => (cur.length >= MAX_AGENTS ? cur : [...cur, a]));
    select(a.id);
  }, [agents.length, apply, select]);

  // Add a starter preset as an ordinary, fully-editable agent. A FRESH id
  // (not the preset's) so re-adding never collides with a seeded copy.
  const addPreset = useCallback(
    (preset: Agent) => {
      if (agents.length >= MAX_AGENTS) {
        return;
      }
      const a: Agent = {
        ...preset,
        id: newAgentId(),
        docs: [...preset.docs],
        quickActions: preset.quickActions?.map(q => ({...q})),
      };
      apply(cur => (cur.length >= MAX_AGENTS ? cur : [...cur, a]));
      select(a.id);
    },
    [agents.length, apply, select],
  );

  const deleteAgent = useCallback(
    (id: string) => {
      if (!confirmDel(id)) {
        return;
      }
      apply(cur => cur.filter(a => a.id !== id));
      select('default');
      // Conversations that talked to it survive, tagged, and reopen as
      // standard Chat (user decision) — nothing to cascade here.
    },
    [apply, confirmDel, select],
  );

  const isOff = useCallback(
    (path: string): boolean => effectiveMode(autoTargets, path) === 'off',
    [autoTargets],
  );

  // Estimate of the SELECTED agent's docs prefix.
  const estimate = useMemo(() => {
    if (sel === null) {
      return null;
    }
    const paths = resolveAgentDocs(
      sel.docs,
      lib.map(d => d.path),
    ).filter(p => !isOff(p));
    let chars = 0;
    let read = 0;
    let unread = 0;
    for (const p of paths) {
      chars += charsByPath.get(p) ?? 0;
      const d = lib.find(x => x.path === p);
      if (d) {
        read += d.read;
        // pdfCovered guard (audit 2026-07-19 #6): a fully-OCR'd PDF has
        // no entry for its blank/image pages — without the guard they
        // showed "not read yet" forever.
        unread += d.pdfCovered ? 0 : Math.max(0, d.total - d.read);
      }
    }
    // N3 (2026-08-12): PINNED pages (a.docPages) are sent + billed too, so they
    // must be in the estimate. Count only pages NOT already covered by a whole
    // doc above, and skip Off docs like everything else.
    const wholeDocs = new Set(paths);
    let pinnedDocs = 0;
    for (const [p, pgs] of Object.entries(sel.docPages ?? {})) {
      if (wholeDocs.has(p) || isOff(p)) {
        continue;
      }
      // Store-presence guard (re-audit 2026-08-12): the send only composes pages
      // of docs still IN the store (resolveAgentDocPages over storePaths). A pin
      // to a doc whose transcript was purged is dropped there, so skip it here
      // too — otherwise the card invents a doc and "N not synced".
      const d = lib.find(x => x.path === p);
      if (d === undefined) {
        continue;
      }
      pinnedDocs++;
      // pdfCovered guard (regression audit 2026-08-12): a pinned page of a
      // fully-OCR'd PDF has no per-page entry (pageChars miss → 0), so without
      // this it counted as unread forever, exactly the bug the whole-doc loop
      // guards above (audit 2026-07-19 #6).
      const covered = d.pdfCovered === true;
      for (const pg of pgs) {
        const c = pageChars.get(`${p}#${pg}`) ?? 0;
        chars += c;
        if (c > 0 || covered) {
          read++;
        } else {
          unread++;
        }
      }
    }
    const modelId = sel.model.trim() || DEFAULT_MODEL;
    const cost = estimateAgentCost(chars, inputPriceEurPerM(modelId));
    return {docs: paths.length + pinnedDocs, read, unread, ...cost};
  }, [sel, lib, charsByPath, pageChars, isOff]);

  const mf = {fontSize: 13 * scale, lineHeight: 20 * scale};
  const nf = {fontSize: 12 * scale, lineHeight: 17 * scale};
  const sf = {fontSize: 16 * scale};
  const bp = {paddingHorizontal: 10 * btnScale, paddingVertical: 8 * btnScale};

  const shortModel = (id: string): string =>
    (id.trim() || DEFAULT_MODEL).replace(/^mistral-|-latest$/g, '');

  /* ---------- collapsible zone ---------- */
  const zone = (
    id: string,
    title: string,
    summary: string,
    body: () => React.JSX.Element,
  ): React.JSX.Element => {
    const key = `${selKey}:${id}`;
    const open = openZones.has(key);
    return (
      <View key={key} style={local.zone}>
        <TouchableOpacity
          onPress={() => toggleZone(key)}
          style={styles.zoneHead}>
          <Text style={[local.zoneArrow, nf]}>{open ? '▾' : '▸'}</Text>
          <Text style={[local.zoneTitle, {fontSize: 14 * scale}]}>{title}</Text>
          {!open && summary.length > 0 ? (
            <Text style={[local.zoneSum, nf]} numberOfLines={1}>
              {summary}
            </Text>
          ) : null}
        </TouchableOpacity>
        {open ? <View style={local.zoneBody}>{body()}</View> : null}
      </View>
    );
  };

  /* ---------- entry rows ---------- */
  const entryRow = (
    key: SelKey,
    label: string,
    on: boolean,
  ): React.JSX.Element => (
    <TouchableOpacity
      key={key}
      onPress={() => select(key)}
      style={[styles.row, on && local.rowOn]}>
      <Text
        style={[local.rowText, nf, on && local.rowTextOn]}
        numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  /* ---------- model zone bodies ---------- */
  const defaultModelBody = (): React.JSX.Element => {
    const curId = model || DEFAULT_MODEL;
    const curInfo = modelInfo?.[curId];
    const noTools =
      curInfo?.tools !== undefined ? !curInfo.tools : modelLacksTools(curId);
    return (
      <>
        <Text style={[styles.manual, mf]}>
          Any Mistral model works in the field below. The presets are the ones
          that can use the chat's Web search tool. Default is Small: open, cheap
          and on par with the big ones in our tests.
        </Text>
        <View style={local.modelRow}>
          <TextInput
            style={[styles.input, local.modelInput]}
            value={model}
            onChangeText={setModel}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={DEFAULT_MODEL}
            onFocus={scrollToFocused}
          />
          <Text style={[styles.modelNote, nf, local.modelSide]}>
            {modelInfo === null
              ? ''
              : curInfo === undefined
              ? '⚠ unknown model id (checked live against api.mistral.ai)'
              : `"${curId}" currently points to ${
                  curInfo.resolvedId ?? curId
                }` +
                (curInfo.dep !== undefined
                  ? `\n⚠ deprecated ${curInfo.dep.slice(0, 10)}` +
                    (curInfo.depRepl !== undefined
                      ? ` → use ${curInfo.depRepl}`
                      : '')
                  : '')}
          </Text>
        </View>
        {chipRow(
          MISTRAL_MODELS.map(m => [m.id, m.label] as [string, string]),
          model,
          setModel,
        )}
        <Text style={[styles.modelNote, nf]}>
          {(MISTRAL_MODELS.find(m => m.id === model)?.note ??
            'custom model id') + ' · prices as of 07/2026'}
        </Text>
        {(() => {
          const d = MISTRAL_MODELS.find(m => m.id === model)?.desc;
          return d !== undefined ? (
            <Text style={[styles.modelNote, nf, local.mistralDesc]}>
              {`Mistral description: "${d}"`}
            </Text>
          ) : null;
        })()}
        <Text style={[styles.manual, mf, styles.gapTop]}>
          Web search (~0.01€ per search) is a ONE-SHOT button in the chat panel,
          next to Send: arm "Web (non-EU)" and it applies to your NEXT message
          only. Web answers cite their sources. It is the plugin's one request
          on Mistral's global endpoint — web search is not offered on EU
          regional inference (see door 1, Privacy).
          {noTools
            ? ' This model does not support tools. Pick Small, Medium or Large to use them.'
            : ''}
        </Text>
        <Text style={[local.subHead, {fontSize: 13 * scale}, styles.gapTop]}>
          Answer style
        </Text>
        <Text style={[styles.manual, mf]}>
          How freely the assistant words its answers. Precise sticks to the
          facts with stable wording; Creative allows looser phrasing; Balanced
          uses each model's own tuning.
        </Text>
        {chipRow(STYLE_CHIPS, answerStyle, setAnswerStyle)}
      </>
    );
  };

  const agentModelBody = (a: Agent): React.JSX.Element => {
    const curModelId = a.model.trim() || DEFAULT_MODEL;
    const curInfo = modelInfo?.[curModelId];
    return (
      <>
        <TextInput
          style={[styles.input]}
          value={a.model}
          onChangeText={t => upd(a.id, {model: t})}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={`${model || DEFAULT_MODEL} (CHAT default)`}
          onFocus={scrollToFocused}
        />
        {chipRow(
          MISTRAL_MODELS.map(m => [m.id, m.label] as [string, string]),
          a.model,
          v => upd(a.id, {model: v}),
        )}
        <Text style={[styles.modelNote, nf]}>
          {(MISTRAL_MODELS.find(m => m.id === curModelId)?.note ??
            'custom model id') + ' · prices as of 07/2026'}
          {curInfo !== undefined
            ? `\n→ ${curInfo.resolvedId ?? curModelId}` +
              (curInfo.ctx !== undefined
                ? ` · ${Math.round(curInfo.ctx / 1000)}k context`
                : '') +
              (curInfo.tools !== undefined
                ? ` · tools ${curInfo.tools ? '✓' : '✗'}`
                : '')
            : modelInfo !== null && curModelId.length > 0
            ? '\n⚠ unknown model id (checked live against api.mistral.ai)'
            : ''}
        </Text>
        <Text style={[local.subHead, {fontSize: 13 * scale}, styles.gapTop]}>
          Answer style
        </Text>
        <Text style={[styles.manual, mf]}>
          "Default" follows the CHAT answer style; the others override it for
          this agent's conversations.
        </Text>
        {chipRow(
          [['inherit', 'Default'], ...STYLE_CHIPS] as [string, string][],
          a.answerStyle ?? 'inherit',
          v =>
            upd(a.id, {
              answerStyle:
                v === 'inherit'
                  ? undefined
                  : (v as 'precise' | 'balanced' | 'creative'),
            }),
        )}
      </>
    );
  };

  /* ---------- documents zone body (agents) ---------- */
  // v0.75 (subject 10): the agent's context is now BUILT from the Library
  // ("+ Add to ▾ → this agent"); this zone is a read-only manifest of what
  // it holds, with Remove per entry and a jump to the Library. Folder refs
  // and whole notes live in a.docs (live); page-sets in a.docPages (static).
  const short = (p: string): string =>
    p.replace(/^\/storage\/emulated\/0\//, '');
  const leaf = (p: string): string => p.split('/').pop() ?? p;
  const manifestRow = (
    key: string,
    label: string,
    onRemove: () => void,
  ): React.JSX.Element => (
    <View key={key} style={local.mftRow}>
      <Text style={[local.mftText, nf]} numberOfLines={2}>
        {label}
      </Text>
      <TouchableOpacity onPress={onRemove} style={local.mftDel}>
        <Text style={local.mftDelText}>Remove</Text>
      </TouchableOpacity>
    </View>
  );
  const manifestBody = (a: Agent): React.JSX.Element => {
    const storePaths = lib.map(d => d.path);
    const wholeNotes = a.docs.filter(r => storePaths.includes(r));
    const folderRefs = a.docs.filter(r => !storePaths.includes(r));
    const pageEntries = Object.entries(a.docPages ?? {}).filter(
      ([p]) => !wholeNotes.includes(p),
    );
    const pinnedPages = pageEntries.reduce((n, [, pg]) => n + pg.length, 0);
    const empty =
      folderRefs.length === 0 &&
      wholeNotes.length === 0 &&
      pageEntries.length === 0;
    return (
      <>
        <Text style={[styles.manual, mf]}>
          Build this agent's context from the Library: open a folder, note or
          pages and tap “+ Add to ▾ → {a.icon} {a.name}”. Folders and whole
          notes stay live (future pages included); specific pages are fixed.
        </Text>
        <TouchableOpacity
          onPress={goLibrary}
          style={[styles.smallBtn, bp, styles.gapTop]}>
          <Text style={styles.smallBtnText}>Go to Library ›</Text>
        </TouchableOpacity>
        <Text style={[local.subHead, {fontSize: 13 * scale}, styles.gapTop]}>
          In this agent's context
        </Text>
        {empty ? (
          <Text style={[styles.manual, mf]}>
            Nothing yet: this agent has no stored context.
          </Text>
        ) : (
          <>
            {folderRefs.map(r =>
              manifestRow(r, `📁 ${short(r)}/  · live`, () =>
                upd(a.id, {docs: a.docs.filter(x => x !== r)}),
              ),
            )}
            {wholeNotes.map(r =>
              manifestRow(
                r,
                `📄 ${leaf(r)} · whole${isOff(r) ? ' · Off' : ''}`,
                () => upd(a.id, {docs: a.docs.filter(x => x !== r)}),
              ),
            )}
            {pageEntries.map(([p, pg]) =>
              manifestRow(
                `pg:${p}`,
                `📄 ${leaf(p)} · p. ${pg.map(n => n + 1).join(', ')}${
                  isOff(p) ? ' · Off' : ''
                }`,
                () => {
                  const dp = {...(a.docPages ?? {})};
                  delete dp[p];
                  upd(a.id, {
                    docPages: Object.keys(dp).length > 0 ? dp : undefined,
                  });
                },
              ),
            )}
          </>
        )}
        {pinnedPages > 0 ? (
          <Text style={[styles.manual, nf, styles.gapTop]}>
            + {pinnedPages} page(s) pinned individually.
          </Text>
        ) : null}
        {estimate !== null ? (
          <Text style={[styles.manual, mf, styles.gapTop]}>
            {estimate.docs} doc(s) · {estimate.read} page(s) read
            {estimate.unread > 0
              ? ` (+${estimate.unread} not read yet, offered when you pick the agent)`
              : ''}
            {'\n'}~{Math.round(estimate.tokens / 1000)}k tokens of context
            {estimate.firstMsgCents !== undefined
              ? ` → 1st message ~${estimate.firstMsgCents} cents · next ~${estimate.nextMsgCents} cents (cached −90%)`
              : ' · price unknown for this model id'}
            {estimate.tokens > 100_000
              ? '\n⚠ Larger than a 128k model context: trim the documents.'
              : ''}
            {'\n'}Less context = cheaper: half the pages ≈ half the price.
          </Text>
        ) : null}
      </>
    );
  };

  /* ---------- per-entry zone sets ---------- */
  const qaSummary = (list: QuickActionItem[]): string =>
    `${list.filter(q => q.enabled).length} on / ${list.length}`;

  // v0.75 re-layout (subject 1): one "Model" zone (model + tools + answer
  // style) FIRST, then "Persona (System prompt)", then "Quick actions".
  const defaultZones = (): React.JSX.Element[] => [
    zone(
      'model',
      'Model',
      `${shortModel(model)} · ${answerStyle}`,
      defaultModelBody,
    ),
    zone(
      'persona',
      'Persona (System prompt)',
      persona.trim().length > 0 ? persona : 'default',
      () => (
        <>
          <Text style={[styles.manual, mf]}>
            Shapes how the assistant answers. Leave empty for the default.
          </Text>
          <BigTextInput
            style={[styles.input, styles.persona]}
            value={persona}
            onChangeText={setPersona}
            placeholder={DEFAULT_SYSTEM}
            scale={scale}
            btnScale={btnScale}
            onFocus={scrollToFocused}
          />
          {/* v1.0.34 — same transparency as Door 2's assembled prompts: the
              REAL system prompt of a chat message, piece by piece. */}
          <TouchableOpacity onPress={() => setShowChatPrompt(v => !v)}>
            <Text
              style={[styles.section, {fontSize: 16 * scale}, styles.gapTop]}>
              {showChatPrompt ? '▾' : '▸'} Full prompt — what the chat sends
            </Text>
          </TouchableOpacity>
          {showChatPrompt ? (
            <>
              <Text style={[styles.manual, mf]}>
                A chat message's system prompt is assembled from: your Persona
                above, used AS-IS (empty = no base instructions — nothing is
                substituted behind your back); when an agent is active, its
                persona and its documents section instead; when a lasso image is
                attached, the lasso directive (shown in READ config); and ONE of
                the two lines below, matching the Web button for THAT message.
              </Text>
              <Text style={[styles.label, {fontSize: 13 * scale}]}>
                Web NOT armed (every normal message):
              </Text>
              <View style={styles.qaCard}>
                <Text style={[styles.manual, mf]} selectable>
                  {NO_LIVE_TOOLS_LINE.trim()}
                </Text>
              </View>
              <Text style={[styles.label, {fontSize: 13 * scale}]}>
                Web armed (that one message):
              </Text>
              <View style={styles.qaCard}>
                <Text style={[styles.manual, mf]} selectable>
                  {WEB_TOOL_LINE.trim()}
                </Text>
              </View>
              <Text style={[styles.modelNote, nf]}>
                Answers produced by a real web run carry a 🌐 badge; no badge
                means the answer came from the model's memory.
              </Text>
            </>
          ) : null}
        </>
      ),
    ),
    zone('qa', 'Quick actions', qaSummary(quickActions), () => (
      <QaEditor
        list={quickActions}
        onChange={setQuickActions}
        mf={mf}
        onInputFocus={scrollToFocused}
      />
    )),
  ];

  // v0.81 (user): the "image quick actions" editor for the CHAT entry —
  // up to 3 actions shown in the panel ONLY when a lasso image is in
  // context. Reuses the shared QaEditor.
  const imageQaZone = (): React.JSX.Element =>
    zone(
      'imageQa',
      'Lasso quick actions',
      `${imageQuickActions.filter(a => a.enabled).length} shown with an image`,
      () => (
        <>
          <Text style={[styles.manual, mf]}>
            Up to {MAX_IMAGE_QUICK_ACTIONS} quick actions that appear in the
            panel ONLY when a lassoed image is in the context, ahead of the
            normal ones. The image-reading instruction itself lives in door 2
            (READ → "Lasso · image reading").
          </Text>
          <QaEditor
            list={imageQuickActions}
            onChange={next =>
              setImageQuickActions(next.slice(0, MAX_IMAGE_QUICK_ACTIONS))
            }
            mf={mf}
            onInputFocus={scrollToFocused}
          />
        </>
      ),
    );

  const agentZones = (a: Agent): React.JSX.Element[] => [
    zone('name', 'Name & icon', `${a.icon} ${a.name}`, () => (
      <>
        <TextInput
          style={[styles.input]}
          value={a.name}
          onChangeText={t => upd(a.id, {name: t})}
          placeholder="Agent name"
          onFocus={scrollToFocused}
        />
        <View style={local.iconGrid}>
          {AGENT_ICONS.map(ic => {
            const on = a.icon === ic;
            return (
              <TouchableOpacity
                key={ic}
                onPress={() => upd(a.id, {icon: ic})}
                style={[local.iconCell, on && local.iconCellOn]}>
                <Text style={local.iconCellText}>{ic}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </>
    )),
    zone(
      'model',
      'Model',
      (a.model.trim().length > 0
        ? shortModel(a.model)
        : `CHAT (${shortModel(model)})`) +
        ` · ${a.answerStyle ?? 'style: CHAT'}`,
      () => agentModelBody(a),
    ),
    zone(
      'persona',
      'Persona (System prompt)',
      a.persona.trim().length > 0 ? a.persona : 'default',
      () => (
        <>
          <Text style={[styles.manual, mf]}>
            Who this agent is and how it should answer. Leave empty for the
            standard chat behaviour.
          </Text>
          <BigTextInput
            style={[styles.input, styles.persona]}
            value={a.persona}
            onChangeText={t => upd(a.id, {persona: t})}
            placeholder={DEFAULT_SYSTEM}
            scale={scale}
            btnScale={btnScale}
            onFocus={scrollToFocused}
          />
        </>
      ),
    ),
    zone(
      'qa',
      'Quick actions',
      a.quickActions !== undefined
        ? qaSummary(a.quickActions)
        : 'CHAT defaults',
      () =>
        a.quickActions === undefined ? (
          <>
            <Text style={[styles.manual, mf]}>
              This agent uses the CHAT quick actions. Customize to give it its
              own set (starts as a copy of the current ones).
            </Text>
            <TouchableOpacity
              onPress={() =>
                upd(a.id, {quickActions: quickActions.map(q => ({...q}))})
              }
              style={[styles.smallBtn, bp]}>
              <Text style={styles.smallBtnText}>Customize for this agent</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <QaEditor
              list={a.quickActions}
              onChange={next => upd(a.id, {quickActions: next})}
              mf={mf}
              onInputFocus={scrollToFocused}
            />
            <TouchableOpacity
              onPress={() => upd(a.id, {quickActions: undefined})}
              style={[styles.smallBtn, styles.gapTop, bp]}>
              <Text style={styles.smallBtnText}>
                Reset to CHAT quick actions
              </Text>
            </TouchableOpacity>
          </>
        ),
    ),
    zone(
      'docs',
      'Context documents & cost',
      `${a.docs.length + Object.keys(a.docPages ?? {}).length} entr${
        a.docs.length + Object.keys(a.docPages ?? {}).length === 1 ? 'y' : 'ies'
      }`,
      () => manifestBody(a),
    ),
  ];

  return (
    <View style={styles.root}>
      {/* v0.83.2 (user): the screen header matches the door button that
          leads here (H16) — consistent across all pages. */}
      {subHeader('3 · CHAT & AGENTS: your assistants')}
      <ScrollView ref={scrollRef} contentContainerStyle={styles.body}>
        <Text style={[styles.manual, mf]}>
          One page for every assistant. CHAT is the default one: its persona,
          model, answer style and quick actions apply everywhere unless an agent
          overrides them. An agent adds its own name and a set of library
          documents it always has in mind; you pick it when STARTING a
          conversation. Document text is read from your local transcripts (free)
          and repeated context is billed at 10% after the first message.
        </Text>

        {/* v0.80.0 (audit M3): count what the cap actually caps — CUSTOM
            agents (CHAT is the built-in default, always there). */}
        <Text style={[styles.section, sf]}>
          Your assistants · {agents.length}/{MAX_AGENTS} custom agents
          {saveInfo.length > 0 ? (
            <Text
              style={[
                local.saveInfo,
                nf,
                // audit M7: a FAILED save must not whisper in grey.
                saveInfo.startsWith('⚠') && {
                  color: '#000000',
                  fontWeight: '800',
                },
              ]}>
              {'   ' + saveInfo}
            </Text>
          ) : null}
        </Text>
        {entryRow(
          'default',
          `💬 CHAT (default) · ${shortModel(model)}`,
          selKey === 'default',
        )}
        {agents.map(a =>
          entryRow(
            a.id,
            `${a.icon} ${a.name} · ${shortModel(a.model.trim() || model)} · ${
              resolveAgentDocs(
                a.docs,
                lib.map(d => d.path),
              ).filter(p => !isOff(p)).length
            } doc(s)`,
            selKey === a.id,
          ),
        )}
        {agents.length < MAX_AGENTS ? (
          <View style={local.addRow}>
            <TouchableOpacity onPress={addAgent} style={[styles.smallBtn, bp]}>
              <Text style={styles.smallBtnText}>+ New agent</Text>
            </TouchableOpacity>
            <InlineMenu
              scale={scale}
              btnScale={btnScale}
              label="+ Add preset ▾"
              options={PRESET_AGENTS.map(p => ({
                key: p.id,
                label: `${p.icon} ${p.name}`,
                onPress: () => addPreset(p),
              }))}
            />
          </View>
        ) : null}

        <Text style={[styles.section, sf, styles.gapTop]}>
          {selKey === 'default'
            ? 'Edit · 💬 CHAT (default)'
            : sel !== null
            ? `Edit · ${sel.icon} ${sel.name}`
            : ''}
        </Text>
        {selKey === 'default'
          ? [...defaultZones(), imageQaZone()]
          : sel !== null
          ? [
              ...agentZones(sel),
              <TouchableOpacity
                key="delete"
                onPress={() => deleteAgent(sel.id)}
                style={[
                  styles.smallBtn,
                  styles.gapTop,
                  bp,
                  // v0.80.1 (user): armed = inverted video, everywhere.
                  delArmed === sel.id && {backgroundColor: '#000000'},
                ]}>
                <Text
                  style={[
                    styles.smallBtnText,
                    delArmed === sel.id && {color: '#ffffff'},
                  ]}>
                  {delArmed === sel.id
                    ? 'Delete this agent? (conversations are kept)'
                    : 'Delete agent'}
                </Text>
              </TouchableOpacity>,
            ]
          : null}
        <View style={styles.bottomPad} />
      </ScrollView>
    </View>
  );
}

const local = StyleSheet.create({
  row: {
    borderWidth: 1.5,
    borderColor: '#000000',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
    backgroundColor: '#ffffff',
  },
  rowOn: {backgroundColor: '#000000'},
  rowText: {color: '#000000', fontWeight: '600'},
  rowTextOn: {color: '#ffffff'},
  zone: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 8,
    marginTop: 8,
    backgroundColor: '#ffffff',
  },
  zoneHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  zoneArrow: {color: '#000000', width: 14},
  zoneTitle: {color: '#000000', fontWeight: '700'},
  zoneSum: {color: '#777777', flex: 1, textAlign: 'right'},
  zoneBody: {paddingHorizontal: 12, paddingBottom: 12},
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  iconCell: {
    borderWidth: 1.5,
    borderColor: '#000000',
    borderRadius: 8,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  iconCellOn: {backgroundColor: '#000000'},
  iconCellText: {fontSize: 22},
  subHead: {color: '#000000', fontWeight: '700'},
  addRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 8,
  },
  mftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#dddddd',
  },
  mftText: {color: '#000000', flex: 1},
  mftDel: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  mftDelText: {fontSize: 12, color: '#000000', fontWeight: '600'},
  saveInfo: {color: '#555555', fontWeight: '400'},
  // model zone (from the old ChatConfigScreen)
  modelRow: {flexDirection: 'row', gap: 10, alignItems: 'center'},
  modelInput: {flex: 1},
  modelSide: {flex: 1},
  mistralDesc: {fontStyle: 'italic'},
  // quick-actions editor (from the old ChatConfigScreen)
  qaRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  qaToggle: {
    borderWidth: 1.5,
    borderColor: '#000000',
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minWidth: 42,
    alignItems: 'center',
  },
  qaToggleText: {fontSize: 12, fontWeight: '700', color: '#000000'},
  qaLabel: {flex: 1, marginTop: 0},
  qaMini: {
    borderWidth: 1,
    borderColor: '#000000',
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qaMiniText: {fontSize: 16, color: '#000000'},
  qaPrompt: {minHeight: 54, maxHeight: 140, textAlignVertical: 'top'},
});
const styles = {...theme, ...local};

export default ChatAgentsScreen;
