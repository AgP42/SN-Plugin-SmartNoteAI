/**
 * Library page grid — one document's page tiles + export entry points
 * (whole doc, or ☐ Select pages for a partial export). Presentational:
 * all state lives in LibraryScreen. Extracted VERBATIM from App.tsx
 * (phase 4, spec §2.2).
 */
import React from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {SRC_LABEL} from '../../src/ui/labels';
import type {TranscriptSource as StoreSource} from '../../src/core/store/transcriptStore';
import type {ExportFormat} from '../../src/native/exporter';
import {makeTheme} from '../../src/ui/theme';
import AddToPicker, {
  InlineMenu,
  type AddTarget,
  type PickerAgent,
} from '../../src/ui/AddToPicker';
import {useArmedConfirm} from '../../src/ui/useArmedConfirm';
import type {SubHeaderFn} from '../../App';

export interface PageGridProps {
  browseDoc: string;
  browsePages: Array<{page: number; snippet: string; src: StoreSource | null}>;
  exportSel: Set<number> | null;
  setExportSel: React.Dispatch<React.SetStateAction<Set<number> | null>>;
  exporting: boolean;
  msg: string;
  // EXPORT "read first?" dialog — built by LibraryScreen (owner of the
  // export state); rendered on the grid AND main screens.
  exportAskCard: React.JSX.Element | null;
  exportDone: string | null;
  startExport: (
    groups: Array<{paths: string[]; baseDir: string | null}>,
    fmt: ExportFormat,
    label: string,
    selection?: number[],
  ) => Promise<void>;
  openPage: (page: number, docOverride?: string) => Promise<void>;
  setBrowseDoc: (v: string | null) => void;
  subHeader: SubHeaderFn;
  scale: number;
  btnScale: number;
  // v0.75: add the whole doc or the selected pages to CHAT / an agent.
  agents: PickerAgent[];
  onAddContext: (
    target: AddTarget,
    opts: {folder?: string; docPath?: string; pages?: number[]},
  ) => void;
  // #4 (user 2026-07-25): clear THIS document's local transcript by hand.
  onClearDocTranscript: (path: string) => Promise<void> | void;
  // v0.94 locks: freeze the WHOLE document against automatic re-reads.
  docLocked: boolean;
  lockedPages: number;
  onToggleDocLock: () => void;
  ctxFlash: string;
}

