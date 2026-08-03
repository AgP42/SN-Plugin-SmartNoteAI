// Holds the capture taken at button-tap (before the full-screen config
// covers the note), as a PROMISE so the view opens immediately while
// render+OCR finish. Subscribers are notified on each new capture so a
// re-tap refreshes the UI (and resets the chat) even if the plugin
// view was cached rather than remounted.
import type {PageCapture} from './capture';

let currentP: Promise<PageCapture | null> | null = null;
const subs = new Set<() => void>();

export const setCurrentCapture = (p: Promise<PageCapture | null>): void => {
  currentP = p;
  for (const fn of subs) {
    try {
      fn();
    } catch {
      // a bad subscriber must not break capture wiring
    }
  }
};

export const getCurrentCapture = (): Promise<PageCapture | null> =>
  currentP ?? Promise.resolve(null);

export const subscribeCapture = (fn: () => void): (() => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};
