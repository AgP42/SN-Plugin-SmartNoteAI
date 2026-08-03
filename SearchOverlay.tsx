/**
 * SearchOverlay (v0.54) — the armed-search face of the floating panel.
 * Replaces the old SearchPanel tab: the chat input field doubles as the
 * query field (🔍 armed mode); this overlay renders grammar hint,
 * interpretation echo, results and the per-hit actions:
 *   Transcript    — read the stored page here (inline view)
 *   Go to page ›  — open the note underneath (closes the overlay)
 *   + ctx / ✓ added — toggle the page into the conversation's pending
 *                   context (MULTI-select: the overlay stays open)
 *   Read & add    — META hit not read yet: paid read (two-tap cost
 *                   confirm), then added. Off files get none of these.
 *
 * Search itself is free/in-memory (useSmartSearch); only Read & add pays.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  NativeModules,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {loadStore} from './src/native/transcriptStoreIo';
import {getPage} from './src/core/store/transcriptStore';
import {type SearchHit} from './src/core/store/librarySearch';
import {highlightSnippet} from './SearchControls';
import MarkdownView from './MarkdownView';
import {
  GRAMMAR_HINT,
  SEARCH_LIMIT,
  useSmartSearch,
} from './src/ui/useSmartSearch';
import {useArmedConfirm} from './src/ui/useArmedConfirm';
import {readSettings} from './src/native/settings';
import {effectiveMode, type AutoTarget} from './src/core/store/autoEngine';
import {FULL_PAGE_READ_CENTS} from './src/core/model/reader';
import AddToPicker, {type PickerAgent} from './src/ui/AddToPicker';
import {addPagesToAgent, addDocRefToAgent} from './src/native/contextActions';

// One key per (doc, page) — the pendingCtx identity used by ChatPanel too.
export const ctxKeyOf = (path: string, page: number): string =>
  `${path}#${page}`;

// A Read & add pays both engine legs, like any live read.
const READ_ADD_CENTS = FULL_PAGE_READ_CENTS;

type Props = {
  scale: number;
  query: string;
  // Pages added to the conversation (ctxKeyOf keys). Value = SENT: an
  // already-sent page lives in the history for the whole conversation
  // and cannot be un-added (v0.54.1, user decision).
  added: ReadonlyMap<string, boolean>;
  onToggleAdd: (h: SearchHit) => void;
  // Paid read of an unread META hit; the caller reads, adds on success
  // and owns the error banner. Never called for Off files.
  onReadAdd: (h: SearchHit) => void;
  canReadAdd: boolean; // key ok + not busy
  readingKey: string | null; // ctxKey of the hit being read ('' = none)
  onClose: () => void; // Go to page navigated → back to chat
  // v0.75: configured agents, so each hit can also be added to an agent's
  // stored context (spec §4d, subject 7) beside the live "Add to CHAT".
  agents: PickerAgent[];
  // v0.76.2 (audit #2): add the WHOLE note (all its transcribed pages) to
  // the chat; returns how many pages were newly added.
  onAddNoteToChat: (path: string) => Promise<number>;
};

export default function SearchOverlay({
  scale,
  query,
  added,
  onToggleAdd,
  onReadAdd,
  canReadAdd,
  readingKey,
  onClose,
  agents,
  onAddNoteToChat,
}: Props): React.JSX.Element {
  const {hits, active, interp, truncated, zeroHint} = useSmartSearch(query);
  const [open, setOpen] = useState<SearchHit | null>(null);
  const [full, setFull] = useState<string>('');
  // Transient confirmation after an "Add to Agent" (no colour on e-ink —
  // a one-line banner instead).
  const [flash, setFlash] = useState<string>('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFlash = useCallback((msg: string) => {
    setFlash(msg);
    if (flashTimer.current !== null) {
      clearTimeout(flashTimer.current);
    }
    flashTimer.current = setTimeout(() => {
      if (mounted.current) {
        setFlash('');
      }
    }, 2500);
  }, []);
  const addToAgent = useCallback(
    async (h: SearchHit, id: string) => {
      const ok = await addPagesToAgent(id, [{path: h.path, page: h.page}]);
      const a = agents.find(x => x.id === id);
      showFlash(
        ok
          ? `✓ p.${h.page + 1} → ${a?.icon ?? ''} ${a?.name ?? 'agent'}`
          : '⚠ could not add (agent gone?)',
      );
    },
    [agents, showFlash],
  );
  // Off files are excluded from the AI: no + ctx, no Read & add (the
  // stored text may predate the Off switch — sending it would break the
  // gate). Modes are read fresh on every overlay mount.
  const [offTargets, setOffTargets] = useState<Record<string, AutoTarget>>({});
  const {armed: readArmed, confirm: confirmRead, disarm: disarmRead} =
    useArmedConfirm(4000);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    readSettings()
      .then(s => {
        if (mounted.current) {
          setOffTargets(s.autoTargets ?? {});
        }
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, []);

  const isOff = useCallback(
    (path: string): boolean => effectiveMode(offTargets, path) === 'off',
    [offTargets],
  );

  const openHit = useCallback(async (h: SearchHit) => {
    setOpen(h);
    setFull('…');
    const s = await loadStore();
    const e = getPage(s, h.path, h.page);
    if (mounted.current) {
      setFull(e !== null && e.text.length > 0 ? e.text : '(empty)');
    }
  }, []);

  // Jump the host note/PDF to a hit's page (native ACTION_VIEW intent).
  // Store pages are 0-indexed; the intent wants a 1-based page. The
  // note opens underneath — close the overlay so the chat (and the new
  // page's context) is what the user comes back to (v0.52 behaviour).
  const goToPage = useCallback(
    async (h: SearchHit) => {
      const ov = (
        NativeModules as {
          SmartNoteAiOverlay?: {
            openNoteAt?: (path: string, page: number) => Promise<unknown>;
          };
        }
      ).SmartNoteAiOverlay;
      try {
        await ov?.openNoteAt?.(h.path, h.page + 1);
      } catch {
        // best-effort
      }
      onClose();
    },
    [onClose],
  );

  const sm = {fontSize: 12 * scale};
  const xs = {fontSize: 10.5 * scale};

  // The Add to CHAT / ✓ added / Read & add / Off slot of one hit row.
  const addButton = (h: SearchHit): React.JSX.Element | null => {
    const key = ctxKeyOf(h.path, h.page);
    if (isOff(h.path)) {
      return (
        <View style={[styles.rowBtn, styles.rowBtnOff]}>
          <Text style={[styles.rowBtnTextOff, sm]}>Off</Text>
        </View>
      );
    }
    // Added state FIRST (audit 2026-07-19 #7): a META hit just read via
    // "Read & add" is in the added list, but the hit object still says
    // source undefined — testing META first re-offered the paid button.
    if (h.source === undefined && !added.has(key)) {
      // META hit, no transcript yet: paid read first (two-tap confirm).
      const reading = readingKey === key;
      const armed = readArmed === key;
      return (
        <TouchableOpacity
          onPress={() => {
            if (!canReadAdd || reading) {
              return;
            }
            if (confirmRead(key)) {
              onReadAdd(h);
            }
          }}
          disabled={!canReadAdd || reading}
          style={[
            styles.rowBtn,
            (armed || reading) && styles.rowBtnDark,
            !canReadAdd && styles.rowBtnOff,
          ]}>
          <Text
            style={[
              styles.rowBtnText,
              sm,
              (armed || reading) && styles.rowBtnTextDark,
              !canReadAdd && styles.rowBtnTextOff,
            ]}>
            {reading
              ? 'Reading…'
              : armed
              ? `~${READ_ADD_CENTS.toFixed(1)} c€, sure?`
              : 'Read & add'}
          </Text>
        </TouchableOpacity>
      );
    }
    const sent = added.get(key); // undefined = not added
    if (sent === true) {
      // In the conversation history — stays for the whole conversation.
      return (
        <View style={[styles.rowBtn, styles.rowBtnDark]}>
          <Text style={[styles.rowBtnTextDark, sm]}>✓ in CHAT</Text>
        </View>
      );
    }
    const isAdded = sent === false;
    return (
      <TouchableOpacity
        onPress={() => {
          disarmRead();
          onToggleAdd(h);
        }}
        style={[styles.rowBtn, isAdded && styles.rowBtnDark]}>
        <Text style={[styles.rowBtnText, sm, isAdded && styles.rowBtnTextDark]}>
          {isAdded ? '✓ added' : 'Add to CHAT'}
        </Text>
      </TouchableOpacity>
    );
  };

  // "+ Agent ▾" beside "Add to CHAT" (subject 7). Hidden for Off pages
  // (excluded from the AI, like the chat add).
  const agentAdd = (h: SearchHit): React.JSX.Element | null =>
    isOff(h.path) ? null : (
      <AddToPicker
        scale={scale}
        showChat={false}
        label="+ Agent ▾"
        agents={agents}
        onPick={t => {
          if (t.kind === 'agent') {
            addToAgent(h, t.id);
          }
        }}
      />
    );

  // "+ Note ▾" (audit #2): add the WHOLE note to CHAT (all pages) or to an
  // agent (a live whole-note ref). Hidden for Off notes.
  const noteName = (p: string): string => p.split('/').pop() ?? p;
  const noteAdd = (h: SearchHit): React.JSX.Element | null =>
    isOff(h.path) ? null : (
      <AddToPicker
        scale={scale}
        label="+ Whole note ▾"
        agents={agents}
        onPick={async t => {
          if (t.kind === 'chat') {
            const n = await onAddNoteToChat(h.path);
            showFlash(
              n > 0
                ? `✓ ${n} page(s) of ${noteName(h.path)} → CHAT`
                : `✓ ${noteName(h.path)} already in CHAT`,
            );
          } else {
            const ok = await addDocRefToAgent(t.id, h.path);
            const a = agents.find(x => x.id === t.id);
            showFlash(
              ok
                ? `✓ ${noteName(h.path)} (live) → ${a?.icon ?? ''} ${
                    a?.name ?? 'agent'
                  }`
                : '⚠ could not add (agent gone?)',
            );
          }
        }}
      />
    );

  // Reading one hit: full page transcript, read-only (+ the add toggle).
  if (open !== null) {
    return (
      <View style={styles.root}>
        <View style={styles.readHead}>
          <TouchableOpacity onPress={() => setOpen(null)} style={styles.back}>
            <Text style={styles.backText}>‹ Results</Text>
          </TouchableOpacity>
          <Text style={[styles.readTitle, sm]} numberOfLines={1}>
            {open.name} · p.{open.page + 1}
          </Text>
          {addButton(open)}
          {agentAdd(open)}
          {noteAdd(open)}
          <TouchableOpacity onPress={() => goToPage(open)} style={styles.goBtn}>
            <Text style={styles.goBtnText}>Go to page ›</Text>
          </TouchableOpacity>
        </View>
        {flash.length > 0 ? (
          <Text style={[styles.flash, xs]}>{flash}</Text>
        ) : null}
        <ScrollView style={styles.readBody} contentContainerStyle={styles.readPad}>
          <MarkdownView text={full} scale={scale} baseStyle={styles.readText} selectable />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {!active ? (
        <View style={styles.hintWrap}>
          <Text style={[styles.hintTitle, sm]}>
            Search your notes: type at least 2 characters.
          </Text>
          <Text style={[styles.hint, xs]}>{GRAMMAR_HINT}</Text>
          <Text style={[styles.hint, xs]}>
            Each result: "Transcript" reads it here · "Go to page ›" opens
            the note underneath · "Add to CHAT" attaches the page to the
            conversation (free, pick as many as you want) · "+ Agent ▾"
            stores the page in an agent's permanent context.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.interpRow}>
            <Text style={[styles.interp, xs]} numberOfLines={2}>
              → {interp}
            </Text>
          </View>
          {flash.length > 0 ? (
            <Text style={[styles.flash, xs]}>{flash}</Text>
          ) : null}
          {hits.length === 0 ? (
            <Text style={[styles.hint, sm, styles.hintPad]}>
              {zeroHint.length > 0 ? `No match. ${zeroHint}` : 'No match.'}
            </Text>
          ) : (
            <ScrollView style={styles.list} contentContainerStyle={styles.listPad}>
              <Text style={[styles.count, sm]}>{hits.length} result(s):</Text>
              {truncated ? (
                <Text style={[styles.warn, xs]}>
                  ⚠ Showing the first {SEARCH_LIMIT} matches only. Refine
                  your query to see the rest.
                </Text>
              ) : null}
              {hits.map(h => (
                <View key={ctxKeyOf(h.path, h.page)} style={styles.row}>
                  <TouchableOpacity onPress={() => openHit(h)}>
                    <Text style={[styles.name, sm]} numberOfLines={1}>
                      {h.name} · p.{h.page + 1}
                    </Text>
                    <Text style={[styles.snippet, sm]} numberOfLines={3}>
                      {highlightSnippet(h.snippet, h.terms, styles.hl)}
                    </Text>
                  </TouchableOpacity>
                  <View style={styles.rowBtns}>
                    <TouchableOpacity onPress={() => openHit(h)} style={styles.rowBtn}>
                      <Text style={[styles.rowBtnText, sm]}>Transcript</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => goToPage(h)} style={styles.rowBtn}>
                      <Text style={[styles.rowBtnText, sm]}>Go to page ›</Text>
                    </TouchableOpacity>
                    {addButton(h)}
                    {agentAdd(h)}
                    {noteAdd(h)}
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#ffffff'},
  hintWrap: {padding: 12, gap: 6},
  hintTitle: {color: '#000000', fontWeight: '700'},
  hint: {color: '#666666'},
  hintPad: {paddingHorizontal: 12, paddingTop: 8},
  interpRow: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#dddddd',
  },
  interp: {color: '#000000', opacity: 0.75},
  flash: {
    color: '#000000',
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: '#eeeeee',
  },
  warn: {color: '#000000', fontWeight: '700', marginBottom: 4},
  count: {color: '#555555', paddingBottom: 4},
  list: {flex: 1},
  listPad: {paddingHorizontal: 8, paddingBottom: 24},
  rowBtns: {flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap'},
  rowBtn: {borderWidth: 1, borderColor: '#000000', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 5},
  rowBtnDark: {backgroundColor: '#000000'},
  rowBtnOff: {borderColor: '#999999'},
  rowBtnText: {color: '#000000', fontWeight: '600'},
  rowBtnTextDark: {color: '#ffffff', fontWeight: '600'},
  rowBtnTextOff: {color: '#999999', fontWeight: '600'},
  row: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#dddddd',
    gap: 2,
  },
  name: {fontWeight: '700', color: '#000000'},
  snippet: {color: '#333333'},
  hl: {fontWeight: '700', color: '#000000'},
  readHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    flexWrap: 'wrap',
  },
  back: {paddingVertical: 4, paddingHorizontal: 6},
  backText: {fontSize: 13, fontWeight: '700', color: '#000000'},
  readTitle: {flex: 1, fontWeight: '700', color: '#000000', minWidth: 90},
  goBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#000000',
    borderRadius: 5,
  },
  goBtnText: {fontSize: 12, fontWeight: '700', color: '#ffffff'},
  readBody: {flex: 1},
  readPad: {padding: 12, paddingBottom: 40},
  readText: {color: '#000000'},
});
