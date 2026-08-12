/**
 * Library page view (deepest browser level): our transcript (markdown,
 * tappable low-confidence words), edit / word-fix / re-read controls,
 * handwritten page render and native Supernote OCR side by side.
 * Presentational: all state lives in LibraryScreen. Extracted VERBATIM
 * from App.tsx (phase 4, spec §2.2).
 */
import React from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import type {
  LowWord,
  TranscriptSource as StoreSource,
} from '../../src/core/store/transcriptStore';
import MarkdownView from '../../MarkdownView';
import {matchedLowWords} from '../../src/core/text/lowMatch';
import {makeTheme} from '../../src/ui/theme';
import AddToPicker, {
  type AddTarget,
  type PickerAgent,
} from '../../src/ui/AddToPicker';
import type {SubHeaderFn} from '../../App';

export interface PageViewProps {
  browseDoc: string;
  browsePage: number;
  browsePages: Array<{page: number; snippet: string; src: StoreSource | null}>;
  pageView: {text: string; label: string; low?: LowWord[]; staleFix?: boolean} | null;
  pageEditing: boolean;
  setPageEditing: (v: boolean) => void;
  pageDraft: string;
  setPageDraft: (v: string) => void;
  pageBusy: boolean;
  wordFix: {orig: string; draft: string; nth: number} | null;
  setWordFix: (v: {orig: string; draft: string; nth: number} | null) => void;
  pageImg: string | null;
  // v0.60.1: both render attempts failed — renders are host-bound
  // (generateNotePng needs the NOTE app, generateDocImage the DOC
  // reader), so tell the user instead of an eternal "…".
  pageImgFail: boolean;
  nativeOcr: string | null;
  keyOk: boolean;
  scale: number;
  btnScale: number;
  openPage: (page: number, docOverride?: string) => Promise<void>;
  savePageEdit: () => Promise<void>;
  applyWordFix: () => Promise<void>;
  rereadPage: (rotateDeg?: number) => Promise<void>;
  // v0.94 locks: a hand correction no longer freezes a page — this does.
  pageLocked: boolean;
  docLocked: boolean;
  onTogglePageLock: () => void;
  goToNotePage: (path: string, page: number) => void;
  refreshBrowsePages: (path: string) => Promise<void>;
  setBrowsePage: (v: number | null) => void;
  subHeader: SubHeaderFn;
  // v0.75: add THIS page to CHAT / an agent (spec §4c).
  agents: PickerAgent[];
  onAddContext: (
    target: AddTarget,
    opts: {folder?: string; docPath?: string; pages?: number[]},
  ) => void;
  ctxFlash: string;
}

