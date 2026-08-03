// Scroll a focused input clear of the soft keyboard (2026-08-03, user:
// adding a lasso quick action was typed BLIND — PluginHost gives RN no
// keyboard inset, so a field in the bottom half of the screen stays
// covered while the keyboard is up). Deterministic: on focus the field
// is measured against the ScrollView CONTENT and scrolled to sit near
// the top quarter of the viewport — no keyboard events involved (they
// are unreliable under PluginHost).
import {useCallback, type RefObject} from 'react';
import {findNodeHandle, UIManager, type ScrollView} from 'react-native';

export const useScrollToFocused = (
  scrollRef: RefObject<ScrollView | null>,
  topOffset = 160,
): ((evt: unknown) => void) =>
  useCallback(
    (evt: unknown) => {
      // Old-architecture RN: the focus event's target IS the react tag.
      const tag = (evt as {target?: number} | null)?.target;
      if (typeof tag !== 'number') {
        return;
      }
      // Small delay so the keyboard/layout settles before measuring.
      setTimeout(() => {
        const sv = scrollRef.current as
          | (ScrollView & {getInnerViewNode?: () => unknown})
          | null;
        if (sv === null) {
          return;
        }
        const inner =
          sv.getInnerViewNode !== undefined
            ? findNodeHandle(sv.getInnerViewNode() as never)
            : null;
        if (inner === null) {
          return;
        }
        try {
          UIManager.measureLayout(
            tag,
            inner,
            () => {},
            (_x: number, y: number) => {
              sv.scrollTo({y: Math.max(0, y - topOffset), animated: false});
            },
          );
        } catch {
          // measurement is best-effort — worse case: the old behavior
        }
      }, 150);
    },
    [scrollRef, topOffset],
  );
