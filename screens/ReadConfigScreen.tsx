/**
 * 2 · READ: AI transcript params — vision prompt blocks, glossary
 * suggestions, prompt test on the current page, assembled prompts.
 * Extracted VERBATIM from App.tsx (phase 4, spec §2.2).
 */
import React, {useCallback, useMemo, useRef, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
} from '../src/core/model/reader';
import {
  PROMPT_BLOCKS,
  PDF_PROMPT_BLOCKS,
  MAX_BLOCK_CHARS,
  assembleVisionPrompt,
  assemblePdfVisionPrompt,
} from '../src/core/model/visionPrompt';
import {DEFAULT_LASSO_DIRECTIVE} from '../src/core/agents/agents';
import {useArmedConfirm} from '../src/ui/useArmedConfirm';
import {BigTextInput} from '../src/ui/BigTextInput';
import {useScrollToFocused} from '../src/ui/useScrollToFocused';
import {suggestGlossaryWords} from '../src/core/store/glossarySuggest';
import {loadStore} from '../src/native/transcriptStoreIo';
import {makeTheme} from '../src/ui/theme';
import type {KeyState, SubHeaderFn} from '../App';

const PERSONA_OCR_PLACEHOLDER =
  'Notes in ENGLISH and SPANISH.\n' +
  'Topics: beekeeping business, permaculture garden.\n' +
  'People often mentioned: Dr Ramirez, Marta Okafor, uncle Bram.\n' +
  'Acronyms and jargon: IPM, CAP, HOA, top-bar hive, nuc box…';

export interface ReadConfigScreenProps {
  keyState: KeyState;
  promptBlocks: Record<string, string>;
  setPromptBlocks: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  // v0.81 lasso: the "there is an image to read" directive. Empty = send
  // nothing (the user's choice, never overridden).
  lassoDirective: string;
  setLassoDirective: (v: string) => void;
  refreshLib: () => Promise<void>;
  scale: number;
  btnScale: number;
  subHeader: SubHeaderFn;
}