function PageView({
  browseDoc,
  browsePage,
  browsePages,
  pageView,
  pageEditing,
  setPageEditing,
  pageDraft,
  setPageDraft,
  pageBusy,
  wordFix,
  setWordFix,
  pageImg,
  pageImgFail,
  nativeOcr,
  keyOk,
  scale,
  btnScale,
  openPage,
  savePageEdit,
  applyWordFix,
  rereadPage,
  pageLocked,
  docLocked,
  onTogglePageLock,
  goToNotePage,
  refreshBrowsePages,
  setBrowsePage,
  subHeader,
  agents,
  onAddContext,
  ctxFlash,
}: PageViewProps): React.JSX.Element {
  // v0.80.0 (audit): text/button-size settings apply here too — including
  // the page-nav / Edit / Redo buttons (they were fixed-size and ~28 px
  // tall, under the 30 px comfort floor the rest of the app uses).
  const styles = React.useMemo(
    () => ({
      ...makeTheme(scale, btnScale),
      ...local,
      pvNavBtn: {
        ...local.pvNavBtn,
        paddingHorizontal: 12 * btnScale,
        paddingVertical: 6 * btnScale,
        minHeight: 30 * btnScale,
        justifyContent: 'center' as const,
      },
      pvBtn: {
        ...local.pvBtn,
        paddingVertical: 8 * btnScale,
        paddingHorizontal: 10 * btnScale,
        minHeight: 30 * btnScale,
        justifyContent: 'center' as const,
      },
      pvBtnText: {...local.pvBtnText, fontSize: 12 * btnScale},
    }),
    [scale, btnScale],
  );
  const bp = {paddingHorizontal: 12 * btnScale, paddingVertical: 7 * btnScale};
  const bf = {fontSize: 13 * btnScale};
  // K13 (device feedback): the chosen text size applies to the config
  // pages themselves, not just the panel.
  const mf = {fontSize: 13 * scale, lineHeight: 20 * scale};
  const nf = {fontSize: 12 * scale, lineHeight: 17 * scale};

      const docName = browseDoc.split('/').pop() ?? browseDoc;
      return (
        <View style={styles.root}>
          {/* v0.80.0 (audit M12): labelled back — "‹ Pages" says where the
              back goes (the doc's page grid), unlike the bare ←. */}
          {subHeader(
            `${docName} · p.${browsePage + 1}`,
            () => {
              // Refresh the tile we just edited/re-read so the list shows the
              // new text immediately, then go back to the page grid.
              if (browseDoc !== null) {
                refreshBrowsePages(browseDoc);
              }
              setBrowsePage(null);
            },
            'Pages',
          )}
          <ScrollView contentContainerStyle={styles.body}>
            {(() => {
              const nums = browsePages.map(t => t.page);
              const idx = nums.indexOf(browsePage);
              const prev = idx > 0 ? nums[idx - 1] : null;
              const next =
                idx >= 0 && idx < nums.length - 1 ? nums[idx + 1] : null;
              return (
                <>
                  {/* TOP: our library transcript (2/3) | controls (1/3) */}
                  <View style={styles.pvTop}>
                    <View style={styles.pvLeft}>
                      {pageEditing ? (
                        <>
                          <TextInput
                            style={[styles.input, styles.pageEdit]}
                            value={pageDraft}
                            onChangeText={setPageDraft}
                            multiline
                          />
                          <View style={styles.chips}>
                            <TouchableOpacity
                              onPress={() => setPageEditing(false)}
                              style={[styles.chip, bp]}>
                              <Text style={[styles.chipText, bf]}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={savePageEdit}
                              style={[styles.chip, bp, styles.chipOn]}>
                              <Text style={[styles.chipText, bf, styles.chipTextOn]}>
                                Save (manual)
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </>
                      ) : (
                        <>
                          {wordFix !== null ? (
                            <View style={styles.qaCard}>
                              <Text style={[styles.modelNote, nf]}>
                                Correcting "{wordFix.orig}":
                              </Text>
                              <TextInput
                                style={styles.input}
                                value={wordFix.draft}
                                onChangeText={t =>
                                  setWordFix({...wordFix, draft: t})
                                }
                                autoCapitalize="none"
                                autoCorrect={false}
                              />
                              <View style={[styles.chips, styles.gapTop]}>
                                <TouchableOpacity
                                  onPress={applyWordFix}
                                  style={[styles.chip, bp, styles.chipOn]}>
                                  <Text
                                    style={[styles.chipText, bf, styles.chipTextOn]}>
                                    Replace
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  onPress={() => setWordFix(null)}
                                  style={[styles.chip, bp]}>
                                  <Text style={[styles.chipText, bf]}>Cancel</Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          ) : null}
                          <View style={styles.transcriptBox}>
                            {pageView !== null && pageView.text.length > 0 ? (
                              // Markdown rendered, with the OCR "unsure" words
                              // still bold + underlined and tappable to fix.
                              <MarkdownView
                                text={pageView.text}
                                scale={scale}
                                baseStyle={styles.manual}
                                selectable
                                lowWords={(pageView.low ?? []).map(w => w.t)}
                                onWordPress={(word, nth) =>
                                  setWordFix({orig: word, draft: word, nth})
                                }
                              />
                            ) : (
                              <Text style={[styles.manual, mf]} selectable>
                                {pageView === null ? '…' : '(empty)'}
                              </Text>
                            )}
                          </View>
                        </>
                      )}
                    </View>

                    <View style={styles.pvRight}>
                      <View style={styles.pvNav}>
                        <TouchableOpacity
                          disabled={prev === null}
                          onPress={() => prev !== null && openPage(prev)}
                          style={[styles.pvNavBtn, prev === null && styles.pageNavOff]}>
                          <Text style={styles.pvNavText}>‹</Text>
                        </TouchableOpacity>
                        <Text style={styles.pageNavPos}>
                          p.{browsePage + 1}
                          {nums.length > 0 ? `/${nums[nums.length - 1] + 1}` : ''}
                        </Text>
                        <TouchableOpacity
                          disabled={next === null}
                          onPress={() => next !== null && openPage(next)}
                          style={[styles.pvNavBtn, next === null && styles.pageNavOff]}>
                          <Text style={styles.pvNavText}>›</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={[styles.modelNote, nf]}>
                        Source: {pageView?.label ?? '…'}
                      </Text>
                      {pageView?.staleFix === true && !pageLocked && !docLocked ? (
                        <Text style={[styles.modelNote, nf, {fontWeight: '700'}]}>
                          ✎ Edited since your fix: the page's ink changed
                          after this manual correction, so it will be re-read.
                          Lock the page below to keep your text as it is.
                        </Text>
                      ) : null}
                      {pageLocked || docLocked ? (
                        <Text style={[styles.modelNote, nf, {fontWeight: '700'}]}>
                          🔒 {docLocked ? 'Document locked' : 'Page locked'}: no
                          automatic re-read, and "Redo AI transcript" declines.
                        </Text>
                      ) : null}
                      {(() => {
                        // Count only the low words the vision text still
                        // CONTAINS (user decision 2026-07-19): a word the
                        // vision rewrote was resolved — showing "10
                        // unsure" with 2 underlines read as a bug.
                        const shown = matchedLowWords(
                          pageView?.text ?? '',
                          (pageView?.low ?? []).map(w => w.t),
                        ).length;
                        return shown > 0 ? (
                          <Text style={[styles.modelNote, nf]}>
                            ⚠ {shown} unsure word(s), underlined bold in
                            the transcript; tap one to fix it.
                          </Text>
                        ) : null;
                      })()}
                      {!pageEditing ? (
                        <>
                          <TouchableOpacity
                            onPress={() =>
                              browseDoc !== null &&
                              goToNotePage(browseDoc, browsePage)
                            }
                            style={styles.pvBtn}>
                            <Text style={styles.pvBtnText}>↗ Go to this page</Text>
                          </TouchableOpacity>
                          <View style={styles.gapTop}>
                            <AddToPicker
                              scale={scale}
                              btnScale={btnScale}
                              label="+ Add this page to ▾"
                              agents={agents}
                              onPick={t =>
                                onAddContext(t, {
                                  docPath: browseDoc,
                                  pages: [browsePage],
                                })
                              }
                            />
                          </View>
                          {ctxFlash.length > 0 ? (
                            <Text
                              style={[styles.modelNote, nf, {fontWeight: '700'}]}>
                              {ctxFlash}
                            </Text>
                          ) : null}
                          <TouchableOpacity
                            onPress={() => {
                              setPageDraft(pageView?.text ?? '');
                              setPageEditing(true);
                            }}
                            style={[styles.pvBtn, styles.gapTop]}>
                            <Text style={styles.pvBtnText}>✎ Edit</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={onTogglePageLock}
                            disabled={docLocked}
                            style={[
                              styles.pvBtn,
                              styles.gapTop,
                              docLocked && styles.pageNavOff,
                            ]}>
                            <Text style={styles.pvBtnText}>
                              {docLocked
                                ? '🔒 Locked with the whole document'
                                : pageLocked
                                ? '🔓 Unlock this page'
                                : '🔒 Lock this page (no auto re-read)'}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => rereadPage()}
                            disabled={
                              pageBusy || !keyOk || pageLocked || docLocked
                            }
                            style={[
                              styles.pvBtn,
                              styles.gapTop,
                              (pageBusy || !keyOk || pageLocked || docLocked) &&
                                styles.pageNavOff,
                            ]}>
                            <Text style={styles.pvBtnText}>
                              {pageBusy ? '🔄 Redoing…' : '🔄 Redo AI transcript'}
                            </Text>
                          </TouchableOpacity>
                          {/* Option A (v0.84): PDF pages get OCR+Vision like
                              notes, so "Redo AI transcript" above re-reads a
                              page with Vision — the old standalone "Read with
                              Vision" button is gone. */}
                          <TouchableOpacity
                            onPress={() => rereadPage(90)}
                            disabled={
                              pageBusy || !keyOk || pageLocked || docLocked
                            }
                            style={[
                              styles.pvBtn,
                              styles.gapTop,
                              (pageBusy || !keyOk || pageLocked || docLocked) &&
                                styles.pageNavOff,
                            ]}>
                            <Text style={styles.pvBtnText}>
                              ↻ Rotate right + redo
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => rereadPage(270)}
                            disabled={
                              pageBusy || !keyOk || pageLocked || docLocked
                            }
                            style={[
                              styles.pvBtn,
                              styles.gapTop,
                              (pageBusy || !keyOk || pageLocked || docLocked) &&
                                styles.pageNavOff,
                            ]}>
                            <Text style={styles.pvBtnText}>
                              ↺ Rotate left + redo
                            </Text>
                          </TouchableOpacity>
                        </>
                      ) : null}
                    </View>
                  </View>

                  {/* BOTTOM: original page (note render OR PDF page,
                      v0.60 — one label for both) | native Supernote OCR */}
                  <View style={styles.pvBottom}>
                    <View style={[styles.pvCol, local.pvColOriginal]}>
                      <Text style={[styles.pvColLabel, nf]}>
                        Original page
                      </Text>
                      <View style={styles.pvBox}>
                        {pageImg !== null ? (
                          <Image
                            source={{uri: `data:image/png;base64,${pageImg}`}}
                            style={styles.pvBoxImg}
                            resizeMode="contain"
                          />
                        ) : (
                          <Text style={[styles.modelNote, nf]}>
                            {pageImgFail
                              ? '(no preview in this context: page renders ' +
                                'need the app showing this document: open ' +
                                'the plugin from the note/PDF and retry)'
                              : '…'}
                          </Text>
                        )}
                      </View>
                    </View>
                    {nativeOcr !== null ? (
                      <View style={styles.pvCol}>
                        <Text style={[styles.pvColLabel, nf]}>
                          Supernote live OCR
                        </Text>
                        <View style={styles.pvBox}>
                          <Text style={[styles.manual, mf]} selectable>
                            {nativeOcr}
                          </Text>
                        </View>
                      </View>
                    ) : null}
                  </View>
                </>
              );
            })()}
            <View style={styles.bottomPad} />
          </ScrollView>
        </View>
      );
}