function PageGrid({
  browseDoc,
  browsePages,
  exportSel,
  setExportSel,
  exporting,
  msg,
  exportAskCard,
  exportDone,
  startExport,
  openPage,
  setBrowseDoc,
  subHeader,
  scale,
  btnScale,
  agents,
  onAddContext,
  onClearDocTranscript,
  docLocked,
  lockedPages,
  onToggleDocLock,
  ctxFlash,
}: PageGridProps): React.JSX.Element {
  // v0.80.0 (audit): text/button-size settings apply here too.
  const styles = React.useMemo(
    () => ({...makeTheme(scale, btnScale), ...local}),
    [scale, btnScale],
  );
  // v0.80.0 (audit): the shared armed-confirm hook (4 s auto-disarm)
  // replaces the hand-rolled state+setTimeout copy.
  const {armed: clearArmed, confirm: clearConfirm} = useArmedConfirm(4000);
  const bp = {paddingHorizontal: 12 * btnScale, paddingVertical: 7 * btnScale};
  const bf = {fontSize: 13 * btnScale};
  // K13 (device feedback): the chosen text size applies to the config
  // pages themselves, not just the panel.
  const mf = {fontSize: 13 * scale, lineHeight: 20 * scale};

      const docName = browseDoc.split('/').pop() ?? browseDoc;
      return (
        <View style={styles.root}>
          {/* v0.80.0 (audit M12): a labelled back ("‹ Library") like the
              Library's own "‹ Config" — the bare ← said nothing. */}
          {subHeader(
            docName,
            () => {
              setBrowseDoc(null);
              setExportSel(null); // selection is per-document (see openDoc)
            },
            'Library',
          )}
          <FlatList
            contentContainerStyle={styles.body}
            data={browsePages}
            keyExtractor={t => String(t.page)}
            numColumns={3}
            columnWrapperStyle={styles.gridRow}
            initialNumToRender={18}
            windowSize={7}
            removeClippedSubviews
            renderItem={({item: t}) => (
              <TouchableOpacity
                onPress={() =>
                  exportSel !== null
                    ? setExportSel(prev => {
                        const next = new Set(prev);
                        if (next.has(t.page)) {
                          next.delete(t.page);
                        } else {
                          next.add(t.page);
                        }
                        return next;
                      })
                    : openPage(t.page)
                }
                style={[
                  styles.pageTile,
                  // v0.80.0 (audit): tile height follows the text scale so
                  // the 9-line snippet isn't clipped at L/XL sizes.
                  {height: Math.round(168 * scale)},
                  t.src === null && styles.pageTileOff,
                  exportSel?.has(t.page) === true && styles.pageTileSel,
                ]}>
                <View style={styles.pageTileHead}>
                  <Text style={styles.pageTileNum}>p.{t.page + 1}</Text>
                  <Text style={styles.pageTileSrc}>
                    {t.src !== null ? SRC_LABEL[t.src] : ''}
                  </Text>
                </View>
                <Text style={styles.pageTileText} numberOfLines={9}>
                  {t.src !== null
                    ? t.snippet.length > 0
                      ? t.snippet
                      : '(blank page)'
                    : 'not read yet'}
                </Text>
              </TouchableOpacity>
            )}
            ListFooterComponent={<View style={styles.bottomPad} />}
            ListHeaderComponent={
              <>
            <Text style={[styles.manual, mf]}>
              {browsePages.filter(t => t.src !== null).length} transcribed /{' '}
              {browsePages.length} page(s). Tap one to view, edit or re-read
              its transcript.
            </Text>
            <View style={styles.chips}>
              {exportSel === null ? (
                <>
                  <InlineMenu
                    scale={scale}
                    btnScale={btnScale}
                    label={
                      (exportDone === `${docName}|md` ||
                      exportDone === `${docName}|txt`
                        ? '✓ '
                        : '') + 'Export ▾'
                    }
                    disabled={exporting}
                    options={[
                      {
                        key: 'md',
                        label: 'Export .md',
                        onPress: () =>
                          startExport(
                            [{paths: [browseDoc], baseDir: null}],
                            'md',
                            docName,
                          ),
                      },
                      {
                        key: 'txt',
                        label: 'Export .txt',
                        onPress: () =>
                          startExport(
                            [{paths: [browseDoc], baseDir: null}],
                            'txt',
                            docName,
                          ),
                      },
                    ]}
                  />
                  <AddToPicker
                    scale={scale}
                    btnScale={btnScale}
                    label="+ Add to ▾"
                    agents={agents}
                    onPick={t => onAddContext(t, {docPath: browseDoc})}
                  />
                  <TouchableOpacity
                    onPress={() => setExportSel(new Set())}
                    style={[styles.chip, bp]}>
                    <Text style={[styles.chipText, bf]}>☐ Select pages</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={onToggleDocLock}
                    style={[
                      styles.chip,
                      bp,
                      docLocked && {backgroundColor: '#000000'},
                    ]}>
                    <Text
                      style={[styles.chipText, bf, docLocked && {color: '#ffffff'}]}>
                      {docLocked
                        ? '🔓 Unlock document'
                        : lockedPages > 0
                        ? `🔒 Lock document (${lockedPages} p. locked)`
                        : '🔒 Lock document'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() =>
                      clearConfirm('doc', () => {
                        onClearDocTranscript(browseDoc);
                      })
                    }
                    style={[
                      styles.chip,
                      bp,
                      clearArmed === 'doc' && {backgroundColor: '#000000'},
                    ]}>
                    <Text
                      style={[
                        styles.chipText,
                        bf,
                        clearArmed === 'doc' && {color: '#ffffff'},
                      ]}>
                      {clearArmed === 'doc'
                        ? 'Clear transcript? (tap again)'
                        : '🗑 Clear transcript'}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <InlineMenu
                    scale={scale}
                    btnScale={btnScale}
                    label={`Export ${exportSel.size} p. ▾`}
                    disabled={exportSel.size === 0 || exporting}
                    options={(['md', 'txt'] as ExportFormat[]).map(fmt => ({
                      key: fmt,
                      label: `Export .${fmt}`,
                      onPress: () => {
                        const sel = Array.from(exportSel).sort((a, b) => a - b);
                        setExportSel(null);
                        startExport(
                          [{paths: [browseDoc], baseDir: null}],
                          fmt,
                          `${docName} (${sel.length} p.)`,
                          sel,
                        );
                      },
                    }))}
                  />
                  <AddToPicker
                    scale={scale}
                    btnScale={btnScale}
                    label={`+ Add ${exportSel.size} p. to ▾`}
                    agents={agents}
                    disabled={exportSel.size === 0}
                    onPick={t => {
                      const sel = Array.from(exportSel).sort((a, b) => a - b);
                      onAddContext(t, {docPath: browseDoc, pages: sel});
                    }}
                  />
                  <TouchableOpacity
                    onPress={() => setExportSel(null)}
                    style={[styles.chip, bp]}>
                    <Text style={[styles.chipText, bf]}>Cancel</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
            {ctxFlash.length > 0 ? (
              <Text style={[styles.manual, mf, {fontWeight: '700'}]}>
                {ctxFlash}
              </Text>
            ) : null}
            {exportAskCard}
            {msg.length > 0 ? <Text style={styles.msg}>{msg}</Text> : null}
              </>
            }
          />

        </View>
      );
}

const local = StyleSheet.create({
  pageTileOff: {borderColor: '#aaaaaa', borderStyle: 'dashed'},
  pageTileSel: {borderWidth: 3, borderColor: '#000000'},
  // FlatList rows (3 columns): same 10px gutters the flexWrap grid had.
  gridRow: {
    gap: 10,
    marginTop: 10,
  },
  pageTile: {
    width: '31%',
    // Fixed height (NOT aspectRatio): aspectRatio on a percentage-width flex
    // item inside flexWrap makes Android/Yoga miscompute the ScrollView
    // content height, letting the page-tiles list scroll far past its end
    // (device report 2026-07-15).
    height: 168,
    borderWidth: 1.5,
    borderColor: '#000000',
    padding: 7,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  pageTileHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    paddingBottom: 3,
    marginBottom: 4,
  },
  pageTileNum: {fontSize: 13, fontWeight: '700', color: '#000000'},
  pageTileSrc: {fontSize: 10, color: '#555555', fontWeight: '600'},
});
export default PageGrid;