function ReadConfigScreen({
  keyState: _keyState,
  promptBlocks,
  setPromptBlocks,
  lassoDirective,
  setLassoDirective,
  scale,
  btnScale,
  subHeader,
}: ReadConfigScreenProps): React.JSX.Element {
  // v0.81 (user): the bottom lasso field was hidden under the keyboard —
  // scroll it into view on focus (the plugin host doesn't adjustResize).
  const scrollRef = useRef<ScrollView>(null);
  const scrollToFocused = useScrollToFocused(scrollRef);
  // v0.80.0 (audit): text/button-size settings apply here too.
  const styles = useMemo(
    () => ({...makeTheme(scale, btnScale), ...local}),
    [scale, btnScale],
  );

  // v0.23 glossary suggestions (from low-confidence + frequent words).
  // v0.63.1 (user): the two assembled full prompts are LONG — collapsed
  // by default, one arrow each.
  const {armed: resetArmed, confirm: resetConfirm} = useArmedConfirm(4000);
  const [showNotePrompt, setShowNotePrompt] = useState<boolean>(false);
  const [showPdfPrompt, setShowPdfPrompt] = useState<boolean>(false);
  const [glosSuggest, setGlosSuggest] = useState<{
    unsure: string[];
    frequent: string[];
  } | null>(null);

  /* ---------- LIBRARY: glossary suggestions (v0.23) ---------- */

  const runGlosSuggest = useCallback(async () => {
    const s = await loadStore();
    setGlosSuggest(suggestGlossaryWords(s, promptBlocks.glossary ?? ''));
  }, [promptBlocks]);

  const addGlosWord = useCallback((w: string) => {
    setPromptBlocks(pb => {
      const cur = (pb.glossary ?? '').trimEnd();
      const sep = cur.length === 0 || /[,:;\n]$/.test(cur) ? ' ' : ', ';
      const next = (cur.length === 0 ? w : cur + sep + w).slice(0, MAX_BLOCK_CHARS);
      return {...pb, glossary: next};
    });
    setGlosSuggest(g =>
      g === null
        ? g
        : {
            unsure: g.unsure.filter(x => x !== w),
            frequent: g.frequent.filter(x => x !== w),
          },
    );
  }, [setPromptBlocks]);

  // v0.38 prompt-block editor: show the effective text (default or the
  // user's override); store an override ONLY when it differs from the
  // default, so an unchanged block keeps tracking future default
  // improvements instead of freezing a copy.
  const blockValue = useCallback(
    (id: string): string => {
      const b = [...PROMPT_BLOCKS, ...PDF_PROMPT_BLOCKS].find(
        x => x.id === id,
      );
      return promptBlocks[id] ?? b?.default ?? '';
    },
    [promptBlocks],
  );
  const setBlock = useCallback((id: string, text: string) => {
    const def =
      [...PROMPT_BLOCKS, ...PDF_PROMPT_BLOCKS].find(x => x.id === id)
        ?.default ?? '';
    setPromptBlocks(pb => {
      const next = {...pb};
      if (text === def) {
        delete next[id];
      } else {
        next[id] = text.slice(0, MAX_BLOCK_CHARS);
      }
      return next;
    });
  }, [setPromptBlocks]);

  /* ---------- LIBRARY: glossary test ---------- */


  // (Phase C, owner decision E: the paid "test the prompt" button is gone —
  // one fewer paid entry point to keep airtight. Test a prompt by re-reading
  // a real page from the Library or the chat: same result, same gates.)

  const bp = {paddingHorizontal: 12 * btnScale, paddingVertical: 7 * btnScale};
  const bf = {fontSize: 13 * btnScale};
  // K13 (device feedback): the chosen text size applies to the config
  // pages themselves, not just the panel.
  const mf = {fontSize: 13 * scale, lineHeight: 20 * scale};
  const nf = {fontSize: 12 * scale, lineHeight: 17 * scale};
  const sf = {fontSize: 16 * scale};
  const lf = {fontSize: 13 * scale};

  // ============ 2 · READ (transcript params) — shared blocks ============
  const glossarySuggestUI = (
            <>
            <TouchableOpacity
              onPress={runGlosSuggest}
              style={[styles.smallBtn, styles.gapTop]}>
              <Text style={styles.smallBtnText}>
                Suggest words from my library
              </Text>
            </TouchableOpacity>
            {glosSuggest !== null ? (
              glosSuggest.unsure.length === 0 &&
              glosSuggest.frequent.length === 0 ? (
                <Text style={[styles.modelNote, nf]}>
                  No suggestions yet: they build up as Mistral reads your
                  pages.
                </Text>
              ) : (
                <>
                  {glosSuggest.unsure.length > 0 ? (
                    <>
                      <Text style={[styles.label, lf]}>
                        The OCR often hesitates on these (tap to add):
                      </Text>
                      <View style={styles.chips}>
                        {glosSuggest.unsure.map(w => (
                          <TouchableOpacity
                            key={w}
                            onPress={() => addGlosWord(w)}
                            style={[styles.chip, bp]}>
                            <Text style={[styles.chipText, bf]}>+ {w}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  ) : null}
                  {glosSuggest.frequent.length > 0 ? (
                    <>
                      <Text style={[styles.label, lf]}>
                        Frequent names in your notes (tap to add):
                      </Text>
                      <View style={styles.chips}>
                        {glosSuggest.frequent.map(w => (
                          <TouchableOpacity
                            key={w}
                            onPress={() => addGlosWord(w)}
                            style={[styles.chip, bp]}>
                            <Text style={[styles.chipText, bf]}>+ {w}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  ) : null}
                </>
              )
            ) : null}
            </>
  );


  const ocrConfigBlock = (
    <>
        <Text style={[styles.manual, mf]}>
          Every page is read by Mistral OCR 4 and then by Vision
          (ministral-14b), which follows the prompt below. Each page is read
          the first time you ask about it (or in the background when set to
          Auto), stored in your library, and reused for free after. PDFs are
          read by OCR (printed text, correct multi-column order); a PDF page
          the OCR struggles with is escalated to Vision automatically, with a
          neutral document prompt (same blocks below, minus the
          notebook-specific ones).
        </Text>

        {/* v0.83.1 (user): a single reset for the WHOLE page — all prompt
            blocks AND the lasso directive back to their shipped defaults.
            v0.88 (audit): ARMED — one stray tap used to wipe the hand-built
            glossary (unrecoverable user content) with no confirmation. */}
        <View style={styles.libSectionRow}>
          <Text style={[styles.section, sf, styles.flex1]}>
            Vision prompt: what the AI is told
          </Text>
          <TouchableOpacity
            onPress={() => {
              if (!resetConfirm('page')) {
                return;
              }
              setPromptBlocks({});
              setLassoDirective(DEFAULT_LASSO_DIRECTIVE);
            }}
            style={styles.clearMini}>
            <Text style={styles.clearMiniText}>
              {resetArmed === 'page'
                ? 'Tap again to reset ALL blocks'
                : 'Reset to default · all this page'}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.manual, mf]}>
          Nothing is hidden: the full instruction sent to the model is these
          blocks, joined. Edit any of them. The Glossary (your names,
          acronyms, jargon) is the biggest quality lever.
        </Text>
        {(() => {
          // One editor card per block. Role and Fidelity exist in a .note
          // AND a .pdf variant → rendered SIDE BY SIDE (user request
          // 2026-07-18: "mets-les côte à côte"); the other blocks span the
          // full width with their scope tag.
          const editor = (b: (typeof PROMPT_BLOCKS)[number], tag: string) => (
            <View style={styles.flex1}>
              <View style={styles.libSectionRow}>
                <Text style={[styles.label, lf, styles.flex1]}>
                  {b.label}
                  {tag}
                </Text>
              </View>
              <Text style={[styles.modelNote, nf]}>{b.hint}</Text>
              {/* v0.83.1 (user): Paste / Clear / Reset to default on every
                  field (native drag extends a selection — no "select all"). */}
              <BigTextInput
                style={[styles.input, styles.persona]}
                value={blockValue(b.id)}
                onChangeText={t => setBlock(b.id, t)}
                placeholder={
                  b.id === 'glossary' ? PERSONA_OCR_PLACEHOLDER : b.default
                }
                scale={scale}
                btnScale={btnScale}
                defaultValue={b.default}
              />
              {b.id === 'glossary' ? glossarySuggestUI : null}
            </View>
          );
          const pdfTwin: Record<string, string> = {
            role: 'pdfRole',
            fidelity: 'pdfFidelity',
          };
          return PROMPT_BLOCKS.map(b => {
            const twinId = pdfTwin[b.id];
            if (twinId !== undefined) {
              const twin = PDF_PROMPT_BLOCKS.find(x => x.id === twinId);
              return (
                <View key={b.id} style={[styles.gapTop, styles.blockPair]}>
                  {editor(b, '   (.note only)')}
                  {twin !== undefined ? editor(twin, '   (.pdf only)') : null}
                </View>
              );
            }
            return (
              <View key={b.id} style={styles.gapTop}>
                {editor(
                  b,
                  b.id === 'template' ? '   (.note only)' : '   (.note + PDF)',
                )}
              </View>
            );
          });
        })()}


        <TouchableOpacity onPress={() => setShowNotePrompt(v => !v)}>
          <Text style={[styles.section, sf, styles.gapTop]}>
            {showNotePrompt ? '▾' : '▸'} Full prompt — handwritten pages
            (.note)
          </Text>
        </TouchableOpacity>
        {showNotePrompt ? (
          <View style={styles.qaCard}>
            <Text style={[styles.manual, mf]} selectable>
              {assembleVisionPrompt(promptBlocks)}
            </Text>
          </View>
        ) : null}

        <TouchableOpacity onPress={() => setShowPdfPrompt(v => !v)}>
          <Text style={[styles.section, sf, styles.gapTop]}>
            {showPdfPrompt ? '▾' : '▸'} Full prompt — PDF pages escalated to
            Vision
          </Text>
        </TouchableOpacity>
        {showPdfPrompt ? (
          <>
            <Text style={[styles.manual, mf]}>
              A PDF page the OCR struggles with is often hard PRINT (old scan,
              dense table), not handwriting, so its Vision pass uses a neutral
              document version of the prompt: the "(.pdf only)" Role and
              Fidelity blocks above, no notebook-template block, and your
              ".note + PDF" blocks exactly as you edited them.
            </Text>
            <View style={styles.qaCard}>
              <Text style={[styles.manual, mf]} selectable>
                {assemblePdfVisionPrompt(promptBlocks)}
              </Text>
            </View>
          </>
        ) : null}
    </>
  );

    return (
      <View style={styles.root}>
        {subHeader('2 · READ: AI transcript params')}
        <ScrollView ref={scrollRef} contentContainerStyle={styles.body}>
          {ocrConfigBlock}

          {/* v0.81 (user): the lasso "there is an image to read" directive.
              Editable; a Reset restores the default. Cleared = nothing is
              sent (never forced back). */}
          <Text style={[styles.section, sf, styles.gapTop]}>
            Lasso: image reading
          </Text>
          <Text style={[styles.manual, mf]}>
            When you lasso a part of a note and send it, this instruction is
            added to whichever chat or agent is active, telling the AI there is
            an image to read and act on. Edit it freely. Leave it EMPTY to send
            no instruction at all.
          </Text>
          <BigTextInput
            style={[styles.input, {minHeight: 120 * scale}]}
            value={lassoDirective}
            onChangeText={setLassoDirective}
            placeholder="(empty: no image instruction is sent)"
            scale={scale}
            btnScale={btnScale}
            defaultValue={DEFAULT_LASSO_DIRECTIVE}
            onFocus={scrollToFocused}
          />

          {/* v0.81: room to scroll the field clear of the on-screen keyboard. */}
          <View style={{height: 340 * scale}} />
        </ScrollView>
      </View>
    );
}

const local = StyleSheet.create({
  // Side-by-side .note / .pdf variants of a prompt block (v0.47.1).
  blockPair: {flexDirection: 'row', gap: 14},
});

export default ReadConfigScreen;