const local = StyleSheet.create({
  pageEdit: {minHeight: 260, textAlignVertical: 'top'},
  transcriptBox: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 2,
    marginTop: 6,
  },
  pageNavOff: {opacity: 0.35},
  pageNavPos: {fontSize: 12, color: '#555555', fontVariant: ['tabular-nums']},
  // Page-review two-band layout (v0.26.4).
  pvTop: {flexDirection: 'row', gap: 12},
  pvLeft: {flex: 2},
  pvRight: {flex: 1, gap: 6},
  pvNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pvNavBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 5,
  },
  pvNavText: {fontSize: 16, fontWeight: '700', color: '#000000'},
  pvBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 5,
    marginTop: 2,
  },
  pvBtnText: {fontSize: 12, fontWeight: '700', color: '#000000'},
  pvBottom: {flexDirection: 'row', gap: 12, marginTop: 14, alignItems: 'flex-start'},
  pvCol: {flex: 1},
  // fix #2: cap the "Original page" card so it stays ~half-width and keeps
  // the overview even when the "live OCR" card next to it is hidden.
  pvColOriginal: {maxWidth: '49%'},
  pvColLabel: {fontWeight: '700', color: '#000000', marginBottom: 4},
  pvBox: {
    borderWidth: 1,
    borderColor: '#000000',
    backgroundColor: '#ffffff',
    padding: 6,
  },
  pvBoxImg: {width: '100%', aspectRatio: 3 / 4},
});

export default PageView;
