/**
 * Library search results — one row per hit: open the transcript, jump to
 * the real page, or add the page to CHAT / an agent. An Off doc shows the
 * grey refusal chip instead of the picker (send-time gate, collecte
 * 2026-08-03). Extracted VERBATIM from LibraryScreen (UI refactor Lot 2).
 * Presentational: all state stays in LibraryScreen.
 */
import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {highlightSnippet} from '../../src/ui/highlightSnippet';
import type {SearchHit} from '../../src/core/store/librarySearch';
import {
  effectiveMode,
  type AutoTarget,
} from '../../src/core/store/autoEngine';
import {makeTheme} from '../../src/ui/theme';
import AddToPicker, {
  type AddTarget,
  type PickerAgent,
} from '../../src/ui/AddToPicker';

const chipSlop = {top: 8, bottom: 8, left: 4, right: 4};

export interface SearchHitsListProps {
  hits: SearchHit[];
  autoTargets: Record<string, AutoTarget>;
  agents: PickerAgent[];
  scale: number;
  btnScale: number;
  onOpenHit: (h: SearchHit) => void;
  onGoToPage: (path: string, page: number) => void;
  onAddContext: (
    target: AddTarget,
    opts: {folder?: string; docPath?: string; pages?: number[]},
  ) => void;
}

function SearchHitsList({
  hits,
  autoTargets,
  agents,
  scale,
  btnScale,
  onOpenHit,
  onGoToPage,
  onAddContext,
}: SearchHitsListProps): React.JSX.Element {
  const styles = React.useMemo(
    () => ({...makeTheme(scale, btnScale), ...local}),
    [scale, btnScale],
  );
  const nf = {fontSize: 12 * scale, lineHeight: 17 * scale};
  if (hits.length === 0) {
    return (
      <Text style={[styles.modelNote, nf]}>
        No match. Bare words search your transcripts AND document names; a page's text is searchable once the AI has read it. To make a note readable, set it to Manual/Auto and Sync.
      </Text>
    );
  }
  return (
    <>
      <Text style={[styles.modelNote, nf]}>{hits.length} result(s):</Text>
      {hits.map(h => (
        <View key={`${h.path}#${h.page}`} style={styles.libRow}>
          <TouchableOpacity onPress={() => onOpenHit(h)} style={styles.libMain}>
            <Text style={styles.libName} numberOfLines={1}>
              {h.name} · p.{h.page + 1}
            </Text>
            <Text style={styles.pageTileText} numberOfLines={2}>
              {highlightSnippet(h.snippet, h.terms, styles.b)}
            </Text>
          </TouchableOpacity>
          {/* v0.53 (user request): same explicit duo as the floating
              window. onGoToPage closes the config — full screen, it
              would hide the target page. */}
          <TouchableOpacity
            onPress={() => onOpenHit(h)}
            hitSlop={chipSlop}
            style={styles.clearMini}>
            <Text style={styles.clearMiniText}>Transcript</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onGoToPage(h.path, h.page)}
            hitSlop={chipSlop}
            style={styles.clearMini}>
            <Text style={styles.clearMiniText}>Go to page ›</Text>
          </TouchableOpacity>
          {effectiveMode(autoTargets, h.path) === 'off' ? (
            // Off docs are excluded from the AI (send-time gate): show the
            // refusal instead of a picker that would silently drop the
            // pages — same chip as the floating search.
            <View style={[styles.clearMini, {borderColor: '#999999'}]}>
              <Text style={[styles.clearMiniText, {color: '#999999'}]}>Off</Text>
            </View>
          ) : (
            <AddToPicker
              scale={scale}
              btnScale={btnScale}
              label="+ Add to ▾"
              agents={agents}
              onPick={t => onAddContext(t, {docPath: h.path, pages: [h.page]})}
            />
          )}
        </View>
      ))}
    </>
  );
}

// Copied verbatim from LibraryScreen's local sheet (the row vocabulary is
// shared with the browse rows; values must stay identical).
const local = StyleSheet.create({
  libRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#dddddd',
  },
  libMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  libName: {flex: 1, fontSize: 15, color: '#000000'},
});

export default SearchHitsList;
